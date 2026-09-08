import { describe, it, expect } from "vitest";
import {
  DEFAULT_X_USERNAME,
  X_MAX_RESULTS,
  escapeHtml,
  formatXPost,
  isOriginalTweet,
  originalsOldestFirst,
  planTick,
  xShareFromEnv,
  type Tweet,
} from "../src/x-share.ts";

describe("xShareFromEnv", () => {
  it("is off without a bearer", () => {
    expect(xShareFromEnv({})).toBeNull();
  });

  it("defaults the official handle", () => {
    expect(xShareFromEnv({ TWITTER_BEARER_TOKEN: "  tok  " })).toEqual({
      bearer: "tok",
      username: DEFAULT_X_USERNAME,
    });
    expect(
      xShareFromEnv({ TWITTER_BEARER_TOKEN: "tok", TWITTER_USERNAME: "@Other" }),
    ).toEqual({ bearer: "tok", username: "Other" });
  });
});

describe("escapeHtml", () => {
  it("escapes Telegram HTML", () => {
    expect(escapeHtml("a <b> & c")).toBe("a &lt;b&gt; &amp; c");
  });
});

describe("originals", () => {
  it("drops quote tweets and sorts oldest first", () => {
    const tweets: Tweet[] = [
      { id: "3", text: "new" },
      { id: "1", text: "old" },
      { id: "2", text: "quote", referenced_tweets: [{ type: "quoted" }] },
    ];
    expect(originalsOldestFirst(tweets).map((t) => t.id)).toEqual(["1", "3"]);
    expect(isOriginalTweet(tweets[2])).toBe(false);
  });
});

describe("formatXPost", () => {
  it("uses the x.com status link for preview, not t.co", () => {
    const text = formatXPost("ngmi_markets", {
      id: "99",
      text: "hello <x> https://t.co/h8sM1PR3s8",
    });
    expect(text).toBe(
      "New post! You know what to do ) 🚀🚀\n\nhello &lt;x&gt;\n\nhttps://x.com/ngmi_markets/status/99",
    );
    expect(text).not.toContain("t.co");
    expect(text).not.toContain("New post from");
    expect(text).not.toContain("Feedback from");
  });

  it("still posts a preview link when the tweet is only a t.co url", () => {
    const text = formatXPost("ngmi_cto", { id: "1", text: "https://t.co/abc" });
    expect(text).toBe("New post! You know what to do ) 🚀🚀\n\nhttps://x.com/ngmi_cto/status/1");
  });

  it("drops hidden solana: mints X injects after cashtags", () => {
    const text = formatXPost("ngmi_markets", {
      id: "2095160357316620685",
      text: "Head to our telegram for full details about taking part in our live devnet testing of our clawrena ansemhack entry #buildinpublic $SOL solana:zMXAUQvqHZfD8gLuXMaSmYc5J2VJzBcj565pHZvzBrC solana:739dnZEG4yaBWFsY8L8ZwrfhGG6dhtCSercW8Umspump @clawpumptech https://t.co/BhTEWhw1EC",
    });
    expect(text).toBe(
      "New post! You know what to do ) 🚀🚀\n\nHead to our telegram for full details about taking part in our live devnet testing of our clawrena ansemhack entry #buildinpublic $SOL @clawpumptech\n\nhttps://x.com/ngmi_markets/status/2095160357316620685",
    );
    expect(text).not.toContain("solana:");
  });
});

describe("planTick", () => {
  const tweets: Tweet[] = [{ id: "10", text: "a" }, { id: "20", text: "b" }];

  it("seeds on first run and does not send", () => {
    expect(planTick({}, tweets)).toEqual({ kind: "seed", lastSeenId: "20" });
  });

  it("idles when there is nothing new", () => {
    expect(planTick({ lastSeenId: "20" }, [])).toEqual({ kind: "idle" });
    expect(planTick({}, [])).toEqual({ kind: "idle" });
  });

  it("sends oldest-first after seed", () => {
    expect(planTick({ lastSeenId: "5" }, tweets)).toEqual({
      kind: "send",
      tweets: [
        { id: "10", text: "a" },
        { id: "20", text: "b" },
      ],
    });
  });
});

describe("cheap read shape", () => {
  it("uses the API minimum page size", () => {
    expect(X_MAX_RESULTS).toBe(5);
  });
});
