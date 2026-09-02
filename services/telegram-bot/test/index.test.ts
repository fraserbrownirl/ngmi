import { describe, it, expect } from "vitest";
import { Bot } from "grammy";
import { createBot } from "../src/bot.ts";
import {
  RATE_WINDOW_MS,
  TELEGRAM_MESSAGE_MAX,
  POST_FOOTER,
  TOPICS,
  RateWindow,
  chatIdParam,
  decideFeedbackCommand,
  decideFeedbackReply,
  decideTopicPick,
  formatFeedbackPost,
  fromLabel,
  isAllowedGroup,
  isFeedbackPrompt,
  parseTopicCallback,
  requireBotEnv,
  topicCallbackData,
  topicFromPrompt,
  truncateBody,
} from "../src/index.ts";

describe("createBot", () => {
  it("builds without contacting Telegram", () => {
    expect(createBot({ token: "test-token", groupId: "-1001" })).toBeInstanceOf(Bot);
  });
});

describe("requireBotEnv", () => {
  it("fails closed without a token", () => {
    expect(() => requireBotEnv({})).toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it("trims values and allows a missing group id", () => {
    expect(requireBotEnv({ TELEGRAM_BOT_TOKEN: "  tok  " })).toEqual({
      token: "tok",
      groupId: "",
    });
    expect(
      requireBotEnv({ TELEGRAM_BOT_TOKEN: "  tok  ", TELEGRAM_GROUP_ID: "  -1001  " }),
    ).toEqual({ token: "tok", groupId: "-1001" });
  });
});

describe("isAllowedGroup", () => {
  it("matches string and number chat ids", () => {
    expect(isAllowedGroup(-1001, "-1001")).toBe(true);
    expect(isAllowedGroup("-1001", "-1001")).toBe(true);
    expect(isAllowedGroup(-1002, "-1001")).toBe(false);
  });

  it("allows any group chat when no group id is set", () => {
    expect(isAllowedGroup(-1001, "")).toBe(true);
    expect(isAllowedGroup(42, "")).toBe(false);
  });
});

describe("chatIdParam", () => {
  it("uses a number when it is a safe integer", () => {
    expect(chatIdParam("-1001234567890")).toBe(-1001234567890);
  });
});

describe("fromLabel", () => {
  it("prefers @username", () => {
    expect(fromLabel("alice", "Alice")).toBe("@alice");
    expect(fromLabel("@alice", "Alice")).toBe("@alice");
  });

  it("falls back to first name then a member", () => {
    expect(fromLabel(undefined, "Alice")).toBe("Alice");
    expect(fromLabel(null, "  ")).toBe("a member");
    expect(fromLabel()).toBe("a member");
  });
});

describe("truncateBody", () => {
  it("leaves short text", () => {
    expect(truncateBody("  hi  ", 10)).toBe("hi");
  });

  it("ellipsis when over max", () => {
    expect(truncateBody("hello", 4)).toBe("hel…");
    expect(truncateBody("hello", 1)).toBe("…");
    expect(truncateBody("hello", 0)).toBe("");
  });
});

describe("topics", () => {
  it("keeps button labels within Telegram's 64-char cap", () => {
    for (const topic of Object.values(TOPICS)) {
      expect(topic.button.length).toBeLessThanOrEqual(64);
    }
  });

  it("round-trips callback data", () => {
    expect(parseTopicCallback(topicCallbackData("ux", "42"))).toEqual({
      topic: "ux",
      userId: "42",
    });
    expect(parseTopicCallback("nope")).toBeNull();
  });
});

describe("formatFeedbackPost", () => {
  it("includes topic, from, body, and exploit footer", () => {
    const text = formatFeedbackPost("@alice", "tote lag", "ux");
    expect(text).toContain("Testnet UX (experience) from @alice:");
    expect(text).toContain("tote lag");
    expect(text).toContain(POST_FOOTER);
  });

  it("labels UI posts", () => {
    expect(formatFeedbackPost("@alice", "mark", "ui")).toContain(
      "Testnet UI (look and feel) from @alice:",
    );
  });

  it("stays within Telegram's 4096 cap", () => {
    const text = formatFeedbackPost("@alice", "x".repeat(5000), "ui");
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_MAX);
    expect(text.includes("…")).toBe(true);
  });
});

describe("isFeedbackPrompt", () => {
  it("matches each topic prompt only", () => {
    expect(isFeedbackPrompt(TOPICS.ux.prompt)).toBe(true);
    expect(isFeedbackPrompt(TOPICS.ui.prompt)).toBe(true);
    expect(isFeedbackPrompt(TOPICS.other.prompt)).toBe(true);
    expect(topicFromPrompt(TOPICS.ui.prompt)).toBe("ui");
    expect(isFeedbackPrompt("other")).toBe(false);
    expect(isFeedbackPrompt(undefined)).toBe(false);
  });
});

describe("RateWindow", () => {
  it("allows, then blocks inside the window, then allows again", () => {
    const limiter = new RateWindow(RATE_WINDOW_MS);
    const t0 = 1_000_000;
    expect(limiter.retryAfterMs("1", t0)).toBe(0);
    limiter.record("1", t0);
    expect(limiter.retryAfterMs("1", t0 + 1_000)).toBe(59_000);
    expect(limiter.retryAfterMs("1", t0 + RATE_WINDOW_MS)).toBe(0);
    expect(limiter.retryAfterMs("2", t0 + 1_000)).toBe(0);
  });
});

describe("decideFeedbackCommand", () => {
  const limiter = new RateWindow(RATE_WINDOW_MS);
  const base = {
    chatId: -1001,
    groupId: "-1001",
    userId: "9",
    now: 5_000,
    limiter,
  };

  it("rejects other chats", () => {
    expect(decideFeedbackCommand({ ...base, chatId: 1, payload: "hi" })).toEqual({
      kind: "wrong_chat",
    });
  });

  it("always opens the topic choice", () => {
    expect(decideFeedbackCommand({ ...base, payload: "  " })).toEqual({ kind: "choose" });
    expect(decideFeedbackCommand({ ...base, payload: "  lag  " })).toEqual({
      kind: "choose",
      payload: "lag",
    });
  });

  it("rate-limits after a post", () => {
    const local = new RateWindow(RATE_WINDOW_MS);
    local.record("9", 5_000);
    expect(
      decideFeedbackCommand({ ...base, limiter: local, payload: "again", now: 5_000 + 1_000 }),
    ).toEqual({ kind: "rate_limited", retryAfterSec: 59 });
  });
});

describe("decideTopicPick", () => {
  const limiter = new RateWindow(RATE_WINDOW_MS);
  const base = {
    chatId: -1001,
    groupId: "-1001",
    fromUserId: "9",
    targetUserId: "9",
    topic: "ux" as const,
    now: 5_000,
    limiter,
  };

  it("ignores other chats and other users' buttons", () => {
    expect(decideTopicPick({ ...base, chatId: 1 })).toEqual({ kind: "ignore" });
    expect(decideTopicPick({ ...base, fromUserId: "8" })).toEqual({ kind: "ignore" });
  });

  it("prompts when there is no payload yet", () => {
    expect(decideTopicPick(base)).toEqual({ kind: "prompt", topic: "ux" });
  });

  it("publishes a pre-typed payload for Other, not UX", () => {
    expect(decideTopicPick({ ...base, payload: "  lag  ", topic: "other" })).toEqual({
      kind: "publish",
      body: "lag",
      topic: "other",
    });
    expect(decideTopicPick({ ...base, payload: "lag", topic: "ux" })).toEqual({
      kind: "prompt",
      topic: "ux",
    });
  });
});

describe("decideFeedbackReply", () => {
  const limiter = new RateWindow(RATE_WINDOW_MS);
  const base = {
    chatId: -1001,
    groupId: "-1001",
    userId: "9",
    now: 5_000,
    limiter,
    topic: "other" as const,
    text: "lag",
    hasMedia: false,
  };

  it("ignores replies without a topic and other chats", () => {
    expect(decideFeedbackReply({ ...base, topic: undefined })).toEqual({ kind: "ignore" });
    expect(decideFeedbackReply({ ...base, chatId: 1 })).toEqual({ kind: "ignore" });
  });

  it("rejects empty Other replies", () => {
    expect(decideFeedbackReply({ ...base, text: "  " })).toEqual({
      kind: "empty",
      topic: "other",
    });
  });

  it("publishes Other text without media", () => {
    expect(decideFeedbackReply(base)).toEqual({
      kind: "publish",
      body: "lag",
      topic: "other",
    });
  });

  it("refuses UX/UI text until a screenshot or video is attached", () => {
    expect(decideFeedbackReply({ ...base, topic: "ux", text: "lag" })).toEqual({
      kind: "need_media",
      topic: "ux",
    });
    expect(
      decideFeedbackReply({ ...base, topic: "ui", text: "lag", hasMedia: true }),
    ).toEqual({
      kind: "publish",
      body: "lag",
      topic: "ui",
    });
  });
});
