import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isTwitterApiActive,
  postCtoTweet,
  twitterApiFromEnv,
  twitterApiNeedsLogin,
} from "../src/twitterapi.ts";

const CFG = {
  apiKey: "k",
  username: "ngmi_cto",
  email: "a@b.c",
  password: "p",
  totpSecret: "SECRET",
  proxy: "http://user:pass@host:1111",
};

describe("twitterApiFromEnv", () => {
  it("fails closed without an API key", () => {
    expect(twitterApiFromEnv({})).toBeNull();
    expect(twitterApiFromEnv({ TWITTER_CTO_USERNAME: "ngmi_cto" })).toBeNull();
  });

  it("defaults the CTO handle and reads the session cookie", () => {
    const cfg = twitterApiFromEnv({
      TWITTERAPI_API_KEY: " k ",
      TWITTER_CTO_AUTH_TOKEN: "tok",
      TWITTER_CTO_CT0: "csrf",
    });
    expect(cfg).toMatchObject({
      apiKey: "k",
      username: "ngmi_cto",
      cookie: "ct0=csrf&auth_token=tok",
    });
  });
});

describe("isTwitterApiActive", () => {
  it("reads the inner account status", () => {
    expect(isTwitterApiActive({ status: "success", data: { status: "Active" } })).toBe(true);
    expect(isTwitterApiActive({ status: "success", data: { status: "Pending" } })).toBe(false);
    expect(isTwitterApiActive({ status: "error" })).toBe(false);
  });
});

describe("twitterApiNeedsLogin", () => {
  it("treats auth failures and login copy as a session miss", () => {
    expect(twitterApiNeedsLogin({ msg: "please login first" }, 400)).toBe(true);
    expect(twitterApiNeedsLogin({}, 401)).toBe(true);
    expect(twitterApiNeedsLogin({ msg: "rate limited" }, 429)).toBe(false);
  });
});

describe("postCtoTweet", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("posts v3 with username after a live session", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({ status: "success", tweet_id: "99" }),
    });
    await expect(postCtoTweet(CFG, "hello")).resolves.toBe("99");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.twitterapi.io/twitter/send_tweet_v3");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body).toEqual({ user_name: "ngmi_cto", text: "hello" });
  });

  it("logs in once when the session is missing, then retries", async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 400,
        json: async () => ({ status: "error", msg: "please login first" }),
      })
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({ status: "success", data: { status: "Inactive" } }),
      })
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({ status: "success" }),
      })
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({ status: "success", data: { status: "Active" } }),
      })
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({ status: "success", tweet_id: "100" }),
      });
    await expect(postCtoTweet(CFG, "hello")).resolves.toBe("100");
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain("https://api.twitterapi.io/twitter/user_login_v3");
    expect(urls.filter((u) => u.includes("send_tweet_v3"))).toHaveLength(2);
  });
});
