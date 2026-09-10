/**
 * One-shot operator script: log @ngmi_cto into twitterapi.io v2 via the sticky
 * Webshare proxy from the repo-root .env, and store login_cookies to
 * services/keeper/data/twitterapi-cto.json.
 *
 * Run: node scripts/cto-login.ts   (cwd = services/keeper)
 *
 * Note (2 Sep 2026): twitterapi.io's login backend currently rejects a valid
 * totp_secret with OTP_REQUIRED. The live session was minted by logging into
 * x.com directly through the sticky proxy and packing the browser cookies into
 * the login_cookies format (base64 JSON cookie dict) — see the session files
 * this script would refresh once the vendor path works again.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loginCto, twitterApiFromEnv } from "../src/twitterapi.ts";

const envPath = join(process.cwd(), "..", "..", ".env");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const cfg = twitterApiFromEnv();
if (!cfg) throw new Error("TWITTERAPI_API_KEY missing from .env");

console.log(`login as @${cfg.username} via proxy ${cfg.proxy?.replace(/\/\/.*@/, "//***@")}`);
const cookie = await loginCto(cfg);
console.log(`LOGIN OK — login_cookies stored (${cookie.length} chars)`);
