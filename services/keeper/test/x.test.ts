import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildAuthorizeUrl,
  postTweet,
  tokensFromGrant,
  tokensNeedRefresh,
  xAppFromEnv,
  X_SCOPES,
} from "../src/x.ts";

describe("xAppFromEnv", () => {
  it("fails closed without client credentials", () => {
    expect(xAppFromEnv({})).toBeNull();
    expect(xAppFromEnv({ X_CLIENT_ID: "id" })).toBeNull();
  });

  it("defaults the localhost callback", () => {
    const cfg = xAppFromEnv({ X_CLIENT_ID: "id", X_CLIENT_SECRET: "sec" });
    expect(cfg?.redirectUri).toBe("http://localhost:3000/api/oauth/x/callback");
  });
});

describe("buildAuthorizeUrl", () => {
  it("uses x.com and the required scope order", () => {
    const url = buildAuthorizeUrl(
      { clientId: "id", redirectUri: "http://localhost:3000/api/oauth/x/callback" },
      { state: "s", codeChallenge: "c" },
    );
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(parsed.searchParams.get("scope")).toBe(X_SCOPES.join(" "));
    expect(url).not.toContain("twitter.com/i/oauth2");
  });
});

describe("tokensNeedRefresh", () => {
  it("refreshes inside the skew window", () => {
    expect(tokensNeedRefresh({ accessToken: "a", refreshToken: "r", expiresAt: 1_000 }, 900, 200)).toBe(
      true,
    );
    expect(tokensNeedRefresh({ accessToken: "a", refreshToken: "r", expiresAt: 2_000 }, 900, 200)).toBe(
      false,
    );
  });
});

describe("tokensFromGrant", () => {
  it("keeps the previous refresh token when X omits a new one", () => {
    const tokens = tokensFromGrant(
      { access_token: "n", expires_in: 10 },
      { refreshToken: "old" },
      0,
    );
    expect(tokens).toMatchObject({ accessToken: "n", refreshToken: "old", expiresAt: 10_000 });
  });
});

describe("postTweet", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("returns the tweet id", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "123" } }),
    });
    await expect(postTweet("tok", "hello")).resolves.toBe("123");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.twitter.com/2/tweets");
  });

  it("surfaces a 403", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ detail: "client-not-enrolled" }),
    });
    await expect(postTweet("tok", "hello")).rejects.toThrow(/403/);
  });
});
