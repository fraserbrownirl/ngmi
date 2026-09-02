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
  it("is text plus an x.com link, not a feedback card", () => {
    const text = formatXPost("ngmidotmarkets", { id: "99", text: "hello <x>" });
    expect(text).toContain("New post from @ngmidotmarkets:");
    expect(text).toContain("hello &lt;x&gt;");
    expect(text).toContain("https://x.com/ngmidotmarkets/status/99");
    expect(text).not.toContain("Feedback from");
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
