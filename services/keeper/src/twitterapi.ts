import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const BASE = "https://api.twitterapi.io";
const DEFAULT_USERNAME = "ngmi_cto";
const COOKIE_FILE = join(process.cwd(), "data", "twitterapi-cto.json");

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
  login_cookies?: string;
  data?: Record<string, unknown> & {
    status_code?: number;
    response?: { errors?: { code?: number; message?: string }[] };
    create_tweet?: { tweet_result?: { result?: { rest_id?: string } } };
  };
};

function trim(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v || undefined;
}

export function twitterApiFromEnv(env: NodeJS.ProcessEnv = process.env): TwitterApiConfig | null {
  const apiKey = trim(env.TWITTERAPI_API_KEY);
  if (!apiKey) return null;
  const username = (trim(env.TWITTER_CTO_USERNAME) || DEFAULT_USERNAME).replace(/^@/, "");
  const proxy = webshareProxyFromEnv(env);
  return {
    apiKey,
    username,
    email: trim(env.TWITTER_CTO_EMAIL),
    password: trim(env.TWITTER_CTO_PASSWORD),
    totpSecret: trim(env.TWITTER_CTO_TOTP_SECRET),
    cookie: trim(env.TWITTER_CTO_LOGIN_COOKIE) || readStoredCookie(),
    proxy,
  };
}

/** Sticky Webshare URL. Prefer `TWITTERAPI_PROXY`, else assemble from PROXY_* parts. */
export function webshareProxyFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const assembled = trim(env.TWITTERAPI_PROXY);
  if (assembled) return assembled.replace(/\/$/, "");
  const host = trim(env.PROXY_ADDRESS) || trim(env.PROXY_HOST);
  const port = trim(env.PROXY_PORT);
  const user = trim(env.PROXY_USERNAME) || trim(env.PROXY_USER);
  const pass = trim(env.PROXY_PASSWORD);
  if (host && port && user && pass) return `http://${user}:${pass}@${host}:${port}`;
  return undefined;
}

function readStoredCookie(): string | undefined {
  try {
    const raw = JSON.parse(readFileSync(COOKIE_FILE, "utf8")) as { login_cookies?: string };
    return trim(raw.login_cookies);
  } catch {
    return undefined;
  }
}

export function storeLoginCookie(cookie: string, file = COOKIE_FILE) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ login_cookies: cookie, obtainedAt: Date.now() }, null, 2));
}

function pickCookie(json: Envelope): string | undefined {
  return trim(json.login_cookies) || trim(json.login_cookie);
}

export function twitterApiLocked(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const env = json as Envelope;
  const errors = env.data?.response?.errors ?? [];
  if (errors.some((e) => e.code === 326)) return true;
  const blob = `${env.msg ?? ""} ${env.message ?? ""} ${env.detail ?? ""}`.toLowerCase();
  return blob.includes("temporarily locked") || blob.includes("code 326");
}

export function twitterApiNeedsLogin(json: unknown, httpStatus = 200): boolean {
  if (httpStatus === 401 || httpStatus === 403) return true;
  if (!json || typeof json !== "object") return httpStatus >= 500;
  const env = json as Envelope;
  const blob = `${env.status ?? ""} ${env.msg ?? ""} ${env.message ?? ""} ${env.detail ?? ""}`.toLowerCase();
  return /not logged|not login|please login|inactive|expired|invalid.*cookie|login_cookies/.test(blob);
}

function errorText(json: Envelope, httpStatus: number): string {
  const nested = json.data?.response?.errors?.map((e) => e.message).filter(Boolean).join("; ");
  return nested || json.msg || json.message || json.detail || json.status || `twitterapi ${httpStatus}`;
}

function outerFailed(json: Envelope, httpStatus: number): boolean {
  const status = String(json.status ?? "").toLowerCase();
  return httpStatus >= 400 || status === "error";
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

let loginGate: Promise<string> | null = null;

export async function loginCto(cfg: TwitterApiConfig): Promise<string> {
  if (!cfg.proxy) throw new Error("TWITTERAPI_PROXY required — sticky Webshare URL for @ngmi_cto");
  if (!cfg.email || !cfg.password) {
    throw new Error("TWITTER_CTO_EMAIL and TWITTER_CTO_PASSWORD required for v2 login");
  }
  const body: Record<string, string> = {
    user_name: cfg.username,
    email: cfg.email,
    password: cfg.password,
    proxy: cfg.proxy,
  };
  if (cfg.totpSecret) body.totp_secret = cfg.totpSecret;
  const { httpStatus, json } = await twitterFetch(cfg, "/twitter/user_login_v2", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (twitterApiLocked(json)) throw new Error(`login locked: ${errorText(json, httpStatus)}`);
  if (outerFailed(json, httpStatus)) {
    throw new Error(`login ${httpStatus}: ${errorText(json, httpStatus)}`);
  }
  const cookie = pickCookie(json);
  if (!cookie) throw new Error(`login missing login_cookies: ${errorText(json, httpStatus)}`);
  storeLoginCookie(cookie);
  cfg.cookie = cookie;
  return cookie;
}

async function ensureCookie(cfg: TwitterApiConfig): Promise<string> {
  if (cfg.cookie) return cfg.cookie;
  if (!loginGate) {
    loginGate = loginCto(cfg).finally(() => {
      loginGate = null;
    });
  }
  return loginGate;
}

function tweetIdFrom(json: Envelope): string | undefined {
  const nested = json.data?.create_tweet?.tweet_result?.result?.rest_id;
  if (typeof nested === "string" && nested) return nested;
  if (json.tweet_id) return json.tweet_id;
  const dataId = json.data && typeof json.data.tweet_id === "string" ? json.data.tweet_id : undefined;
  return dataId;
}

async function createTweetV2(cfg: TwitterApiConfig, cookie: string, text: string) {
  if (!cfg.proxy) throw new Error("TWITTERAPI_PROXY required on every v2 write");
  return twitterFetch(cfg, "/twitter/create_tweet_v2", {
    method: "POST",
    body: JSON.stringify({
      login_cookies: cookie,
      proxy: cfg.proxy,
      tweet_text: text.trim().slice(0, 280),
    }),
  });
}

/** Post as @ngmi_cto via twitterapi.io v2. Same sticky proxy on login and write. */
export async function postCtoTweet(cfg: TwitterApiConfig, text: string): Promise<string> {
  let cookie = await ensureCookie(cfg);
  let res = await createTweetV2(cfg, cookie, text);
  if (twitterApiLocked(res.json)) {
    throw new Error(`post locked: ${errorText(res.json, res.httpStatus)}`);
  }
  if (outerFailed(res.json, res.httpStatus) || twitterApiNeedsLogin(res.json, res.httpStatus)) {
    cookie = await loginCto(cfg);
    res = await createTweetV2(cfg, cookie, text);
  }
  if (twitterApiLocked(res.json)) {
    throw new Error(`post locked: ${errorText(res.json, res.httpStatus)}`);
  }
  if (outerFailed(res.json, res.httpStatus)) {
    throw new Error(`post ${res.httpStatus}: ${errorText(res.json, res.httpStatus)}`);
  }
  const id = tweetIdFrom(res.json);
  if (!id) throw new Error(`post missing tweet_id: ${errorText(res.json, res.httpStatus)}`);
  return id;
}
