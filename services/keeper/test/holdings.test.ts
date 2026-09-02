import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { lookupSymbols, parseParsedTokenAccounts } from "../src/holdings.ts";

describe("parseParsedTokenAccounts", () => {
  it("keeps fungible balances and drops NFTs and zeros", () => {
    const rows = [
      {
        account: {
          data: { parsed: { info: { mint: "bonkMint", tokenAmount: { uiAmount: 12, decimals: 5 } } } },
        },
      },
      {
        account: {
          data: { parsed: { info: { mint: "nftMint", tokenAmount: { uiAmount: 1, decimals: 0 } } } },
        },
      },
      {
        account: {
          data: { parsed: { info: { mint: "dust", tokenAmount: { uiAmount: 0, decimals: 6 } } } },
        },
      },
    ];
    expect(parseParsedTokenAccounts(rows)).toEqual([{ mint: "bonkMint", amount: 12, decimals: 5 }]);
  });
});

describe("lookupSymbols", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("maps mint ids from a Jupiter search batch", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ id: "mintA", symbol: "BONK" }],
    });
    const map = await lookupSymbols(["mintA"]);
    expect(map.get("mintA")).toBe("BONK");
    expect(String(fetchMock.mock.calls[0][0])).toContain("mintA");
  });
});
