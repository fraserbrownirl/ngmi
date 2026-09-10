import { describe, it, expect } from "vitest";
import type { Leaderboard, LeaderboardEntry } from "@fomopred/fomoscan";
import { planMarket, MIN_TRADER_PNL_USD } from "../src/make";

const NOW_SEC = 1_800_000_000;

const trader = (over: Partial<LeaderboardEntry> = {}): LeaderboardEntry => ({
  rank: 1,
  id: "trader-1",
  handle: "whale",
  pnl: 1000,
  volume: 50_000,
  numTrades: 12,
  ...over,
});

const board = (traders: LeaderboardEntry[]): Leaderboard => ({
  window: "all",
  capturedAt: NOW_SEC,
  traders,
});

const base = {
  activeCount: 0,
  busyTraderIds: new Set<string>(),
  nextMarketId: 2,
  nowSec: NOW_SEC,
  markupPct: 0.03,
  ttlSec: 2700,
  maxActive: 1,
};

describe("planMarket", () => {
  it("returns null without a board", () => {
    expect(planMarket({ ...base, board: null })).toBeNull();
  });

  it("returns null when the active board is full", () => {
    expect(planMarket({ ...base, board: board([trader()]), activeCount: 1 })).toBeNull();
  });

  it("marks just over the current PnL with a short first-print T", () => {
    const plan = planMarket({ ...base, board: board([trader()]) })!;
    expect(plan.traderId).toBe("trader-1");
    expect(plan.handle).toBe("whale");
    expect(plan.markUsd).toBeGreaterThan(1000);
    expect(plan.markUsd).toBeCloseTo(1030, 0);
    expect(plan.resolutionTime).toBe(NOW_SEC + 2700);
    expect(plan.rationale).toContain("first-print");
  });

  it("skips traders who already have an active pot", () => {
    const plan = planMarket({
      ...base,
      board: board([trader(), trader({ rank: 2, id: "trader-2", handle: "two", pnl: 500 })]),
      busyTraderIds: new Set(["trader-1"]),
      nextMarketId: 2, // 2 % 1 eligible = index 0 of the remaining list
    })!;
    expect(plan.traderId).toBe("trader-2");
  });

  it("skips traders outside the top-25 and below the PnL floor", () => {
    const b = board([
      trader({ rank: 26, id: "too-low-ranked" }),
      trader({ rank: 3, id: "broke", pnl: MIN_TRADER_PNL_USD - 1 }),
      trader({ rank: 4, id: "negative", pnl: -5000 }),
      trader({ rank: 5, id: "ok", handle: "ok", pnl: 200 }),
    ]);
    const plan = planMarket({ ...base, board: b, nextMarketId: 9 })!;
    expect(plan.traderId).toBe("ok");
    expect(plan.markUsd).toBeCloseTo(206, 0);
  });

  it("returns null when nobody is eligible", () => {
    const b = board([trader({ rank: 30 }), trader({ rank: 2, pnl: -1 })]);
    expect(planMarket({ ...base, board: b })).toBeNull();
  });

  it("rotates through eligible traders by next market id", () => {
    const b = board([
      trader({ rank: 1, id: "a", pnl: 900 }),
      trader({ rank: 2, id: "b", pnl: 800 }),
      trader({ rank: 3, id: "c", pnl: 700 }),
    ]);
    const ids = [2, 3, 4, 5].map(
      (nextMarketId) => planMarket({ ...base, board: b, nextMarketId })!.traderId,
    );
    expect(ids).toEqual(["c", "a", "b", "c"]);
  });

  it("never produces a mark at or below start PnL (program rejects it)", () => {
    const plan = planMarket({
      ...base,
      board: board([trader({ pnl: MIN_TRADER_PNL_USD })]),
    })!;
    expect(plan.markUsd).toBeGreaterThan(MIN_TRADER_PNL_USD);
  });
});
