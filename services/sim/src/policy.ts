import { decideFromBoard, indexBoard, type BoardPrint, type MarketRecord } from "@fomopred/keeper";
import { microToUsd } from "@fomopred/shared";

export type PolicyKnobs = {
  /** Required probability edge over the pool-implied breakeven. */
  edgeMargin: number;
  /** Gap ratio (k - p) / |k| below which NO bets are suppressed. */
  proximityGuard: number;
  minBetUsdc: number;
  maxBetUsdc: number;
  betFractionMin: number;
  betFractionMax: number;
};

export type PolicyInput = {
  record: MarketRecord;
  /** Market's snapshotted total rake bps (e.g. 500 = 5% of the losing pool). */
  rakeBps: number;
  board: BoardPrint | null;
  bankrollUsdc: number;
  nowMs?: number;
  knobs: PolicyKnobs;
  rng?: () => number;
};

export type Decision =
  | {
      action: "bet";
      side: "yes" | "no";
      amountUsdc: number;
      pYes: number;
      breakeven: number;
      edge: number;
      rationale: string;
    }
  | { action: "abstain"; reason: string; pYes: number | null };

/** Don't fire bet transactions this close to T; they can land after the cutoff. */
const MIN_TIME_TO_BET_SEC = 60;

const logistic = (x: number): number => 1 / (1 + Math.exp(x));

/**
 * Win probability from distance-to-mark and time remaining. `scale` widens
 * with the mark's size and shrinks as T approaches: the same dollar gap means
 * more with an hour left than with a day left.
 */
export function estimateYesProb(
  pnlUsd: number,
  thresholdUsd: number,
  timeLeftSec: number,
  marketAgeSec: number,
): number {
  const gap = thresholdUsd - pnlUsd;
  const total = Math.max(marketAgeSec + timeLeftSec, 1);
  const timeFrac = Math.min(Math.max(timeLeftSec / total, 0), 1);
  const scale = Math.max(Math.abs(thresholdUsd), 100) * (0.05 + 0.45 * timeFrac);
  return logistic(gap / scale);
}

/**
 * Breakeven win probability for a small bet on `side`, given the pools and
 * the rake on the losing pool. Betting YES at pools (Y, N) pays
 * (Y + N(1-r)) / Y per unit, so p* = Y / (Y + N(1-r)).
 */
export function breakevenProb(
  side: "yes" | "no",
  yesPoolUsdc: number,
  noPoolUsdc: number,
  rakeBps: number,
): number {
  const r = rakeBps / 10_000;
  const [own, other] = side === "yes" ? [yesPoolUsdc, noPoolUsdc] : [noPoolUsdc, yesPoolUsdc];
  const denom = own + other * (1 - r);
  return denom <= 0 ? 1 : own / denom;
}

/**
 * Evaluate one active market. The board is the same print the keeper settles
 * from, and `decideFromBoard` is the keeper's own decision function — when it
 * says the next tick resolves the market, the outcome is near-certain and the
 * agent prices that in instead of trusting the smooth model.
 */
export function evaluate(input: PolicyInput): Decision {
  const { record, board, knobs } = input;
  const nowMs = input.nowMs ?? Date.now();
  const rng = input.rng ?? Math.random;
  const pnl = board ? (indexBoard(board)?.get(record.fomoUserId) ?? null) : null;
  const k = microToUsd(record.thresholdUsd);
  const yesPool = microToUsd(record.yesPool ?? 0n);
  const noPool = microToUsd(record.noPool ?? 0n);
  const timeLeftSec = record.resolutionTime - Math.floor(nowMs / 1000);
  const ageSec = Math.floor(nowMs / 1000) - (record.createdAt ?? record.resolutionTime);

  if (!board) return { action: "abstain", reason: "no_board", pYes: null };
  if (pnl == null) return { action: "abstain", reason: "trader_off_board", pYes: null };
  if (timeLeftSec < MIN_TIME_TO_BET_SEC) {
    return { action: "abstain", reason: "too_close_to_T", pYes: null };
  }

  // Keeper foresight: what will the next tick do with this exact board?
  const settle = decideFromBoard(record, board, nowMs);
  let pYes: number;
  let foresight = "";
  if (settle.kind === "report") {
    pYes = settle.yes ? 0.99 : 0.01;
    foresight = ` keeper_will_print_${settle.yes ? "YES" : "NO"}`;
  } else if (settle.reason === "off_board" || settle.reason === "fomoscan_down") {
    return { action: "abstain", reason: `keeper_will_cancel_${settle.reason}`, pYes: null };
  } else {
    pYes = estimateYesProb(pnl, k, timeLeftSec, ageSec);
  }

  // Cancel trap: a one-sided pool auto-cancels at resolve — betting the
  // heavy side earns a refund, not a payout.
  if (yesPool === 0 && noPool === 0) {
    return { action: "abstain", reason: "empty_pools", pYes };
  }

  const pYesStar = breakevenProb("yes", yesPool, noPool, input.rakeBps);
  const pNoStar = breakevenProb("no", yesPool, noPool, input.rakeBps);
  const edgeYes = pYes - pYesStar;
  const edgeNo = 1 - pYes - pNoStar;

  let side: "yes" | "no";
  let edge: number;
  let breakeven: number;
  if (edgeYes >= edgeNo && edgeYes > knobs.edgeMargin && noPool > 0) {
    side = "yes";
    edge = edgeYes;
    breakeven = pYesStar;
  } else if (edgeNo > knobs.edgeMargin && yesPool > 0) {
    // Proximity guard: near (or over) the mark, NO is suppressed outright.
    const gapRatio = (k - pnl) / Math.max(Math.abs(k), 1);
    if (gapRatio < knobs.proximityGuard) {
      return { action: "abstain", reason: "proximity_guard_no", pYes };
    }
    side = "no";
    edge = edgeNo;
    breakeven = pNoStar;
  } else {
    return { action: "abstain", reason: "no_edge", pYes };
  }

  const frac =
    knobs.betFractionMin + rng() * (knobs.betFractionMax - knobs.betFractionMin);
  const amount = Math.min(
    Math.round(input.bankrollUsdc * frac * 100) / 100,
    knobs.maxBetUsdc,
  );
  if (amount < knobs.minBetUsdc) {
    return { action: "abstain", reason: "bankroll_too_small", pYes };
  }

  const rationale =
    `p=$${pnl.toFixed(0)} k=$${k.toFixed(0)} t=${Math.round(timeLeftSec / 60)}m ` +
    `P_yes=${pYes.toFixed(2)} breakeven=${breakeven.toFixed(2)} edge=${edge.toFixed(2)} ` +
    `pools Y=$${yesPool.toFixed(2)}/N=$${noPool.toFixed(2)}${foresight} -> ${side.toUpperCase()} $${amount.toFixed(2)}`;
  return { action: "bet", side, amountUsdc: amount, pYes, breakeven, edge, rationale };
}

/** Best edge across many markets; null when everything says abstain. */
export function pickBest(
  inputs: { marketId: number; input: PolicyInput }[],
): { marketId: number; decision: Decision & { action: "bet" } } | null {
  let best: { marketId: number; decision: Decision & { action: "bet" } } | null = null;
  for (const { marketId, input } of inputs) {
    const d = evaluate(input);
    if (d.action !== "bet") continue;
    if (!best || d.edge > best.decision.edge) best = { marketId, decision: d };
  }
  return best;
}
