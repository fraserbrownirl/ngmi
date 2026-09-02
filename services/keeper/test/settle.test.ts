import { describe, it, expect, vi } from "vitest";
import { decideFromBoard, settleFromBoard } from "../src/index.ts";
import { SETTLE_FIRST_PRINT, usdToMicro } from "@fomopred/shared";

const market = {
  id: "1",
  chain: "solana" as const,
  fomoUserId: "aaa",
  thresholdUsd: usdToMicro(100),
  resolutionTime: 1_700_000_000,
  yesPool: 1n,
  noPool: 1n,
};

const atT = market.resolutionTime * 1000;

describe("decideFromBoard", () => {
  it("YES at equality", () => {
    const board = { capturedAt: atT, traders: [{ id: "aaa", pnl: 100 }] };
    const action = decideFromBoard(market, board, atT);
    expect(action).toMatchObject({ kind: "report", yes: true, endPnlUsd: usdToMicro(100) });
  });

  it("off-board cancels", () => {
    const board = { capturedAt: atT, traders: [{ id: "bbb", pnl: 1 }] };
    expect(decideFromBoard(market, board, atT)).toEqual({ kind: "cancel", reason: "off_board" });
  });

  it("empty book cancels without a board", () => {
    expect(
      decideFromBoard({ ...market, yesPool: 0n }, null, atT),
    ).toEqual({ kind: "cancel", reason: "empty_book" });
    expect(
      decideFromBoard({ ...market, noPool: 0n }, null, atT),
    ).toEqual({ kind: "cancel", reason: "empty_book" });
  });

  it("missing board cancels as down", () => {
    expect(decideFromBoard(market, null, atT)).toEqual({ kind: "cancel", reason: "fomoscan_down" });
  });

  it("waits after T for a print at or after T", () => {
    const board = { capturedAt: atT - 1, traders: [{ id: "aaa", pnl: 100 }] };
    expect(decideFromBoard(market, board, atT)).toEqual({ kind: "cancel", reason: "not_due" });
  });

  it("skips before T", () => {
    const board = { traders: [{ id: "aaa", pnl: 100 }] };
    expect(decideFromBoard(market, board, atT - 1)).toEqual({ kind: "cancel", reason: "not_due" });
  });

  it("first-print reports YES before T on a hit", () => {
    const board = { capturedAt: atT - 1, traders: [{ id: "aaa", pnl: 100 }] };
    expect(
      decideFromBoard({ ...market, settleKind: SETTLE_FIRST_PRINT }, board, atT - 1),
    ).toMatchObject({ kind: "report", yes: true });
  });

  it("first-print waits when still under", () => {
    const board = { traders: [{ id: "aaa", pnl: 99 }] };
    expect(
      decideFromBoard({ ...market, settleKind: SETTLE_FIRST_PRINT }, board, atT - 1),
    ).toEqual({ kind: "cancel", reason: "not_due" });
  });

  it("first-print does not cancel off-board before T", () => {
    const board = { traders: [{ id: "bbb", pnl: 1 }] };
    expect(
      decideFromBoard({ ...market, settleKind: SETTLE_FIRST_PRINT }, board, atT - 1),
    ).toEqual({ kind: "cancel", reason: "not_due" });
  });

  it("first-print ignores a print from before the pot opened", () => {
    const opened = market.resolutionTime - 5;
    const board = { capturedAt: (opened - 10) * 1000, traders: [{ id: "aaa", pnl: 100 }] };
    expect(
      decideFromBoard(
        { ...market, settleKind: SETTLE_FIRST_PRINT, createdAt: opened },
        board,
        atT - 1,
      ),
    ).toEqual({ kind: "cancel", reason: "not_due" });
  });

  it("first-print reports when the print is after the pot opened", () => {
    const opened = market.resolutionTime - 20;
    const board = { capturedAt: (opened + 5) * 1000, traders: [{ id: "aaa", pnl: 100 }] };
    expect(
      decideFromBoard(
        { ...market, settleKind: SETTLE_FIRST_PRINT, createdAt: opened },
        board,
        atT - 1,
      ),
    ).toMatchObject({ kind: "report", yes: true });
  });

  it("first-print ignores a stale leftover file", () => {
    const board = { capturedAt: atT - 1, stale: true, traders: [{ id: "aaa", pnl: 100 }] };
    expect(
      decideFromBoard({ ...market, settleKind: SETTLE_FIRST_PRINT }, board, atT - 1),
    ).toEqual({ kind: "cancel", reason: "not_due" });
  });

  it("at T a stale leftover file still posts if it was printed at or after T", () => {
    const board = { capturedAt: atT, stale: true, traders: [{ id: "aaa", pnl: 100 }] };
    expect(decideFromBoard(market, board, atT)).toMatchObject({ kind: "report", yes: true });
  });
});

describe("settleFromBoard", () => {
  it("posts one report from the print", async () => {
    const poster = { report: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) };
    const board = { capturedAt: atT, traders: [{ id: "aaa", pnl: 100 }] };
    await settleFromBoard(poster, market, board, atT);
    expect(poster.report).toHaveBeenCalledTimes(1);
    expect(poster.cancel).not.toHaveBeenCalled();
  });

  it("does not post before T", async () => {
    const poster = { report: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) };
    await settleFromBoard(poster, market, { traders: [{ id: "aaa", pnl: 100 }] }, atT - 1);
    expect(poster.report).not.toHaveBeenCalled();
    expect(poster.cancel).not.toHaveBeenCalled();
  });

  it("posts a first-print hit before T", async () => {
    const poster = { report: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) };
    await settleFromBoard(
      poster,
      { ...market, settleKind: SETTLE_FIRST_PRINT },
      { capturedAt: atT - 1, traders: [{ id: "aaa", pnl: 100 }] },
      atT - 1,
    );
    expect(poster.report).toHaveBeenCalledTimes(1);
  });
});
