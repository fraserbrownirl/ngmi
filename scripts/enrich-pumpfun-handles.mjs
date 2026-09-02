/**
 * Enrich NGMI holder snapshot with Pump.fun profile handles.
 *
 * Reads data/ngmi-holders-gpa.json (or IN env) and calls Pump.fun's
 * frontend API for each qualified holder address. Writes a new JSON with
 * username, followers, x_username, etc.
 *
 *   pnpm enrich:pumpfun-handles
 *   IN=data/custom.json OUT=data/custom-pumpfun.json pnpm enrich:pumpfun-handles
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://frontend-api-v3.pump.fun/users";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const IN = process.env.IN ?? path.join(ROOT, "data", "ngmi-holders-gpa.json");
const OUT = process.env.OUT ?? path.join(ROOT, "data", "ngmi-holders-gpa-pumpfun.json");
const DELAY_MS = Number(process.env.DELAY_MS ?? 2_000); // 2s between calls to avoid 429s
const MAX_RETRIES = Number(process.env.MAX_RETRIES ?? 3);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lookup(address, attempt = 0) {
  try {
    const res = await fetch(`${API}/${address}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) {
      return { address, isPumpUser: false, error: "no profile" };
    }
    if (res.status === 429) {
      if (attempt >= MAX_RETRIES) {
        return { address, isPumpUser: false, error: "rate limited" };
      }
      const wait = 5_000 * 2 ** attempt;
      process.stderr.write(`  ${address.slice(0, 8)}… rate limited, retry in ${wait}ms\n`);
      await sleep(wait);
      return lookup(address, attempt + 1);
    }
    if (!res.ok) {
      return { address, isPumpUser: false, error: `HTTP ${res.status}` };
    }
    const body = await res.json();
    return {
      address,
      isPumpUser: body.is_pump_user ?? false,
      username: body.username ?? null,
      userId: body.userId ?? null,
      followers: body.followers ?? 0,
      following: body.following ?? 0,
      xUsername: body.x_username ?? null,
      profileImage: body.profile_image ?? null,
      bio: body.bio ?? null,
      kind: body.kind ?? null,
    };
  } catch (err) {
    return { address, isPumpUser: false, error: err.name || String(err) };
  }
}

async function main() {
  const raw = await readFile(IN, "utf8");
  const snapshot = JSON.parse(raw);
  const qualified = snapshot.qualified ?? [];
  const allOwners = snapshot.owners ?? [];

  process.stderr.write(`enriching ${qualified.length} qualified holders\n`);

  const enriched = [];
  for (let i = 0; i < qualified.length; i++) {
    const addr = qualified[i];
    const profile = await lookup(addr);
    const base = allOwners.find((o) => o.address === addr) ?? {};
    enriched.push({ ...base, pumpfun: profile });
    if ((i + 1) % 10 === 0 || i === qualified.length - 1) {
      process.stderr.write(`done ${i + 1}/${qualified.length}\n`);
    }
    if (i < qualified.length - 1) await sleep(DELAY_MS);
  }

  const withHandles = enriched.filter((e) => e.pumpfun?.username && !e.pumpfun.error);
  const pumpUsers = enriched.filter((e) => e.pumpfun?.isPumpUser);

  const payload = {
    ...snapshot,
    enrichedAt: new Date().toISOString(),
    pumpFunApi: API,
    enrichedCount: enriched.length,
    withUsernameCount: withHandles.length,
    pumpUserCount: pumpUsers.length,
    owners: enriched,
    qualified: enriched.map((e) => e.address),
  };

  await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`);
  process.stderr.write(
    `wrote ${OUT} (${withHandles.length} with usernames, ${pumpUsers.length} is_pump_user)\n`
  );
  console.log(JSON.stringify({ withUsernameCount: withHandles.length, pumpUserCount: pumpUsers.length }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
