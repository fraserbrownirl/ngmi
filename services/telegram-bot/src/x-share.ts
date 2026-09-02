import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Bot } from "grammy";

export const X_API = "https://api.twitter.com/2";
export const DEFAULT_X_USERNAME = "ngmidotmarkets";
/** Slow poll: each empty read still costs. 15 min is the cheap public-Bearer cadence. */
export const X_POLL_MS = 15 * 60 * 1000;
/** X v2 minimum for this endpoint. */
export const X_MAX_RESULTS = 5;

export type Tweet = {
  id: string;
  text?: string;
  referenced_tweets?: { type: string }[];
};

export type ShareState = {
  lastSeenId?: string;
  userId?: string;
  chatId?: string;
};

export type ShareEnv = {
  bearer: string;
  username: string;
};

export function xShareFromEnv(
  env: Record<string, string | undefined>,
): ShareEnv | null {
  const bearer = env.TWITTER_BEARER_TOKEN?.trim();
  if (!bearer) return null;
  const username = (env.TWITTER_USERNAME?.trim() || DEFAULT_X_USERNAME).replace(/^@/, "");
  return { bearer, username };
}

export function loadShareState(path: string): ShareState {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ShareState;
  } catch {
    return {};
  }
}

export function saveShareState(path: string, state: ShareState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state)}\n`);
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function isOriginalTweet(tweet: Tweet): boolean {
  return !(tweet.referenced_tweets ?? []).some((r) => r.type === "quoted");
}

export function originalsOldestFirst(tweets: Tweet[]): Tweet[] {
  return tweets.filter(isOriginalTweet).sort((a, b) => a.id.localeCompare(b.id));
}

export function formatXPost(username: string, tweet: Tweet): string {
  const body = escapeHtml((tweet.text ?? "").trim());
  const handle = escapeHtml(username.replace(/^@/, ""));
  const link = `https://x.com/${handle}/status/${tweet.id}`;
  return `New post from @${handle}:\n\n${body}\n\n${link}`;
}

export type TickPlan =
  | { kind: "idle" }
  | { kind: "seed"; lastSeenId: string }
  | { kind: "send"; tweets: Tweet[] };

export function planTick(state: ShareState, tweets: Tweet[]): TickPlan {
  const originals = originalsOldestFirst(tweets);
  if (!state.lastSeenId) {
    if (originals.length === 0) return { kind: "idle" };
    return { kind: "seed", lastSeenId: originals[originals.length - 1].id };
  }
  if (originals.length === 0) return { kind: "idle" };
  return { kind: "send", tweets: originals };
}

async function xGet(
  path: string,
  bearer: string,
  params: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${X_API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } });
  const json = (await res.json().catch(() => ({}))) as {
    title?: string;
    detail?: string;
    data?: unknown;
    errors?: { detail?: string; title?: string }[];
  };
  if (!res.ok) {
    throw new Error(`x ${res.status}: ${json.detail ?? json.title ?? "request failed"}`);
  }
  const err = json.errors?.[0];
  if (err) {
    throw new Error(`x: ${err.detail ?? err.title ?? "request failed"}`);
  }
  return json;
}

export async function resolveUserId(
  username: string,
  bearer: string,
  cached?: string,
): Promise<string> {
  if (cached) return cached;
  const json = (await xGet(`/users/by/username/${encodeURIComponent(username)}`, bearer, {
    "user.fields": "id",
  })) as { data?: { id?: string } };
  const id = json.data?.id;
  if (!id) throw new Error(`x user lookup returned no id for @${username}`);
  return id;
}

export async function fetchRecentTweets(
  userId: string,
  bearer: string,
  sinceId?: string,
): Promise<Tweet[]> {
  const params: Record<string, string> = {
    max_results: String(X_MAX_RESULTS),
    exclude: "replies,retweets",
    "tweet.fields": "referenced_tweets",
  };
  if (sinceId) params.since_id = sinceId;
  const json = (await xGet(`/users/${userId}/tweets`, bearer, params)) as { data?: Tweet[] };
  return json.data ?? [];
}

