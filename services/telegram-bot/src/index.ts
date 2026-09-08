export const TELEGRAM_MESSAGE_MAX = 4096;
export const RATE_WINDOW_MS = 60_000;
export const CHOICE_TEXT = "What do you want to send?";
export const DM_HINT = "Feedback is submitted from the group Menu.";
export const HELP_GROUP =
  "Menu → Feedback, then pick testnet UX, testnet UI, or Other. UX and UI need a screenshot or video. That post is public in this group.\n\nExploitable bugs go to GitHub private vulnerability reporting (SECURITY.md), not this channel.";
export const HELP_DM =
  "Feedback is submitted from the group Menu.\n\nExploitable bugs go to GitHub private vulnerability reporting (SECURITY.md), not this channel.";
export const POST_FOOTER =
  "Exploitable bugs: GitHub private vulnerability reporting, not this channel.";

export const TOPIC_IDS = ["ux", "ui", "other"] as const;
export type TopicId = (typeof TOPIC_IDS)[number];

export type Topic = {
  id: TopicId;
  button: string;
  label: string;
  prompt: string;
  needsMedia: boolean;
};

export const TOPICS: Record<TopicId, Topic> = {
  ux: {
    id: "ux",
    button: "Testnet product UX feedback (experience)",
    label: "Testnet UX (experience)",
    prompt:
      "Reply with a screenshot or screen recording of the experience, together with as detailed a description as possible.",
    needsMedia: true,
  },
  ui: {
    id: "ui",
    button: "Testnet product UI feedback (look and feel)",
    label: "Testnet UI (look and feel)",
    prompt:
      "Reply with a screenshot or screen recording of the look and feel, together with as detailed a description as possible.",
    needsMedia: true,
  },
  other: {
    id: "other",
    button: "Other (general feedback)",
    label: "Other",
    prompt: "Write your feedback as a reply.",
    needsMedia: false,
  },
};

const TOPIC_BY_PROMPT = new Map(
  Object.values(TOPICS).map((t) => [t.prompt, t.id] as const),
);

export type BotEnv = {
  token: string;
  groupId: string;
};

export function requireBotEnv(
  env: Record<string, string | undefined>,
): BotEnv {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const groupId = env.TELEGRAM_GROUP_ID?.trim() ?? "";
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
  return { token, groupId };
}

export function isAllowedGroup(chatId: string | number, groupId: string): boolean {
  if (!groupId) return Number(chatId) < 0;
  return String(chatId) === groupId;
}

export function chatIdParam(id: string): number | string {
  const n = Number(id);
  return Number.isSafeInteger(n) ? n : id;
}

export function fromLabel(username?: string | null, firstName?: string | null): string {
  const u = username?.trim();
  if (u) return `@${u.replace(/^@/, "")}`;
  const n = firstName?.trim();
  return n || "a member";
}

export function truncateBody(body: string, max: number): string {
  const t = body.trim();
  if (max <= 0) return "";
  if (t.length <= max) return t;
  if (max === 1) return "…";
  return `${t.slice(0, max - 1)}…`;
}

export function formatFeedbackPost(from: string, body: string, topic: TopicId): string {
  const header = `${TOPICS[topic].label} from ${from}:\n\n`;
  const footer = `\n\n${POST_FOOTER}`;
  const budget = TELEGRAM_MESSAGE_MAX - header.length - footer.length;
  return `${header}${truncateBody(body, Math.max(budget, 0))}${footer}`;
}

export function isTopicId(value: string): value is TopicId {
  return (TOPIC_IDS as readonly string[]).includes(value);
}

export function topicFromPrompt(text: string | undefined): TopicId | undefined {
  if (!text) return undefined;
  return TOPIC_BY_PROMPT.get(text);
}

export function isFeedbackPrompt(text: string | undefined): boolean {
  return topicFromPrompt(text) != null;
}

