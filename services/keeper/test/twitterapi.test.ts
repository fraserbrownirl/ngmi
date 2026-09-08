import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  postCtoTweet,
  twitterApiFromEnv,
  twitterApiLocked,
  twitterApiNeedsLogin,
  webshareProxyFromEnv,
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

  it("assembles the sticky Webshare URL from parts", () => {
    expect(
      webshareProxyFromEnv({
        PROXY_ADDRESS: "191.96.254.138",
        PROXY_PORT: "6185",
        PROXY_USERNAME: "krmundnw",
        PROXY_PASSWORD: "secret",
      }),
    ).toBe("http://krmundnw:secret@191.96.254.138:6185");
  });
});

describe("twitterApiLocked", () => {
  it("treats X 326 as a lock", () => {
    expect(twitterApiLocked({ data: { response: { errors: [{ code: 326 }] } } })).toBe(true);
    expect(twitterApiLocked({ status: "success" })).toBe(false);
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

  it("posts v2 with login_cookies and the same proxy", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({ status: "success", tweet_id: "99" }),
    });
    await expect(postCtoTweet({ ...CFG, cookie: "cook" }, "hello")).resolves.toBe("99");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.twitterapi.io/twitter/create_tweet_v2");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body).toEqual({
      login_cookies: "cook",
      proxy: CFG.proxy,
      tweet_text: "hello",
    });
  });

  it("logs in via v2 when the cookie is missing, then posts", async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({ status: "success", login_cookies: "newcook" }),
      })
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({ status: "success", tweet_id: "100" }),
      });
    await expect(postCtoTweet(CFG, "hello")).resolves.toBe("100");
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toBe("https://api.twitterapi.io/twitter/user_login_v2");
    const login = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(login).toMatchObject({
      user_name: "ngmi_cto",
      email: "a@b.c",
      totp_secret: "SECRET",
      proxy: CFG.proxy,
    });
    expect(urls[1]).toBe("https://api.twitterapi.io/twitter/create_tweet_v2");
  });
});
