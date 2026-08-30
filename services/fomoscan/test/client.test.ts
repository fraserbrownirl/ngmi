import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFomoScan, requireApiKey, spareApiKey, normalizeBoard, FomoScanError } from "../src/client.ts";

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

  it("marks 5xx retryable", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    const client = createFomoScan("test-key");
    await expect(client.tradersBoard()).rejects.toBeInstanceOf(FomoScanError);
    await expect(client.tradersBoard()).rejects.toMatchObject({ retryable: true, status: 503 });
  });
});
