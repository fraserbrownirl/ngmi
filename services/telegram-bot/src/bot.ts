import { Bot, InlineKeyboard, type Context } from "grammy";
import {
  CHOICE_TEXT,
  chatIdParam,
  decideFeedbackCommand,
  decideFeedbackReply,
  decideTopicPick,
  DM_HINT,
  fromLabel,
  formatFeedbackPost,
  HELP_DM,
  HELP_GROUP,
  isAllowedGroup,
  parseTopicCallback,
  RATE_WINDOW_MS,
  RateWindow,
  TOPICS,
  topicCallbackData,
  topicFromPrompt,
  type FeedbackDecision,
  type TopicId,
} from "./index.ts";

export type CreateBotOpts = {
  token: string;
  groupId: string;
  now?: () => number;
  limiter?: RateWindow;
  onGroupChat?: (chatId: string) => void;
};

type Pending = {
  commandId?: number;
  choiceMsgId?: number;
  payload?: string;
  topic?: TopicId;
};

async function ignoreDelete(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch {
    // Bot may lack delete rights in the group.
  }
}

function rateLimitText(sec: number): string {
  return `Wait ${sec}s before sending more feedback.`;
}

function choiceKeyboard(userId: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const topic of Object.values(TOPICS)) {
    kb.text(topic.button, topicCallbackData(topic.id, userId)).row();
  }
  return kb;
}

async function promptForTopic(ctx: Context, topic: TopicId, replyToId?: number) {
  const messageId = replyToId ?? ctx.msg?.message_id;
  return ctx.reply(TOPICS[topic].prompt, {
    reply_parameters: messageId != null ? { message_id: messageId } : undefined,
    reply_markup: { force_reply: true, selective: true },
  });
}

