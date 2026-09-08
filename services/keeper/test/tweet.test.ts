import { describe, it, expect } from "vitest";
import { composeAnnounce, composeBet, displayName, fitTickers, formatMarkUsd, formatPct, handleTag, percentNeeded, shortWallet, tickerTag, TWEET_MAX } from "../src/tweet.ts";

describe("percentNeeded", () => {
  it("is the extra percent of current PnL to hit the mark", () => {
    expect(percentNeeded(40_000, 50_000)).toBe(25);
    expect(percentNeeded(50_000, 50_000)).toBe(0);
    expect(percentNeeded(0, 50_000)).toBeNull();
  });

  it("formats under 10% with one decimal", () => {
    expect(formatPct(4.2)).toBe("4.2%");
    expect(formatPct(25)).toBe("25%");
  });
});

describe("formatMarkUsd", () => {
  it("compacts thousands and millions", () => {
    expect(formatMarkUsd(1250)).toBe("$1,250");
    expect(formatMarkUsd(12_500)).toBe("$12.5k");
    expect(formatMarkUsd(50_000)).toBe("$50k");
    expect(formatMarkUsd(1_250_000)).toBe("$1.25M");
  });
});

describe("tickerTag", () => {
  it("normalizes to $TICKER", () => {
    expect(tickerTag("bonk")).toBe("$BONK");
    expect(tickerTag("$WIF")).toBe("$WIF");
    expect(tickerTag("??")).toBeNull();
  });
});

describe("fitTickers", () => {
  it("sorts and dedupes", () => {
    expect(fitTickers(["WIF", "bonk", "WIF"], 80)).toBe("$BONK $WIF");
  });

  it("truncates with a remainder count", () => {
    const many = ["AA", "BB", "CC", "DD", "EE", "FF"];
    expect(fitTickers(many, 16)).toMatch(/\+\d+$/);
  });
});

describe("composeAnnounce", () => {
  it("opens with name, holdings, PnL, and percent needed", () => {
    const text = composeAnnounce({
      kind: "opened",
      handle: "ansem",
      name: "Ansem",
      thresholdUsd: 50_000,
      pnlUsd: 40_000,
      tickers: ["BONK", "WIF"],
    });
    expect(text).toBe(
      "Is Ansem gonna make to $50k in 3 days or NGMI! Place your bets!! Ansem is currently holding $BONK $WIF with a PNL of $40k (25% needed to make it)",
    );
    expect(text.length).toBeLessThanOrEqual(TWEET_MAX);
  });

  it("falls back to handle when name is missing", () => {
    const text = composeAnnounce({
      kind: "opened",
      handle: "ansem",
      thresholdUsd: 50_000,
      pnlUsd: 40_000,
      tickers: [],
    });
    expect(text.startsWith("Is ansem gonna make to $50k")).toBe(true);
  });

  it("says YES or NO on close", () => {
    expect(
      composeAnnounce({ kind: "yes", handle: "ansem", thresholdUsd: 100, tickers: [] }),
    ).toContain("YES — @ansem printed over $100.");
    expect(
      composeAnnounce({ kind: "no", handle: "ansem", thresholdUsd: 100, tickers: [] }),
    ).toContain("NO — @ansem missed $100.");
  });

  it("stays inside 280 with a long ticker list", () => {
    const tickers = Array.from({ length: 80 }, (_, i) => `T${i}COIN`);
    const text = composeAnnounce({
      kind: "opened",
      handle: "verylonghandlethatkeepsgoing",
      name: "Very Long Display Name",
      thresholdUsd: 12_345_678,
      pnlUsd: 1_000_000,
      tickers,
    });
    expect(text.length).toBeLessThanOrEqual(TWEET_MAX);
    expect(text).toContain("is currently holding");
    expect(text).toContain("needed to make it");
  });
});

describe("composeBet", () => {
  it("includes side, stake, mark, wallet, and book", () => {
    const text = composeBet({
      handle: "ansem",
      name: "Ansem",
      thresholdUsd: 50_000,
      side: "yes",
      amountUsd: 25,
      wallet: "7xK2abcdEFGHijkmMNPQ",
      yesPoolUsd: 145,
      noPoolUsd: 80,
    });
    expect(text).toBe("BET $25 YES — Ansem to $50k\n7xK2…MNPQ · YES $145 / NO $80");
    expect(text.length).toBeLessThanOrEqual(TWEET_MAX);
  });

  it("shortens wallets", () => {
    expect(shortWallet("abcd")).toBe("abcd");
    expect(shortWallet("7xK2abcdEFGHijkmMNPQ")).toBe("7xK2…MNPQ");
  });
});

describe("sanitize (F-04)", () => {
  it("handleTag rejects anything that is not an X handle", () => {
    expect(handleTag("ansem")).toBe("@ansem");
    expect(handleTag("@ansem")).toBe("@ansem");
    expect(handleTag("evil\nhttp://scam.example")).toBe("@unknown");
    expect(handleTag("waytoolongtobeanxhandle")).toBe("@unknown");
    expect(handleTag("with space")).toBe("@unknown");
    expect(handleTag("")).toBe("@unknown");
  });

  it("displayName strips control chars and @ mentions", () => {
    expect(displayName("Ansem", "ansem")).toBe("Ansem");
    expect(displayName("Foo\n@bar", "ansem")).toBe("Foo bar");
    expect(displayName("a".repeat(80), "ansem")).toHaveLength(50);
    expect(displayName("\n@ ", "ansem")).toBe("ansem");
    expect(displayName(null, "not a handle!")).toBe("this trader");
  });

  it("shortWallet strips non-base58 characters", () => {
    expect(shortWallet("7xK2\nabcd")).toBe("7xK2abcd");
    expect(shortWallet("0OI l")).toBe("unknown");
  });

  it("composeAnnounce cannot be broken out of by a hostile name", () => {
    const text = composeAnnounce({
      kind: "opened",
      handle: "evil\nhttp://scam.example",
      name: "@vitalik\nclick http://scam.example",
      thresholdUsd: 100,
      pnlUsd: 50,
      tickers: [],
    });
    expect(text).not.toContain("\n");
    expect(text).not.toContain("@vitalik");
    expect(text).not.toContain("scam.example");
  });

  it("composeBet yes/no tweets reject a hostile handle", () => {
    const text = composeAnnounce({
      kind: "yes",
      handle: "evil\nhttp://scam.example",
      thresholdUsd: 100,
      tickers: [],
    });
    expect(text).toContain("YES — @unknown printed over $100.");
  });
});