export function topicCallbackData(topic: TopicId, userId: string): string {
  return `fb:${topic}:${userId}`;
}

export function parseTopicCallback(
  data: string | undefined,
): { topic: TopicId; userId: string } | null {
  const m = data?.match(/^fb:(ux|ui|other):(\d+)$/);
  if (!m || !isTopicId(m[1])) return null;
  return { topic: m[1], userId: m[2] };
}

export class RateWindow {
  constructor(
    private readonly windowMs: number,
    private readonly hits = new Map<string, number>(),
  ) {}

  retryAfterMs(userId: string, now: number): number {
    const last = this.hits.get(userId);
    if (last == null) return 0;
    const elapsed = now - last;
    return elapsed >= this.windowMs ? 0 : this.windowMs - elapsed;
  }

  record(userId: string, now: number): void {
    this.hits.set(userId, now);
  }
}

export type FeedbackDecision =
  | { kind: "wrong_chat" }
  | { kind: "ignore" }
  | { kind: "rate_limited"; retryAfterSec: number }
  | { kind: "empty"; topic: TopicId }
  | { kind: "choose"; payload?: string }
  | { kind: "prompt"; topic: TopicId }
  | { kind: "need_media"; topic: TopicId }
  | { kind: "publish"; body: string; topic: TopicId };

export function decideFeedbackCommand(opts: {
  chatId: string | number;
  groupId: string;
  payload: string;
  userId: string;
  now: number;
  limiter: RateWindow;
}): FeedbackDecision {
  if (!isAllowedGroup(opts.chatId, opts.groupId)) return { kind: "wrong_chat" };
  const retryAfterMs = opts.limiter.retryAfterMs(opts.userId, opts.now);
  if (retryAfterMs > 0) {
    return { kind: "rate_limited", retryAfterSec: Math.ceil(retryAfterMs / 1000) };
  }
  const payload = opts.payload.trim();
  return payload ? { kind: "choose", payload } : { kind: "choose" };
}

export function decideTopicPick(opts: {
  chatId: string | number;
  groupId: string;
  fromUserId: string;
  targetUserId: string;
  topic: TopicId;
  payload?: string;
  now: number;
  limiter: RateWindow;
}): FeedbackDecision {
  if (!isAllowedGroup(opts.chatId, opts.groupId)) return { kind: "ignore" };
  if (opts.fromUserId !== opts.targetUserId) return { kind: "ignore" };
  const retryAfterMs = opts.limiter.retryAfterMs(opts.fromUserId, opts.now);
  if (retryAfterMs > 0) {
    return { kind: "rate_limited", retryAfterSec: Math.ceil(retryAfterMs / 1000) };
  }
  const payload = opts.payload?.trim();
  if (payload && !TOPICS[opts.topic].needsMedia) {
    return { kind: "publish", body: payload, topic: opts.topic };
  }
  return { kind: "prompt", topic: opts.topic };
}

export function decideFeedbackReply(opts: {
  chatId: string | number;
  groupId: string;
  text: string;
  topic?: TopicId;
  hasMedia: boolean;
  userId: string;
  now: number;
  limiter: RateWindow;
}): FeedbackDecision {
  if (opts.topic == null) return { kind: "ignore" };
  if (!isAllowedGroup(opts.chatId, opts.groupId)) return { kind: "ignore" };
  const retryAfterMs = opts.limiter.retryAfterMs(opts.userId, opts.now);
  if (retryAfterMs > 0) {
    return { kind: "rate_limited", retryAfterSec: Math.ceil(retryAfterMs / 1000) };
  }
  if (TOPICS[opts.topic].needsMedia && !opts.hasMedia) {
    return { kind: "need_media", topic: opts.topic };
  }
  const body = opts.text.trim() || (opts.hasMedia ? "(attachment)" : "");
  if (!body) return { kind: "empty", topic: opts.topic };
  return { kind: "publish", body, topic: opts.topic };
}