export function createBot(opts: CreateBotOpts): Bot {
  const bot = new Bot(opts.token);
  const limiter = opts.limiter ?? new RateWindow(RATE_WINDOW_MS);
  const now = opts.now ?? Date.now;
  const { groupId } = opts;
  const pendingByUser = new Map<string, Pending>();

  bot.use(async (ctx, next) => {
    const id = ctx.chat?.id;
    if (
      id != null &&
      ctx.chat &&
      ctx.chat.type !== "private" &&
      isAllowedGroup(id, groupId)
    ) {
      opts.onGroupChat?.(String(id));
    }
    await next();
  });

  async function publish(ctx: Context, body: string, topic: TopicId): Promise<void> {
    const chatId = ctx.chat?.id;
    if (chatId == null) return;
    const from = fromLabel(ctx.from?.username, ctx.from?.first_name);
    await ctx.api.sendMessage(chatId, formatFeedbackPost(from, body, topic));
    if (ctx.from) limiter.record(String(ctx.from.id), now());
  }

  async function sweep(ctx: Context, extraIds: number[] = []): Promise<void> {
    const chatId = ctx.chat?.id;
    const userId = ctx.from ? String(ctx.from.id) : "";
    const pending = pendingByUser.get(userId);
    pendingByUser.delete(userId);
    if (chatId == null) return;
    const ids = [
      ...extraIds,
      pending?.commandId,
      pending?.choiceMsgId,
    ].filter((id): id is number => id != null);
    for (const id of [...new Set(ids)]) {
      await ignoreDelete(() => ctx.api.deleteMessage(chatId, id));
    }
  }

  async function applyDecision(
    ctx: Context,
    decision: FeedbackDecision,
    extras?: { deleteIds?: number[] },
  ): Promise<void> {
    const userId = ctx.from ? String(ctx.from.id) : "";
    switch (decision.kind) {
      case "wrong_chat":
        await ctx.reply(DM_HINT);
        return;
      case "ignore":
        return;
      case "rate_limited":
        await ctx.reply(rateLimitText(decision.retryAfterSec));
        return;
      case "choose": {
        const prev = pendingByUser.get(userId);
        if (prev?.choiceMsgId != null && ctx.chat) {
          await ignoreDelete(() => ctx.api.deleteMessage(ctx.chat.id, prev.choiceMsgId!));
        }
        const sent = await ctx.reply(CHOICE_TEXT, {
          reply_parameters: ctx.msg ? { message_id: ctx.msg.message_id } : undefined,
          reply_markup: choiceKeyboard(userId),
        });
        pendingByUser.set(userId, {
          commandId: ctx.msg?.message_id,
          choiceMsgId: sent.message_id,
          payload: decision.payload,
        });
        return;
      }
      case "empty":
        await promptForTopic(ctx, decision.topic, ctx.msg?.message_id);
        return;
      case "need_media":
        await promptForTopic(ctx, decision.topic, ctx.msg?.message_id);
        return;
      case "prompt": {
        const prev = pendingByUser.get(userId) ?? {};
        await promptForTopic(ctx, decision.topic, prev.commandId);
        pendingByUser.set(userId, { ...prev, topic: decision.topic, choiceMsgId: undefined });
        if (ctx.chat && prev.choiceMsgId != null) {
          await ignoreDelete(() => ctx.api.deleteMessage(ctx.chat.id, prev.choiceMsgId));
        }
        return;
      }
      case "publish": {
        await publish(ctx, decision.body, decision.topic);
        await sweep(ctx, extras?.deleteIds ?? []);
        return;
      }
    }
  }

  bot.command("help", async (ctx) => {
    if (ctx.chat.type === "private" || !isAllowedGroup(ctx.chat.id, groupId)) {
      await ctx.reply(HELP_DM);
      return;
    }
    await ctx.reply(HELP_GROUP);
  });

  bot.command("start", async (ctx) => {
    if (ctx.chat.type === "private") await ctx.reply(DM_HINT);
  });

  bot.command("feedback", async (ctx) => {
    const decision = decideFeedbackCommand({
      chatId: ctx.chat.id,
      groupId,
      payload: ctx.match?.toString() ?? "",
      userId: String(ctx.from?.id ?? ""),
      now: now(),
      limiter,
    });
    await applyDecision(ctx, decision);
  });

  bot.on("callback_query:data", async (ctx) => {
    const parsed = parseTopicCallback(ctx.callbackQuery.data);
    if (!parsed || ctx.chat == null || ctx.from == null) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (String(ctx.from.id) !== parsed.userId) {
      await ctx.answerCallbackQuery({ text: "That's not your prompt." });
      return;
    }
    await ctx.answerCallbackQuery();
    const pending = pendingByUser.get(parsed.userId);
    const decision = decideTopicPick({
      chatId: ctx.chat.id,
      groupId,
      fromUserId: String(ctx.from.id),
      targetUserId: parsed.userId,
      topic: parsed.topic,
      payload: pending?.payload,
      now: now(),
      limiter,
    });
    await applyDecision(ctx, decision);
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.msg.text.startsWith("/")) return;
    if (ctx.chat.type === "private") {
      await ctx.reply(DM_HINT);
      return;
    }
    const replyTo = ctx.msg.reply_to_message;
    const userId = String(ctx.from?.id ?? "");
    const topic =
      pendingByUser.get(userId)?.topic ?? topicFromPrompt(replyTo?.text);
    const decision = decideFeedbackReply({
      chatId: ctx.chat.id,
      groupId,
      text: ctx.msg.text,
      topic,
      hasMedia: false,
      userId,
      now: now(),
      limiter,
    });
    const deleteIds: number[] = [];
    if (decision.kind === "publish") {
      deleteIds.push(ctx.msg.message_id);
      if (replyTo) deleteIds.push(replyTo.message_id);
    }
    await applyDecision(ctx, decision, { deleteIds });
  });

  bot.on(["message:photo", "message:document", "message:video", "message:animation", "message:video_note"], async (ctx) => {
    if (ctx.chat.type === "private") {
      await ctx.reply(DM_HINT);
      return;
    }
    const replyTo = ctx.msg.reply_to_message;
    const userId = String(ctx.from?.id ?? "");
    const pending = pendingByUser.get(userId);
    const topic = pending?.topic ?? topicFromPrompt(replyTo?.text);
    const caption =
      ctx.msg.caption?.trim() ||
      pending?.payload?.trim() ||
      "(attachment)";
    const decision = decideFeedbackReply({
      chatId: ctx.chat.id,
      groupId,
      text: caption,
      topic,
      hasMedia: true,
      userId,
      now: now(),
      limiter,
    });
    if (decision.kind === "publish") {
      const chatId = ctx.chat.id;
      const from = fromLabel(ctx.from?.username, ctx.from?.first_name);
      await ctx.api.sendMessage(chatId, formatFeedbackPost(from, decision.body, decision.topic));
      await ignoreDelete(() => ctx.api.copyMessage(chatId, chatId, ctx.msg.message_id));
      limiter.record(userId, now());
      const deleteIds = [ctx.msg.message_id];
      if (replyTo) deleteIds.push(replyTo.message_id);
      await sweep(ctx, deleteIds);
      return;
    }
    await applyDecision(ctx, decision);
  });

  return bot;
}

export async function registerGroupMenu(bot: Bot, groupId: string): Promise<void> {
  await bot.api.setMyCommands([{ command: "help", description: "How to send feedback" }]);
  const groupCommands = [
    { command: "feedback", description: "Send feedback" },
    { command: "help", description: "How to send feedback" },
  ];
  if (groupId) {
    await bot.api.setMyCommands(groupCommands, {
      scope: { type: "chat", chat_id: chatIdParam(groupId) },
    });
    return;
  }
  await bot.api.setMyCommands(groupCommands, { scope: { type: "all_group_chats" } });
}
