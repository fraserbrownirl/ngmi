const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
const TWEETS_URL = "https://api.twitter.com/2/tweets";

/** Scope order matters — wrong order can silently drop tweet.write. */
export const X_SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access"] as const;

export type XAppConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type XOAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope?: string;
  username?: string;
  userId?: string;
};

export function xOAuthRedirectUri(env: NodeJS.ProcessEnv = process.env): string {
  if (env.X_OAUTH_REDIRECT_URI) return env.X_OAUTH_REDIRECT_URI.replace(/\/$/, "");
  const base =
    env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : "http://localhost:3000");
  return `${base}/api/oauth/x/callback`;
}

export function xAppFromEnv(env: NodeJS.ProcessEnv = process.env): XAppConfig | null {
  const clientId = env.X_CLIENT_ID?.trim();
  const clientSecret = env.X_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: xOAuthRedirectUri(env) };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const verifier = bytesToBase64Url(bytes);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: bytesToBase64Url(new Uint8Array(digest)) };
}

export function buildAuthorizeUrl(
  config: Pick<XAppConfig, "clientId" | "redirectUri">,
  opts: { state: string; codeChallenge: string },
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: X_SCOPES.join(" "),
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTHORIZE_URL}?${params}`;
}

function basicAuth(config: XAppConfig): string {
  return `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`;
}

async function tokenRequest(config: XAppConfig, body: URLSearchParams) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuth(config),
    },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(`token ${res.status}: ${json.error_description ?? json.error ?? JSON.stringify(json)}`);
  }
  return json as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
}

export function tokensFromGrant(
  grant: { access_token: string; refresh_token?: string; expires_in?: number; scope?: string },
  prev?: Pick<XOAuthTokens, "refreshToken">,
  now = Date.now(),
): XOAuthTokens {
  const refreshToken = grant.refresh_token ?? prev?.refreshToken;
  if (!refreshToken) throw new Error("token response missing refresh_token");
  return {
    accessToken: grant.access_token,
    refreshToken,
    expiresAt: now + (grant.expires_in ?? 7200) * 1000,
    scope: grant.scope,
  };
}

export async function exchangeCode(config: XAppConfig, code: string, codeVerifier: string) {
  return tokenRequest(
    config,
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      code_verifier: codeVerifier,
    }),
  );
}

export async function refreshAccessToken(config: XAppConfig, refreshToken: string) {
  return tokenRequest(
    config,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  );
}

export function tokensNeedRefresh(tokens: XOAuthTokens, now = Date.now(), skewMs = 60_000): boolean {
  return tokens.expiresAt - skewMs <= now;
}

export async function postTweet(accessToken: string, text: string): Promise<string> {
  const res = await fetch(TWEETS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: text.trim().slice(0, 280) }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: { id?: string };
    detail?: string;
    title?: string;
  };
  if (!res.ok || !json.data?.id) {
    throw new Error(`post ${res.status}: ${json.detail ?? json.title ?? JSON.stringify(json)}`);
  }
  return json.data.id;
}
