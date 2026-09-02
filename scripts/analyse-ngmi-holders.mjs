/**
 * Analyse NGMI holder amounts from the signature-history snapshot.
 *
 * Re-fetches the same transaction set, records per-owner balance history from
 * pre/post token balances, and writes a qualified airdrop list with thresholds.
 *
 *   pnpm analyse:ngmi-holders
 *   MIN_NGMI=1000 pnpm analyse:ngmi-holders   # raw amount (with decimals)
 *   MIN_USD=5 pnpm analyse:ngmi-holders         # dollar value at current price
 *
 * Output: data/ngmi-holders-analysis.json (gitignored)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MINT = "zMXAUQvqHZfD8gLuXMaSmYc5J2VJzBcj565pHZvzBrC";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const SYSTEM = "11111111111111111111111111111111";
const SIG_RPC =
  process.env.SOLANA_MAINNET_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const TX_RPCS = [
  process.env.SOLANA_MAINNET_RPC_URL,
  "https://solana-rpc.publicnode.com",
  "https://api.mainnet-beta.solana.com",
].filter(Boolean);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const IN = process.env.IN ?? path.join(ROOT, "data", "ngmi-holders.json");
const OUT = process.env.OUT ?? path.join(ROOT, "data", "ngmi-holders-analysis.json");
const SIG_LIMIT = 1000;
const TX_CONCURRENCY = 6;
const ACCOUNT_BATCH = 100;
const MIN_NGMI = Number(process.env.MIN_NGMI ?? 0);      // raw token units
const MIN_USD = Number(process.env.MIN_USD ?? 0);        // dollars

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRateLimit(status, body) {
  if (status === 429) return true;
  if (body?.error?.code === 429) return true;
  const msg = body?.error?.message ?? "";
  return /too many requests/i.test(msg);
}

async function rpcAt(url, method, params, { attempts = 2, backoff = 250 } = {}, attempt = 0) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(8_000),
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

async function rpcSig(method, params) {
  return rpcAt(SIG_RPC, method, params, { attempts: 10, backoff: 1000 });
}

async function rpcTx(method, params, start = 0) {
  let lastErr;
  for (let i = 0; i < TX_RPCS.length; i += 1) {
    const url = TX_RPCS[(start + i) % TX_RPCS.length];
    try {
      return await rpcAt(url, method, params);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function loadSnapshot() {
  const text = await readFile(IN, "utf8");
  return JSON.parse(text);
}

function collectAmounts(tx, stats) {
  if (!tx?.meta) return;
  const time = tx.blockTime ?? 0;
  const balances = {};
  for (const bal of tx.meta.preTokenBalances ?? []) {
    if (bal.mint !== MINT) continue;
    if (bal.programId && bal.programId !== TOKEN_2022) continue;
    if (!bal.owner) continue;
    balances[bal.owner] = { pre: BigInt(bal.uiTokenAmount?.amount ?? 0) };
  }
  for (const bal of tx.meta.postTokenBalances ?? []) {
    if (bal.mint !== MINT) continue;
    if (bal.programId && bal.programId !== TOKEN_2022) continue;
    if (!bal.owner) continue;
    const entry = balances[bal.owner] ?? {};
    entry.post = BigInt(bal.uiTokenAmount?.amount ?? 0);
    balances[bal.owner] = entry;
  }
  for (const [owner, { pre = 0n, post = 0n }] of Object.entries(balances)) {
    const s = stats.get(owner) ?? {
      address: owner,
      maxBalance: 0n,
      finalBalance: 0n,
      totalIn: 0n,
      totalOut: 0n,
      txnCount: 0,
      firstSeen: time,
      lastSeen: time,
    };
    if (post > s.maxBalance) s.maxBalance = post;
    s.finalBalance = post;
    s.txnCount += 1;
    if (time < s.firstSeen) s.firstSeen = time;
    if (time > s.lastSeen) s.lastSeen = time;
    const delta = post - pre;
    if (delta > 0n) s.totalIn += delta;
    else if (delta < 0n) s.totalOut += -delta;
    stats.set(owner, s);
  }
}

async function allSignatures() {
  const sigs = [];
  let before;
  for (;;) {
    const config = { limit: SIG_LIMIT };
    if (before) config.before = before;
    const page = await rpcSig("getSignaturesForAddress", [MINT, config]);
    sigs.push(...page.map((s) => s.signature));
    process.stderr.write(`signatures ${sigs.length}\n`);
    if (page.length < SIG_LIMIT) break;
    before = page[page.length - 1].signature;
  }
  return sigs;
}

async function aggregate(sigs) {
  const stats = new Map();
  let missing = 0;
  let done = 0;
  let next = 0;
  const worker = async (workerId) => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= sigs.length) return;
      const tx = await rpcTx(
        "getTransaction",
        [sigs[i], { encoding: "json", maxSupportedTransactionVersion: 0 }],
        workerId + i
      );
      if (!tx) missing += 1;
      else collectAmounts(tx, stats);
      done += 1;
      if (done % 100 === 0 || done === sigs.length) {
        process.stderr.write(`txs ${done}/${sigs.length} owners ${stats.size}\n`);
      }
    }
  };
  await Promise.all(Array.from({ length: TX_CONCURRENCY }, (_, id) => worker(id)));
  return { stats, missing };
}

async function classify(addresses) {
  const byAddr = new Map();
  for (let i = 0; i < addresses.length; i += ACCOUNT_BATCH) {
    const chunk = addresses.slice(i, i + ACCOUNT_BATCH);
    const infos = await rpcSig("getMultipleAccounts", [chunk, { encoding: "jsonParsed" }]);
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
  const snap = await loadSnapshot();
  const mintInfo = await rpcTx("getAccountInfo", [MINT, { encoding: "jsonParsed" }]);
  if (!mintInfo?.value) throw new Error(`mint ${MINT} not found`);
  const decimals = mintInfo.value.data?.parsed?.info?.decimals ?? 9;
  const priceUsd = Number(process.env.PRICE_USD ?? 0); // set externally if filtering by USD

  const signatures = await allSignatures();
  const { stats, missing } = await aggregate(signatures);
  const addresses = [...stats.keys()].sort();
  const classified = await classify(addresses);

  const toHuman = (raw) => Number(raw) / 10 ** decimals;
  const rows = addresses.map((addr) => {
    const s = stats.get(addr);
    const c = classified.get(addr);
    return {
      address: addr,
      ...c,
      maxBalance: String(s.maxBalance),
      maxBalanceHuman: toHuman(s.maxBalance),
      finalBalance: String(s.finalBalance),
      finalBalanceHuman: toHuman(s.finalBalance),
      totalIn: String(s.totalIn),
      totalInHuman: toHuman(s.totalIn),
      totalOut: String(s.totalOut),
      totalOutHuman: toHuman(s.totalOut),
      txnCount: s.txnCount,
      firstSeen: new Date(s.firstSeen * 1000).toISOString(),
      lastSeen: new Date(s.lastSeen * 1000).toISOString(),
    };
  });

  // thresholds
  const minRaw = MIN_NGMI > 0 ? BigInt(Math.round(MIN_NGMI)) : null;
  const minRawByUsd = MIN_USD > 0 && priceUsd > 0 ? BigInt(Math.round((MIN_USD / priceUsd) * 10 ** decimals)) : null;
  const effectiveMin = minRawByUsd ?? minRaw ?? 0n;

  const system = rows.filter((r) => !r.executable && (r.ownerProgram === SYSTEM || r.ownerProgram == null));
  const qualified = system.filter((r) => BigInt(r.finalBalance) >= effectiveMin || BigInt(r.maxBalance) >= effectiveMin);

  // percentiles for advice
  const humans = system.map((r) => r.maxBalanceHuman).sort((a, b) => a - b);
  const pct = (p) => humans[Math.floor((p / 100) * (humans.length - 1))] ?? 0;

  const payload = {
    mint: MINT,
    tokenProgram: TOKEN_2022,
    analysedAt: new Date().toISOString(),
    signatures: signatures.length,
    missingTransactions: missing,
    ownerCount: rows.length,
    systemWalletCount: system.length,
    qualifiedCount: qualified.length,
    thresholds: {
      minNgmiRaw: MIN_NGMI || null,
      minUsd: MIN_USD || null,
      priceUsd: priceUsd || null,
      effectiveMinRaw: String(effectiveMin),
    },
    percentiles: {
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
    `wrote ${OUT} (${rows.length} owners, ${qualified.length} qualified with threshold ${effectiveMin})\n`
  );
  console.log(JSON.stringify({ percentiles: payload.percentiles, qualifiedCount: qualified.length, systemCount: system.length }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