export type FetchTick = (
  state: ShareState,
) => Promise<{ tweets: Tweet[]; patch?: Partial<ShareState> }>;

export type StartTweetShareOpts = {
  bot: Bot;
  username: string;
  groupId: string;
  statePath: string;
  fetchTick: FetchTick;
  plan?: (state: ShareState, tweets: Tweet[]) => TickPlan;
  logLabel?: string;
  pollMs?: number;
  log?: (msg: string) => void;
  haltPattern?: RegExp;
};

export function startTweetShare(
  opts: StartTweetShareOpts,
): { stop: () => void; rememberChat: (chatId: string) => void } {
  const log = opts.log ?? console.log;
  const pollMs = opts.pollMs ?? X_POLL_MS;
  const label = opts.logLabel ?? "x share";
  const planFn = opts.plan ?? planTick;
  const haltPattern =
    opts.haltPattern ??
    /Could not find user|401|402|Unauthorized|Payment Required/i;
  let state = loadShareState(opts.statePath);
  if (opts.groupId) state = { ...state, chatId: opts.groupId };

  function persist(): void {
    saveShareState(opts.statePath, state);
  }

  function rememberChat(chatId: string): void {
    if (state.chatId === chatId) return;
    if (opts.groupId && chatId !== opts.groupId) return;
    state = { ...state, chatId };
    persist();
  }

  let halt = false;

  async function tick(): Promise<void> {
    if (halt) return;
    try {
      if (state.lastSeenId && !state.chatId) {
        log(`${label}: waiting for TELEGRAM_GROUP_ID or a group message`);
        return;
      }
      const { tweets, patch } = await opts.fetchTick(state);
      if (patch && Object.keys(patch).length > 0) {
        state = { ...state, ...patch };
        persist();
      }
      const plan = planFn(state, tweets);
      if (plan.kind === "idle") {
        log(`${label}: no new posts`);
        return;
      }
      if (plan.kind === "seed") {
        state = { ...state, lastSeenId: plan.lastSeenId };
        persist();
        log(`${label}: seeded last seen (no history posted)`);
        return;
      }
      const chatId = state.chatId;
      if (!chatId) {
        log(`${label}: waiting for TELEGRAM_GROUP_ID or a group message`);
        return;
      }
      for (const tweet of plan.tweets) {
        await opts.bot.api.sendMessage(chatId, formatXPost(opts.username, tweet), {
          disable_web_page_preview: false,
        });
        state = { ...state, lastSeenId: tweet.id };
        persist();
        log(`${label}: posted ${tweet.id}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`${label}: ${msg}`);
      if (haltPattern.test(msg)) {
        halt = true;
        log(`${label}: stopping polls until restart`);
      }
    }
  }

  void tick();
  const timer = setInterval(() => void tick(), pollMs);
  return {
    stop: () => clearInterval(timer),
    rememberChat,
  };
}

export type StartXShareOpts = {
  bot: Bot;
  bearer: string;
  username: string;
  groupId: string;
  statePath: string;
  pollMs?: number;
  log?: (msg: string) => void;
};

export function startXShare(opts: StartXShareOpts): { stop: () => void; rememberChat: (chatId: string) => void } {
  return startTweetShare({
    bot: opts.bot,
    username: opts.username,
    groupId: opts.groupId,
    statePath: opts.statePath,
    pollMs: opts.pollMs,
    log: opts.log,
    logLabel: "x share",
    fetchTick: async (state) => {
      const userId = await resolveUserId(opts.username, opts.bearer, state.userId);
      const tweets = await fetchRecentTweets(userId, opts.bearer, state.lastSeenId);
      return {
        tweets,
        patch: state.userId === userId ? undefined : { userId },
      };
    },
  });
}
