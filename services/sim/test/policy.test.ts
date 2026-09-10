import { describe, it, expect } from "vitest";
import type { BoardPrint, MarketRecord } from "@fomopred/keeper";
import { SETTLE_FIRST_PRINT, SETTLE_CLOSE_AT_T } from "@fomopred/shared";
import {
  evaluate,
  pickBest,
  estimateYesProb,
  breakevenProb,
  type PolicyKnobs,
  type PolicyInput,
} from "../src/policy";

const NOW = 1_800_000_000_000; // fixed clock for determinism
const nowSec = Math.floor(NOW / 1000);

const KNOBS: PolicyKnobs = {
  edgeMargin: 0.02,
  proximityGuard: 0.2,
  minBetUsdc: 0.25,
  maxBetUsdc: 5,
  betFractionMin: 0.04,
  betFractionMax: 0.12,
  maxMarketExposureUsdc: 2,
};

const usd = (n: number) => BigInt(Math.round(n * 1e6));

const record = (over: Partial<MarketRecord> = {}): MarketRecord => ({
  id: "1",
  chain: "solana",
  fomoUserId: "trader-1",
  thresholdUsd: usd(500),
  resolutionTime: nowSec + 3600,
  createdAt: nowSec - 3600,
  yesPool: usd(10),
  noPool: usd(10),
  settleKind: SETTLE_CLOSE_AT_T,
  ...over,
});

const board = (
  traders: { id: string; pnl: number }[],
  over: Partial<BoardPrint> = {},
): BoardPrint => ({ capturedAt: NOW, traders, ...over });

const input = (over: Partial<PolicyInput> = {}): PolicyInput => ({
  record: record(),
  rakeBps: 500,
  board: board([{ id: "trader-1", pnl: 100 }]),
  bankrollUsdc: 10,
  nowMs: NOW,
  knobs: KNOBS,
  rng: () => 0.5, // frac = 0.08
  ...over,
});

describe("estimateYesProb", () => {
  it("is 0.5 at the mark", () => {
    expect(estimateYesProb(500, 500, 3600, 3600)).toBeCloseTo(0.5, 5);
  });
  it("rises as pnl approaches the mark and sharpens with less time", () => {
    const far = estimateYesProb(400, 500, 3600, 3600);
    const near = estimateYesProb(490, 500, 3600, 3600);
    expect(near).toBeGreaterThan(far);
    // Sharpening moves away from 0.5: below the mark, less time => lower.
    const nearLate = estimateYesProb(490, 500, 300, 7500);
    expect(nearLate).toBeLessThan(near);
    // Above the mark, less time => higher.
    const overLate = estimateYesProb(510, 500, 300, 7500);
    expect(overLate).toBeGreaterThan(estimateYesProb(510, 500, 3600, 3600));
  });
});

describe("breakevenProb", () => {
  it("includes the rake on the losing pool", () => {
    // Y=N=10, rake 5%: p* = 10 / (10 + 9.5)
    expect(breakevenProb("yes", 10, 10, 500)).toBeCloseTo(10 / 19.5, 5);
    expect(breakevenProb("no", 10, 10, 500)).toBeCloseTo(10 / 19.5, 5);
  });
  it("is 1 for a one-sided pool (cancel trap)", () => {
    expect(breakevenProb("yes", 10, 0, 500)).toBe(1);
  });
});

