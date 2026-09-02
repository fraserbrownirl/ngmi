/**
 * Snapshot current NGMI Token-2022 holders via getProgramAccounts.
 *
 * This is much faster and more complete than paginating signatures, because
 * public RPCs prune old transaction metadata but keep current program state.
 *
 *   pnpm gpa:ngmi-holders
 *   MIN_NGMI=1000000 pnpm gpa:ngmi-holders   # raw token units (6 decimals)
 *   MIN_USD=5 PRICE_USD=0.000001 pnpm gpa:ngmi-holders
 *
 * Output: data/ngmi-holders-gpa.json (gitignored)
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MINT = "zMXAUQvqHZfD8gLuXMaSmYc5J2VJzBcj565pHZvzBrC";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const SYSTEM = "11111111111111111111111111111111";
const RPCS = [
  process.env.SOLANA_MAINNET_RPC_URL,
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
].filter(Boolean);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.OUT ?? path.join(ROOT, "data", "ngmi-holders-gpa.json");
const MIN_NGMI = Number(process.env.MIN_NGMI ?? 0.000001); // whole tokens; default > 0 excludes zero-balance accounts
const MIN_USD = Number(process.env.MIN_USD ?? 0);
const PRICE_USD = Number(process.env.PRICE_USD ?? 0);
const REQUIRE_SYSTEM_WALLET = process.env.REQUIRE_SYSTEM_WALLET !== "false"; // default true
const ACCOUNT_BATCH = 100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRateLimit(status, body) {
  if (status === 429) return true;
  if (body?.error?.code === 429) return true;
  const msg = body?.error?.message ?? "";
  return /too many requests/i.test(msg);
}

async function rpcAt(url, method, params, { attempts = 3, backoff = 200 } = {}, attempt = 0) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    if (attempt + 1 >= attempts) throw err;
    await sleep(backoff * (attempt + 1));
    return rpcAt(url, method, params, { attempts, backoff }, attempt + 1);
  }
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (res.status >= 500 || isRateLimit(res.status, body)) {
    if (attempt + 1 >= attempts) throw new Error(`RPC ${res.status}: ${text.slice(0, 200)}`);
    await sleep(backoff * 2 ** attempt);
    return rpcAt(url, method, params, { attempts, backoff }, attempt + 1);
  }
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}: ${text.slice(0, 300)}`);
  if (body?.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function rpc(method, params) {
  let lastErr;
  for (const url of RPCS) {
    try {
      return await rpcAt(url, method, params);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function fetchTokenAccounts() {
  return rpc("getProgramAccounts", [
    TOKEN_2022,
    {
      encoding: "jsonParsed",
      filters: [{ memcmp: { offset: 0, bytes: MINT } }],
    },
  ]);
}

async function classify(addresses) {
  const byAddr = new Map();
  for (let i = 0; i < addresses.length; i += ACCOUNT_BATCH) {
    const chunk = addresses.slice(i, i + ACCOUNT_BATCH);
    const infos = await rpc("getMultipleAccounts", [chunk, { encoding: "jsonParsed" }]);
    chunk.forEach((addr, j) => {
      const acc = infos.value[j];
      byAddr.set(addr, {
        executable: acc?.executable ?? false,
        ownerProgram: acc?.owner ?? null,
        lamports: acc?.lamports ?? 0,
      });
    });
  }
  return byAddr;
}

async function main() {
  const accounts = await fetchTokenAccounts();
  process.stderr.write(`token accounts ${accounts.length}\n`);

  const decimals = accounts[0]?.account?.data?.parsed?.info?.tokenAmount?.decimals ?? 6;
  const byOwner = new Map();

  for (const { pubkey, account } of accounts) {
    const info = account?.data?.parsed?.info;
    if (!info) continue;
    if (info.mint !== MINT) continue;
    if (info.state !== "initialized") continue;
    const owner = info.owner;
    const amount = BigInt(info.tokenAmount?.amount ?? 0);
    if (!owner) continue;
    const entry = byOwner.get(owner) ?? {
      address: owner,
      balance: 0n,
      accounts: [],
    };
    entry.balance += amount;
    entry.accounts.push({ address: pubkey, amount: String(amount) });
    byOwner.set(owner, entry);
  }

  const owners = [...byOwner.values()].sort((a, b) => (a.balance > b.balance ? -1 : 1));
  const ownerAddresses = owners.map((o) => o.address);
  const classified = await classify(ownerAddresses);

  const toHuman = (raw) => Number(raw) / 10 ** decimals;
  const rows = owners.map((o) => {
    const c = classified.get(o.address);
    return {
      address: o.address,
      ...c,
      balance: String(o.balance),
      balanceHuman: toHuman(o.balance),
      accounts: o.accounts,
    };
  });

  const minRawByTokens = MIN_NGMI > 0 ? BigInt(Math.round(MIN_NGMI * 10 ** decimals)) : null;
  const minRawByUsd = MIN_USD > 0 && PRICE_USD > 0 ? BigInt(Math.round((MIN_USD / PRICE_USD) * 10 ** decimals)) : null;
  const effectiveMin = minRawByUsd ?? minRawByTokens ?? 0n;

  const system = REQUIRE_SYSTEM_WALLET
    ? rows.filter((r) => !r.executable && r.ownerProgram === SYSTEM)
    : rows.filter((r) => !r.executable && (r.ownerProgram === SYSTEM || r.ownerProgram == null));
  const qualified = system.filter((r) => BigInt(r.balance) >= effectiveMin);
  const zeroBalance = system.filter((r) => BigInt(r.balance) === 0n);

  const humans = system.filter((r) => BigInt(r.balance) > 0n).map((r) => r.balanceHuman).sort((a, b) => a - b);
  const pct = (p) => humans[Math.floor((p / 100) * (humans.length - 1))] ?? 0;

  const payload = {
    mint: MINT,
    tokenProgram: TOKEN_2022,
    method: "getProgramAccounts",
    scannedAt: new Date().toISOString(),
    rpcHost: new URL(RPCS[0]).host,
    tokenAccounts: accounts.length,
    decimals,
    ownerCount: rows.length,
    systemWalletCount: system.length,
    zeroBalanceCount: zeroBalance.length,
    qualifiedCount: qualified.length,
    thresholds: {
      minNgmiRaw: MIN_NGMI || null,
      minUsd: MIN_USD || null,
      priceUsd: PRICE_USD || null,
      effectiveMinRaw: String(effectiveMin),
    },
    percentiles: {
      p25: pct(25),
      p50: pct(50),
      p75: pct(75),
      p90: pct(90),
      p95: pct(95),
      p99: pct(99),
    },
    owners: rows,
    qualified: qualified.map((r) => r.address),
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`);
  process.stderr.write(
    `wrote ${OUT} (${rows.length} owners, ${qualified.length} qualified, ${zeroBalance.length} zero-balance)\n`
  );
  console.log(JSON.stringify({ percentiles: payload.percentiles, ownerCount: rows.length, qualifiedCount: qualified.length, zeroBalanceCount: zeroBalance.length }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
