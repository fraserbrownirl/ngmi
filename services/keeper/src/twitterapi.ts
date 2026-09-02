const BASE = "https://api.twitterapi.io";
const DEFAULT_USERNAME = "ngmi_cto";
const LOGIN_WAIT_MS = 90_000;
const LOGIN_POLL_MS = 3_000;

export type TwitterApiConfig = {
  apiKey: string;
  username: string;
  email?: string;
  password?: string;
  totpSecret?: string;
  cookie?: string;
  proxy?: string;
};

type Envelope = {
  status?: string;
  msg?: string;
  message?: string;
  detail?: string;
  tweet_id?: string;
  login_cookie?: string;
  data?: Record<string, unknown>;
};

function trim(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v || undefined;
}

function sessionCookie(env: NodeJS.ProcessEnv): string | undefined {
  const auth = trim(env.TWITTER_CTO_AUTH_TOKEN);
  if (!auth) return undefined;
  const ct0 = trim(env.TWITTER_CTO_CT0);
  return ct0 ? `ct0=${ct0}&auth_token=${auth}` : `auth_token=${auth}`;
}

export function twitterApiFromEnv(env: NodeJS.ProcessEnv = process.env): TwitterApiConfig | null {
  const apiKey = trim(env.TWITTERAPI_API_KEY);
  if (!apiKey) return null;
  const username = (trim(env.TWITTER_CTO_USERNAME) || DEFAULT_USERNAME).replace(/^@/, "");
  return {
    apiKey,
    username,
    email: trim(env.TWITTER_CTO_EMAIL),
    password: trim(env.TWITTER_CTO_PASSWORD),
    totpSecret: trim(env.TWITTER_CTO_TOTP_SECRET),
    cookie: sessionCookie(env),
    proxy: trim(env.TWITTERAPI_PROXY),
  };
}

function innerStatus(json: Envelope): string {
  const data = json.data;
  const raw = data?.status ?? data?.account_status ?? data?.state ?? json.status;
  return String(raw ?? "").toLowerCase();
}

export function isTwitterApiActive(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  return innerStatus(json as Envelope) === "active";
}

export function twitterApiNeedsLogin(json: unknown, httpStatus = 200): boolean {
  if (httpStatus === 401 || httpStatus === 403) return true;
  if (!json || typeof json !== "object") return httpStatus >= 500;
  const env = json as Envelope;
  const blob = `${env.status ?? ""} ${env.msg ?? ""} ${env.message ?? ""} ${env.detail ?? ""}`.toLowerCase();
  return /not logged|not login|please login|inactive|no account|not found|unauthor|cookie/.test(blob);
}

function errorText(json: Envelope, httpStatus: number): string {
  return json.msg || json.message || json.detail || json.status || `twitterapi ${httpStatus}`;
}

async function twitterFetch(
  cfg: TwitterApiConfig,
  path: string,
  init: RequestInit = {},
): Promise<{ httpStatus: number; json: Envelope }> {
  const headers = new Headers(init.headers);
  headers.set("X-API-Key", cfg.apiKey);
  headers.set("x-api-key", cfg.apiKey);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const json = (await res.json().catch(() => ({}))) as Envelope;
  return { httpStatus: res.status, json };
}

async function accountDetail(cfg: TwitterApiConfig): Promise<{ httpStatus: number; json: Envelope }> {
  const params = new URLSearchParams({ user_name: cfg.username });
  return twitterFetch(cfg, `/twitter/get_my_x_account_detail_v3?${params}`);
}

let loginGate: Promise<void> | null = null;

async function loginV3(cfg: TwitterApiConfig): Promise<void> {
  if (!cfg.proxy) {
    throw new Error("TWITTERAPI_PROXY required for first @ngmi_cto login");
  }
  if (!cfg.cookie && (!cfg.email || !cfg.password)) {
    throw new Error("TWITTER_CTO_EMAIL and TWITTER_CTO_PASSWORD required when no auth cookie");
  }
  const body: Record<string, string> = {
    user_name: cfg.username,
    proxy: cfg.proxy,
  };
  if (cfg.cookie) body.cookie = cfg.cookie;
  else {
    if (cfg.email) body.email = cfg.email;
    if (cfg.password) body.password = cfg.password;
  }
  if (cfg.totpSecret) body.totp_code = cfg.totpSecret;
  const { httpStatus, json } = await twitterFetch(cfg, "/twitter/user_login_v3", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const status = String(json.status ?? "").toLowerCase();
  if (httpStatus >= 400 || status === "error") {
    throw new Error(`login ${httpStatus}: ${errorText(json, httpStatus)}`);
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function waitUntilActive(cfg: TwitterApiConfig, now = Date.now): Promise<void> {
  const deadline = now() + LOGIN_WAIT_MS;
  while (now() < deadline) {
    const { json } = await accountDetail(cfg);
    if (isTwitterApiActive(json)) return;
    await sleep(LOGIN_POLL_MS);
  }
  throw new Error("twitterapi login did not become Active");
}

export async function ensureTwitterApiLogin(cfg: TwitterApiConfig): Promise<void> {
  const { json } = await accountDetail(cfg);
  if (isTwitterApiActive(json)) return;
  if (!loginGate) {
    loginGate = (async () => {
      await loginV3(cfg);
      await waitUntilActive(cfg);
    })().finally(() => {
      loginGate = null;
    });
  }
  await loginGate;
}

async function sendTweetV3(cfg: TwitterApiConfig, text: string): Promise<{
  httpStatus: number;
  json: Envelope;
}> {
  return twitterFetch(cfg, "/twitter/send_tweet_v3", {
    method: "POST",
    body: JSON.stringify({ user_name: cfg.username, text: text.trim().slice(0, 280) }),
  });
}

function queuedId(json: Envelope): string {
  const data = json.data;
  const fromData = data && typeof data.tweet_id === "string" ? data.tweet_id : undefined;
  return json.tweet_id || fromData || "queued";
}

/** Post as the CTO account. Logs in once if TwitterAPI.io has no Active session. */
export async function postCtoTweet(cfg: TwitterApiConfig, text: string): Promise<string> {
  const first = await sendTweetV3(cfg, text);
  const firstStatus = String(first.json.status ?? "").toLowerCase();
  if (first.httpStatus < 400 && firstStatus !== "error") return queuedId(first.json);
  if (!twitterApiNeedsLogin(first.json, first.httpStatus) && first.httpStatus < 500) {
    throw new Error(`post ${first.httpStatus}: ${errorText(first.json, first.httpStatus)}`);
  }
  await ensureTwitterApiLogin(cfg);
  const retry = await sendTweetV3(cfg, text);
  const retryStatus = String(retry.json.status ?? "").toLowerCase();
  if (retry.httpStatus >= 400 || retryStatus === "error") {
    throw new Error(`post ${retry.httpStatus}: ${errorText(retry.json, retry.httpStatus)}`);
  }
  return queuedId(retry.json);
}
