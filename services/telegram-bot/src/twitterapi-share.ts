import type { Bot } from "grammy";
import {
  startTweetShare,
  type ShareState,
  type TickPlan,
  type Tweet,
} from "./x-share.ts";

export const TWITTERAPI_BASE = "https://api.twitterapi.io";
export const DEFAULT_CTO_USERNAME = "ngmi_cto";
/** Snowflake "zero" — first future original after an empty seed is posted, not skipped. */
export const EMPTY_SEED_ID = "0";

export type TwitterApiShareEnv = {
  apiKey: string;
  username: string;
};

export type TwitterApiTweet = {
  id?: string;
  text?: string;
  isReply?: boolean;
  quoted_tweet?: unknown;
  retweeted_tweet?: unknown;
};

export function twitterApiShareFromEnv(
  env: Record<string, string | undefined>,
): TwitterApiShareEnv | null {
  const apiKey = env.TWITTERAPI_API_KEY?.trim();
  if (!apiKey) return null;
  const username = (env.TWITTERAPI_CTO_USERNAME?.trim() || DEFAULT_CTO_USERNAME).replace(
    /^@/,
    "",
  );
  return { apiKey, username };
}

export function extractLastTweets(body: unknown): TwitterApiTweet[] {
  if (!body || typeof body !== "object") return [];
  const rec = body as { tweets?: unknown; data?: { tweets?: unknown } };
  if (Array.isArray(rec.tweets)) return rec.tweets as TwitterApiTweet[];
  if (Array.isArray(rec.data?.tweets)) return rec.data.tweets as TwitterApiTweet[];
  return [];
}

export function isOriginalTwitterApiTweet(tweet: TwitterApiTweet): boolean {
  if (!tweet.id) return false;
  if (tweet.isReply) return false;
  if (tweet.retweeted_tweet) return false;
  if (tweet.quoted_tweet) return false;
  return true;
}

export function toShareTweet(tweet: TwitterApiTweet): Tweet | null {
  if (!isOriginalTwitterApiTweet(tweet) || !tweet.id) return null;
  return { id: tweet.id, text: tweet.text };
}

export function tweetIdGreater(a: string, b: string): boolean {
  try {
    return BigInt(a) > BigInt(b);
  } catch {
    return a > b;
  }
}

export function originalsFromTwitterApi(raw: TwitterApiTweet[]): Tweet[] {
  const out: Tweet[] = [];
  for (const t of raw) {
    const mapped = toShareTweet(t);
    if (mapped) out.push(mapped);
  }
  return out.sort((a, b) => (tweetIdGreater(a.id, b.id) ? 1 : tweetIdGreater(b.id, a.id) ? -1 : 0));
}

export function planTwitterApiTick(state: ShareState, tweets: Tweet[]): TickPlan {
  const originals = [...tweets].sort((a, b) =>
    tweetIdGreater(a.id, b.id) ? 1 : tweetIdGreater(b.id, a.id) ? -1 : 0,
  );
  if (!state.lastSeenId) {
    if (originals.length === 0) return { kind: "seed", lastSeenId: EMPTY_SEED_ID };
    return { kind: "seed", lastSeenId: originals[originals.length - 1].id };
  }
  const newer = originals.filter((t) => tweetIdGreater(t.id, state.lastSeenId as string));
  if (newer.length === 0) return { kind: "idle" };
  return { kind: "send", tweets: newer };
}

async function twitterApiGet(
  path: string,
  apiKey: string,
  params: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${TWITTERAPI_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "X-API-Key": apiKey } });
  const json = (await res.json().catch(() => ({}))) as {
    status?: string;
    msg?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(
      `twitterapi ${res.status}: ${json.msg ?? json.message ?? "request failed"}`,
    );
  }
  if (json.status === "error") {
    throw new Error(`twitterapi: ${json.msg ?? json.message ?? "request failed"}`);
  }
  return json;
}

export async function resolveTwitterApiUserId(
  username: string,
  apiKey: string,
  cached?: string,
): Promise<string> {
  if (cached) return cached;
  const json = (await twitterApiGet("/twitter/user/info", apiKey, {
    userName: username,
  })) as { data?: { id?: string; userName?: string } };
  const id = json.data?.id;
  if (!id) throw new Error(`twitterapi: Could not find user @${username}`);
  return id;
}

export async function fetchLastOriginals(
  userId: string,
  apiKey: string,
): Promise<Tweet[]> {
  const json = await twitterApiGet("/twitter/user/last_tweets", apiKey, {
    userId,
    includeReplies: "false",
  });
  return originalsFromTwitterApi(extractLastTweets(json));
}

export type StartTwitterApiShareOpts = {
  bot: Bot;
  apiKey: string;
  username: string;
  groupId: string;
  statePath: string;
  pollMs?: number;
  log?: (msg: string) => void;
};

export function startTwitterApiShare(
  opts: StartTwitterApiShareOpts,
): { stop: () => void; rememberChat: (chatId: string) => void } {
  return startTweetShare({
    bot: opts.bot,
    username: opts.username,
    groupId: opts.groupId,
    statePath: opts.statePath,
    pollMs: opts.pollMs,
    log: opts.log,
    logLabel: `cto share @${opts.username.replace(/^@/, "")}`,
    plan: planTwitterApiTick,
    haltPattern:
      /Could not find user|401|402|403|Unauthorized|Payment Required/i,
    fetchTick: async (state) => {
      const userId = await resolveTwitterApiUserId(
        opts.username,
        opts.apiKey,
        state.userId,
      );
      const tweets = await fetchLastOriginals(userId, opts.apiKey);
      return {
        tweets,
        patch: state.userId === userId ? undefined : { userId },
      };
    },
  });
}