describe("evaluate", () => {
  it("abstains with no board", () => {
    const d = evaluate(input({ board: null }));
    expect(d).toMatchObject({ action: "abstain", reason: "no_board" });
  });

  it("abstains when the trader is off the board", () => {
    const d = evaluate(input({ board: board([{ id: "someone-else", pnl: 999 }]) }));
    expect(d).toMatchObject({ action: "abstain", reason: "trader_off_board" });
  });

  it("abstains right before T", () => {
    const d = evaluate(
      input({ record: record({ resolutionTime: nowSec + 30 }) }),
    );
    expect(d).toMatchObject({ action: "abstain", reason: "too_close_to_T" });
  });

  it("bets YES with keeper foresight on a first-print hit", () => {
    const d = evaluate(
      input({
        record: record({ settleKind: SETTLE_FIRST_PRINT }),
        board: board([{ id: "trader-1", pnl: 600 }]), // over the $500 mark
      }),
    );
    expect(d.action).toBe("bet");
    if (d.action === "bet") {
      expect(d.side).toBe("yes");
      expect(d.pYes).toBe(0.99);
      expect(d.amountUsdc).toBeCloseTo(0.8, 5); // 10 * 0.08
      expect(d.rationale).toContain("keeper_will_print_YES");
    }
  });

  it("does not treat a stale board as a first-print hit", () => {
    const d = evaluate(
      input({
        record: record({ settleKind: SETTLE_FIRST_PRINT }),
        board: board([{ id: "trader-1", pnl: 600 }], { stale: true }),
      }),
    );
    // Falls back to the smooth model, not the 0.99 foresight.
    if (d.action === "bet") expect(d.pYes).not.toBe(0.99);
  });

  it("suppresses NO near the mark even with pool edge (proximity guard)", () => {
    // pnl 450 vs k 500 (gap ratio 0.1 < 0.2); pools make NO look tempting.
    const d = evaluate(
      input({
        record: record({ yesPool: usd(10), noPool: usd(1) }),
        board: board([{ id: "trader-1", pnl: 450 }]),
      }),
    );
    expect(d).toMatchObject({ action: "abstain", reason: "proximity_guard_no" });
  });

  it("opens an empty book NO near the mark under uncertainty (guard exempts openers)", () => {
    // The maker's fresh 3% marks sit inside the guard band by construction;
    // gating openers on it left every fresh book permanently empty.
    const d = evaluate(
      input({
        record: record({ yesPool: 0n, noPool: 0n }),
        board: board([{ id: "trader-1", pnl: 485 }]), // gap ratio 0.03
      }),
    );
    expect(d.action).toBe("bet");
    if (d.action === "bet") {
      expect(d.side).toBe("no"); // pYes just under 0.5 favors NO
      expect(d.amountUsdc).toBe(0.25);
    }
  });

  it("allows NO far below the mark when the edge clears the margin", () => {
    const d = evaluate(
      input({
        record: record({ yesPool: usd(10), noPool: usd(1) }),
        board: board([{ id: "trader-1", pnl: 100 }]), // gap ratio 0.8
      }),
    );
    expect(d.action).toBe("bet");
    if (d.action === "bet") expect(d.side).toBe("no");
  });

  it("never bets the heavy side of a one-sided pool (cancel trap)", () => {
    const d = evaluate(
      input({
        record: record({ settleKind: SETTLE_FIRST_PRINT, noPool: 0n }),
        board: board([{ id: "trader-1", pnl: 600 }]),
      }),
    );
    expect(d.action).toBe("abstain");
  });

  it("opens an empty book small under genuine uncertainty", () => {
    // pnl 400 vs k 500: P_yes ~0.33 — model favors NO, opens at min bet.
    const d = evaluate(
      input({
        record: record({ yesPool: 0n, noPool: 0n }),
        board: board([{ id: "trader-1", pnl: 400 }]),
      }),
    );
    expect(d.action).toBe("bet");
    if (d.action === "bet") {
      expect(d.side).toBe("no");
      expect(d.amountUsdc).toBe(KNOBS.minBetUsdc);
      expect(d.rationale).toContain("opener");
    }
  });

  it("opens YES when the model leans YES", () => {
    const d = evaluate(
      input({
        record: record({ yesPool: 0n, noPool: 0n }),
        board: board([{ id: "trader-1", pnl: 520 }]),
      }),
    );
    expect(d.action).toBe("bet");
    if (d.action === "bet") expect(d.side).toBe("yes");
  });

  it("leaves a foregone-conclusion empty book alone", () => {
    // pnl 100 vs k 500: P_yes ~0.05 — no opener, one-sided risk not worth it.
    const d = evaluate(
      input({ record: record({ yesPool: 0n, noPool: 0n }) }),
    );
    expect(d).toMatchObject({ action: "abstain", reason: "opener_no_uncertainty" });
  });

  it("abstains when neither side clears the margin", () => {
    // pnl 350 vs k 500 (gap ratio 0.3, outside the proximity guard) with a
    // NO-heavy pool: model pYes ~0.25, but breakeven NO is ~0.76 — no edge.
    const d = evaluate(
      input({
        record: record({ yesPool: usd(10), noPool: usd(30) }),
        board: board([{ id: "trader-1", pnl: 350 }]),
      }),
    );
    expect(d).toMatchObject({ action: "abstain", reason: "no_edge" });
  });

  it("abstains when the bankroll cannot cover the minimum bet", () => {
    const d = evaluate(input({ bankrollUsdc: 1 })); // 1 * 0.08 = 0.08 < 0.25
    expect(d).toMatchObject({ action: "abstain", reason: "bankroll_too_small" });
  });

  it("caps size at the per-bet max", () => {
    const d = evaluate(
      input({
        record: record({ settleKind: SETTLE_FIRST_PRINT }),
        board: board([{ id: "trader-1", pnl: 600 }]),
        bankrollUsdc: 1000, // 1000 * 0.08 = 80 -> capped at 5
      }),
    );
    expect(d.action).toBe("bet");
    if (d.action === "bet") expect(d.amountUsdc).toBe(5);
  });

  it("prices the bet's own pool impact (size-aware breakeven)", () => {
    // One-sided NO book of $0.50, model P_yes 0.34. Opposing with YES at
    // min bet breaks even at 0.345 — no edge, abstain.
    const near = evaluate(
      input({
        record: record({ noPool: usd(0.5), yesPool: 0n }),
        board: board([{ id: "trader-1", pnl: 400 }]),
      }),
    );
    expect(near.action).toBe("abstain");
    // Same book, but this agent's conviction jitter lifts P_yes to ~0.46:
    // opposing at min bet now clears the margin.
    const convinced = evaluate(
      input({
        record: record({ noPool: usd(0.5), yesPool: 0n }),
        board: board([{ id: "trader-1", pnl: 400 }]),
        convictionJitter: 0.12,
      }),
    );
    expect(convinced.action).toBe("bet");
    if (convinced.action === "bet") {
      expect(convinced.side).toBe("yes");
      expect(convinced.amountUsdc).toBe(KNOBS.minBetUsdc);
      expect(convinced.rationale).toContain("oppose");
    }
  });

  it("piles into a dominant two-sided book at min size under uncertainty", () => {
    // Y=$4 N=$1 (80% dominant), model leans YES (pnl 520 vs k 500).
    const d = evaluate(
      input({
        record: record({ yesPool: usd(4), noPool: usd(1) }),
        board: board([{ id: "trader-1", pnl: 520 }]),
      }),
    );
    expect(d.action).toBe("bet");
    if (d.action === "bet") {
      expect(d.side).toBe("yes");
      expect(d.amountUsdc).toBe(KNOBS.minBetUsdc);
      expect(d.rationale).toContain("pile_in");
    }
  });

  it("respects the per-market exposure cap", () => {
    const d = evaluate(
      input({
        record: record({ settleKind: SETTLE_FIRST_PRINT }),
        board: board([{ id: "trader-1", pnl: 600 }]),
        myExposureUsdc: 2,
      }),
    );
    expect(d).toMatchObject({ action: "abstain", reason: "max_market_exposure" });
  });
});

describe("pickBest", () => {
  it("picks the highest edge and returns null when all abstain", () => {
    const sureYes: PolicyInput = input({
      record: record({ settleKind: SETTLE_FIRST_PRINT }),
      board: board([{ id: "trader-1", pnl: 600 }]),
    });
    const noEdge = input({
      record: record({ yesPool: usd(10), noPool: usd(30) }),
      board: board([{ id: "trader-1", pnl: 350 }]),
    });
    const best = pickBest([
      { marketId: 7, input: noEdge },
      { marketId: 3, input: sureYes },
    ]);
    expect(best?.marketId).toBe(3);
    expect(pickBest([{ marketId: 7, input: noEdge }])).toBeNull();
  });
});
