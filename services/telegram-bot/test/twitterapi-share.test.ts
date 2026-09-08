import { describe, it, expect } from "vitest";
import {
  DEFAULT_CTO_USERNAME,
  EMPTY_SEED_ID,
  extractLastTweets,
  isOriginalTwitterApiTweet,
  originalsFromTwitterApi,
  planTwitterApiTick,
  toShareTweet,
  tweetIdGreater,
  twitterApiShareFromEnv,
  type TwitterApiTweet,
} from "../src/twitterapi-share.ts";

describe("twitterApiShareFromEnv", () => {
  it("is off without a TwitterAPI key", () => {
    expect(twitterApiShareFromEnv({})).toBeNull();
  });

  it("defaults the CTO handle", () => {
    expect(twitterApiShareFromEnv({ TWITTERAPI_API_KEY: "  key  " })).toEqual({
      apiKey: "key",
      username: DEFAULT_CTO_USERNAME,
    });
    expect(
      twitterApiShareFromEnv({
        TWITTERAPI_API_KEY: "key",
        TWITTERAPI_CTO_USERNAME: "@Other",
      }),
    ).toEqual({ apiKey: "key", username: "Other" });
  });
});

describe("extractLastTweets", () => {
  it("reads data.tweets from the live last_tweets payload", () => {
    expect(
      extractLastTweets({
        status: "success",
        data: { pin_tweet: null, tweets: [{ id: "1", text: "hi" }] },
      }),
    ).toEqual([{ id: "1", text: "hi" }]);
  });

  it("reads the docs-shaped tweets array", () => {
    expect(extractLastTweets({ tweets: [{ id: "2" }] })).toEqual([{ id: "2" }]);
  });
});

describe("originals", () => {
  const raw: TwitterApiTweet[] = [
    { id: "30", text: "new" },
    { id: "10", text: "old" },
    { id: "20", text: "quote", quoted_tweet: { id: "9" } },
    { id: "21", text: "rt", retweeted_tweet: { id: "8" } },
    { id: "22", text: "reply", isReply: true },
    { text: "no id" },
  ];

  it("drops replies, retweets, and quotes, oldest first", () => {
    expect(originalsFromTwitterApi(raw).map((t) => t.id)).toEqual(["10", "30"]);
    expect(isOriginalTwitterApiTweet(raw[2])).toBe(false);
    expect(toShareTweet(raw[0])).toEqual({ id: "30", text: "new" });
  });
});

describe("tweetIdGreater", () => {
  it("compares snowflake ids as integers", () => {
    expect(tweetIdGreater("20", "3")).toBe(true);
    expect(tweetIdGreater("3", EMPTY_SEED_ID)).toBe(true);
    expect(tweetIdGreater("10", "10")).toBe(false);
  });
});

describe("planTwitterApiTick", () => {
  const tweets = [
    { id: "10", text: "a" },
    { id: "20", text: "b" },
  ];

  it("seeds the newest id on first run and does not send", () => {
    expect(planTwitterApiTick({}, tweets)).toEqual({
      kind: "seed",
      lastSeenId: "20",
    });
  });

  it("seeds zero when the timeline is empty so the first later tweet is sent", () => {
    expect(planTwitterApiTick({}, [])).toEqual({
      kind: "seed",
      lastSeenId: EMPTY_SEED_ID,
    });
  });

  it("idles when nothing is newer than lastSeenId", () => {
    expect(planTwitterApiTick({ lastSeenId: "20" }, tweets)).toEqual({
      kind: "idle",
    });
    expect(planTwitterApiTick({ lastSeenId: EMPTY_SEED_ID }, [])).toEqual({
      kind: "idle",
    });
  });

  it("sends only tweets after lastSeenId, oldest first", () => {
    expect(planTwitterApiTick({ lastSeenId: "10" }, tweets)).toEqual({
      kind: "send",
      tweets: [{ id: "20", text: "b" }],
    });
    expect(planTwitterApiTick({ lastSeenId: EMPTY_SEED_ID }, tweets)).toEqual({
      kind: "send",
      tweets: [{ id: "20", text: "b" }],
    });
  });
});
