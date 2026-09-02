import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createFomoScan,
  requireApiKey,
  spareApiKey,
  extraApiKey,
  normalizeBoard,
  normalizePumpBoard,
  normalizeMe,
  periodEndsAt,
  FomoScanError,
} from "../src/client.ts";

const BOARD = [
  { rank: 1, id: "aaa", handle: "alpha", pnl: 100.5, volume: 1, numTrades: 3 },
  { rank: 2, id: "bbb", handle: "beta", pnl: 10, volume: 1, numTrades: 1 },
];

describe("requireApiKey", () => {
  it("fails closed without env", () => {
    expect(() => requireApiKey({})).toThrow(/FOMOSCAN_API_KEY/);
  });

  it("returns trimmed key", () => {
    expect(requireApiKey({ FOMOSCAN_API_KEY: "  abc  " })).toBe("abc");
  });
});

describe("spareApiKey", () => {
  it("is optional", () => {
    expect(spareApiKey({})).toBeNull();
  });

  it("returns trimmed spare", () => {
    expect(spareApiKey({ FOMOSCAN_API_KEY_2: "  spare  " })).toBe("spare");
  });
});

describe("extraApiKey", () => {
  it("is optional", () => {
    expect(extraApiKey({})).toBeNull();
  });

  it("returns trimmed third key", () => {
    expect(extraApiKey({ FOMOSCAN_API_KEY_3: "  paid  " })).toBe("paid");
  });
});

describe("normalizeMe", () => {
  it("reads plan, entitlement, and both unit buckets", () => {
    const me = normalizeMe({
      plan: "pilot",
      scopes: ["basic"],
      entitlement: { monthlyUnits: 10_000, ratePerMinute: 60, unmetered: false },
      usage: { period: "2026-09", unitsUsed: 250, unitsRemaining: 9750, additionalUnits: 0 },
    });
    expect(me.plan).toBe("pilot");
    expect(me.entitlement.monthlyUnits).toBe(10_000);
    expect(me.usage.unitsRemaining).toBe(9750);
    expect(me.entitlement.unmetered).toBe(false);
    expect(me.usage.periodEndsAt).toBe(Date.UTC(2026, 9, 1) - 1);
  });

  it("ends a UTC billing month on the last millisecond", () => {
    expect(periodEndsAt("2026-09")).toBe(Date.parse("2026-09-30T23:59:59.999Z"));
    expect(periodEndsAt("bad")).toBeNull();
  });

  it("treats unmetered remaining as null", () => {
    const me = normalizeMe({
      entitlement: { unmetered: true, monthlyUnits: 0 },
      usage: { unitsUsed: 12, unitsRemaining: null },
    });
    expect(me.entitlement.unmetered).toBe(true);
    expect(me.usage.unitsRemaining).toBeNull();
    expect(me.usage.unitsUsed).toBe(12);
  });
});

describe("normalizePumpBoard", () => {
  it("reads entries and period", () => {
    const board = normalizePumpBoard({
      period: "weekly",
      capturedAt: 1,
      entries: [{ rank: 1, wallet: "Abc", username: "ann", pnlUsd: 12.5 }],
    });
    expect(board.period).toBe("weekly");
    expect(board.traders[0]).toMatchObject({ wallet: "Abc", username: "ann", pnlUsd: 12.5 });
  });
});

describe("normalizeBoard", () => {
  it("accepts a raw array", () => {
    expect(normalizeBoard(BOARD).traders).toHaveLength(2);
  });

  it("reads FomoScan entries field", () => {
    expect(normalizeBoard({ window: "all", entries: BOARD }).traders).toHaveLength(2);
  });
});

describe("createFomoScan", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("404 handle throws", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    const client = createFomoScan("test-key");
    await expect(client.userByHandle("nobody")).rejects.toMatchObject({
      status: 404,
      retryable: false,
    });
  });

  it("normalizes /v2/me", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        plan: "pilot",
        scopes: ["basic"],
        entitlement: { monthlyUnits: 0, ratePerMinute: 60, unmetered: false },
        usage: { period: "2026-09", unitsUsed: 0, unitsRemaining: 0, additionalUnits: 0 },
      }),
    });
    const client = createFomoScan("test-key");
    const me = await client.me();
    expect(me.plan).toBe("pilot");
    expect(me.usage.unitsRemaining).toBe(0);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/v2/me");
  });

  it("looks up a trader by id", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "aaa", handle: "alpha", solanaAddress: null, evmAddress: null }),
    });
    const client = createFomoScan("test-key");
    const user = await client.userById("aaa");
    expect(user.handle).toBe("alpha");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/v2/user/id/aaa");
  });

  it("finds a trader on the all board", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => BOARD,
    });
    const client = createFomoScan("test-key");
    const hit = await client.pnlForId("aaa");
    expect(hit?.pnl).toBe(100.5);
    expect(fetchMock.mock.calls[0][0]).toContain("window=all");
  });

  it("returns null when off the board", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => BOARD,
    });
    const client = createFomoScan("test-key");
    expect(await client.pnlForId("zzz")).toBeNull();
  });

  it("passes at= for a historical snapshot", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => BOARD,
    });
    const client = createFomoScan("test-key");
    await client.tradersBoard(1_700_000_000_000);
    expect(fetchMock.mock.calls[0][0]).toContain("at=1700000000000");
  });

  it("pulls the pump.fun weekly board", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        period: "weekly",
        capturedAt: 1,
        count: 1,
        entries: [{ rank: 1, wallet: "Abc", username: "ann", pnlUsd: 9 }],
      }),
    });
    const client = createFomoScan("test-key");
    const board = await client.pumpTradersBoard();
    expect(board.traders[0]?.pnlUsd).toBe(9);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/v2/pump/leaderboard/traders");
    expect(String(fetchMock.mock.calls[0][0])).toContain("period=weekly");
  });

  it("marks 5xx retryable", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    const client = createFomoScan("test-key");
    await expect(client.tradersBoard()).rejects.toBeInstanceOf(FomoScanError);
    await expect(client.tradersBoard()).rejects.toMatchObject({ retryable: true, status: 503 });
  });
});
