import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBot, registerGroupMenu } from "./bot.ts";
import { requireBotEnv } from "./index.ts";
import { startTwitterApiShare, twitterApiShareFromEnv } from "./twitterapi-share.ts";
import { startXShare, xShareFromEnv } from "./x-share.ts";

function loadDotEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(here, "../../../.env"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    process.loadEnvFile(path);
    return;
  }
}

loadDotEnv();
const { token, groupId } = requireBotEnv(process.env);
const here = dirname(fileURLToPath(import.meta.url));
const xShare = xShareFromEnv(process.env);
const ctoShare = twitterApiShareFromEnv(process.env);
const rememberFns: Array<(chatId: string) => void> = [];

const bot = createBot({
  token,
  groupId,
  onGroupChat: (chatId) => {
    for (const fn of rememberFns) fn(chatId);
  },
});

if (xShare) {
  const ctl = startXShare({
    bot,
    bearer: xShare.bearer,
    username: xShare.username,
    groupId,
    statePath: resolve(here, "../../../data/x-share.json"),
  });
  rememberFns.push(ctl.rememberChat);
} else {
  console.log("x share off: no TWITTER_BEARER_TOKEN");
}

if (ctoShare) {
  const ctl = startTwitterApiShare({
    bot,
    apiKey: ctoShare.apiKey,
    username: ctoShare.username,
    groupId,
    statePath: resolve(here, "../../../data/x-share-cto.json"),
  });
  rememberFns.push(ctl.rememberChat);
} else {
  console.log("cto share off: no TWITTERAPI_API_KEY");
}

await registerGroupMenu(bot, groupId);
await bot.start();
