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
  /** Per-market exposure cap per agent, USDC. */
  maxMarketExposureUsdc: number;
};

export type PolicyInput = {
  record: MarketRecord;
  /** Market's snapshotted total rake bps (e.g. 500 = 5% of the losing pool). */
  rakeBps: number;
  board: BoardPrint | null;
  bankrollUsdc: number;
  /**
   * Deterministic per-agent-per-market probability offset, e.g. ±0.12.
   * Agents share one model but not one opinion — this is what makes them
   * disagree enough to take opposite sides of the same book.
   */
  convictionJitter?: number;
  /** Agent's existing stake in this market, USDC. */
  myExposureUsdc?: number;
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
 * Breakeven win probability for a bet of `betUsdc` on `side`, given the
 * pools and the rake on the losing pool. Size-aware: your bet enters the
 * pool, so a YES bet of b at pools (Y, N) pays (Y+b+N(1-r))/(Y+b) per unit
 * and p* = (Y+b) / (Y+b + N(1-r)). The marginal (b→0) form understates the
 * price of a large bet — a bet bigger than the opposing pool is mostly
 * betting against itself.
 */
export function breakevenProb(
  side: "yes" | "no",
  yesPoolUsdc: number,
  noPoolUsdc: number,
  rakeBps: number,
  betUsdc = 0,
): number {
  const r = rakeBps / 10_000;
  const [own, other] = side === "yes" ? [yesPoolUsdc, noPoolUsdc] : [noPoolUsdc, yesPoolUsdc];
  const denom = own + betUsdc + other * (1 - r);
  return denom <= 0 ? 1 : (own + betUsdc) / denom;
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
  let certain = false;
  if (settle.kind === "report") {
    pYes = settle.yes ? 0.99 : 0.01;
    foresight = ` keeper_will_print_${settle.yes ? "YES" : "NO"}`;
    certain = true;
  } else if (settle.reason === "off_board" || settle.reason === "fomoscan_down") {
    return { action: "abstain", reason: `keeper_will_cancel_${settle.reason}`, pYes: null };
  } else {
    pYes = estimateYesProb(pnl, k, timeLeftSec, ageSec);
  }
  // Agents share the model but not the opinion. Foresight is fact, not
  // opinion — no jitter on a near-certain print.
  if (!certain && input.convictionJitter) {
    pYes = Math.min(Math.max(pYes + input.convictionJitter, 0.01), 0.99);
  }

  if ((input.myExposureUsdc ?? 0) >= knobs.maxMarketExposureUsdc) {
    return { action: "abstain", reason: "max_market_exposure", pYes };
  }

  const gapRatio = (k - pnl) / Math.max(Math.abs(k), 1);
  const common =
    `p=$${pnl.toFixed(0)} k=$${k.toFixed(0)} t=${Math.round(timeLeftSec / 60)}m ` +
    `P_yes=${pYes.toFixed(2)} pools Y=$${yesPool.toFixed(2)}/N=$${noPool.toFixed(2)}${foresight}`;

  // Empty book: an agent opens it, small, on the side its model favors —
  // but only under genuine uncertainty. A foregone conclusion stays empty:
  // one-sided pools auto-cancel at resolve, so seeding one earns a refund,
  // not a payout. (Breakeven is 1.0 by construction; this is a seeding cost.)
  if (yesPool === 0 && noPool === 0) {
    if (pYes < 0.2 || pYes > 0.8) {
      return { action: "abstain", reason: "opener_no_uncertainty", pYes };
    }
    const side = pYes >= 0.5 ? "yes" : "no";
    if (side === "no" && gapRatio < knobs.proximityGuard) {
      return { action: "abstain", reason: "proximity_guard_no", pYes };
    }
    if (input.bankrollUsdc < knobs.minBetUsdc) {
      return { action: "abstain", reason: "bankroll_too_small", pYes };
    }
    return {
      action: "bet",
      side,
      amountUsdc: knobs.minBetUsdc,
      pYes,
      breakeven: 1,
      edge: 0,
      rationale: `${common} -> opener ${side.toUpperCase()} $${knobs.minBetUsdc.toFixed(2)}`,
    };
  }

  // Sizing discipline: if even the largest bankroll fraction can't cover the
  // minimum bet, the bankroll is too small for this market at all.
  if (input.bankrollUsdc * knobs.betFractionMax < knobs.minBetUsdc) {
    return { action: "abstain", reason: "bankroll_too_small", pYes };
  }

  const frac =
    knobs.betFractionMin + rng() * (knobs.betFractionMax - knobs.betFractionMin);
  const sized = Math.min(
    Math.round(input.bankrollUsdc * frac * 100) / 100,
    knobs.maxBetUsdc,
  );

  // Evaluate both sides. Edge = model probability minus the size-aware
  // breakeven; a candidate that fails at full size gets one retry at the
  // minimum bet (smaller bets get better pool odds).
  type Candidate = { side: "yes" | "no"; amount: number; breakeven: number; edge: number; tag: string };
  const candidates: Candidate[] = [];
  let noSuppressedWithEdge = false;
  for (const side of ["yes", "no"] as const) {
    const [own, other] = side === "yes" ? [yesPool, noPool] : [noPool, yesPool];
    const pSide = side === "yes" ? pYes : 1 - pYes;
    if (side === "no" && gapRatio < knobs.proximityGuard) {
      // Audit trail: note when the guard suppressed a NO that had edge.
      if (other > 0) {
        const be = breakevenProb("no", yesPool, noPool, input.rakeBps, Math.max(sized, knobs.minBetUsdc));
        if (pSide - be > knobs.edgeMargin) noSuppressedWithEdge = true;
      }
      continue;
    }
    if (other === 0) {
      // One-sided book, empty side: breakeven is 1.0 — never +EV. Skip.
      continue;
    }
    if (own === 0) {
      // Opposing a one-sided book: normal edge check at min size — the
      // whole other pool is the prize, so odds are generous.
      const breakeven = breakevenProb(side, yesPool, noPool, input.rakeBps, knobs.minBetUsdc);
      const edge = pSide - breakeven;
      if (edge > knobs.edgeMargin) {
        candidates.push({ side, amount: knobs.minBetUsdc, breakeven, edge, tag: "oppose" });
      }
      continue;
    }
    for (const amount of [sized, knobs.minBetUsdc]) {
      if (amount < knobs.minBetUsdc) continue;
      const breakeven = breakevenProb(side, yesPool, noPool, input.rakeBps, amount);
      const edge = pSide - breakeven;
      if (edge > knobs.edgeMargin) {
        candidates.push({ side, amount, breakeven, edge, tag: "edge" });
        break;
      }
    }
    // Pile-in: joining the heavy side of a book that could still go
    // one-sided carries cancel risk (refund, not payout). Allowed small,
    // only under uncertainty, only when the model leans that way — this is
    // what builds a book deep enough for opposition to find attractive.
    if (
      !certain &&
      pYes > 0.2 && pYes < 0.8 &&
      pSide > 0.5 &&
      own > 0 && other > 0 &&
      own / (own + other) > 0.75
    ) {
      candidates.push({
        side,
        amount: knobs.minBetUsdc,
        breakeven: breakevenProb(side, yesPool, noPool, input.rakeBps, knobs.minBetUsdc),
        edge: 0,
        tag: "pile_in",
      });
    }
  }

  if (candidates.length === 0) {
    if (noSuppressedWithEdge) {
      return { action: "abstain", reason: "proximity_guard_no", pYes };
    }
    return { action: "abstain", reason: "no_edge", pYes };
  }
  candidates.sort((a, b) => b.edge - a.edge);
  const best = candidates[0];
  if (input.bankrollUsdc < best.amount) {
    return { action: "abstain", reason: "bankroll_too_small", pYes };
  }
  return {
    action: "bet",
    side: best.side,
    amountUsdc: best.amount,
    pYes,
    breakeven: best.breakeven,
    edge: best.edge,
    rationale:
      `${common} breakeven=${best.breakeven.toFixed(2)} edge=${best.edge.toFixed(2)} ` +
      `-> ${best.tag} ${best.side.toUpperCase()} $${best.amount.toFixed(2)}`,
  };
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
