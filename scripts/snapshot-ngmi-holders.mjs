/**
 * Snapshot every wallet that has ever owned the NGMI Token-2022 mint.
 *
 * Method: paginate getSignaturesForAddress on the mint, fetch each tx, union
 * owners from pre/post token balances where mint matches and program is
 * Token-2022. Current-balance GPA is not complete (sellers drop out).
 *
 * Signature pagination uses a full-history RPC (SOLANA_MAINNET_RPC_URL or
 * api.mainnet-beta). Transaction fetch is single-call (no batches) and
 * rotates public endpoints with a short timeout so a stuck provider cannot
 * stall the scan.
 *
 * Output (gitignored via data/*.json) is the airdrop roster for community
 * testnet staging. Re-run immediately before the airdrop so the union is fresh.
 *
 *   pnpm snapshot:ngmi-holders
 *   SOLANA_MAINNET_RPC_URL=https://... pnpm snapshot:ngmi-holders
 */
import { mkdir, writeFile } from "node:fs/promises";
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
const OUT = process.env.OUT ?? path.join(ROOT, "data", "ngmi-holders.json");
const SIG_LIMIT = 1000;
const TX_CONCURRENCY = 6;
const ACCOUNT_BATCH = 100;

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
    if (attempt + 1 >= attempts) {
      throw new Error(`RPC ${res.status}: ${text.slice(0, 200)}`);
    }
    await sleep(backoff * 2 ** attempt);
    return rpcAt(url, method, params, { attempts, backoff }, attempt + 1);
  }
  if (!res.ok) {
    throw new Error(`RPC HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  if (body?.error) {
    throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  }
  return body.result;
}

async function rpcSig(method, params) {
  return rpcAt(SIG_RPC, method, params, { attempts: 10, backoff: 1000 });
}

async function rpcTx(method, params, start = 0) {
  let lastErr;
  let sawNull = false;
  for (let i = 0; i < TX_RPCS.length; i += 1) {
    const url = TX_RPCS[(start + i) % TX_RPCS.length];
    try {
      const result = await rpcAt(url, method, params);
      if (result != null) return result;
      sawNull = true;
    } catch (err) {
      lastErr = err;
    }
  }
  if (sawNull) return null;
  throw lastErr;
}

function collectOwners(tx, owners) {
  if (!tx?.meta) return;
  for (const list of [tx.meta.preTokenBalances, tx.meta.postTokenBalances]) {
    if (!list) continue;
    for (const bal of list) {
      if (bal.mint !== MINT) continue;
      if (bal.programId && bal.programId !== TOKEN_2022) continue;
      if (bal.owner) owners.add(bal.owner);
    }
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

async function unionOwners(sigs) {
  const owners = new Set();
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
      else collectOwners(tx, owners);
      done += 1;
      if (done % 100 === 0 || done === sigs.length) {
        process.stderr.write(`txs ${done}/${sigs.length} owners ${owners.size}\n`);
      }
    }
  };

  await Promise.all(Array.from({ length: TX_CONCURRENCY }, (_, id) => worker(id)));
  return { owners, missing };
}

async function classify(addresses) {
  const byAddr = new Map();
  for (let i = 0; i < addresses.length; i += ACCOUNT_BATCH) {
    const chunk = addresses.slice(i, i + ACCOUNT_BATCH);
    const infos = await rpcSig("getMultipleAccounts", [
      chunk,
      { encoding: "jsonParsed" },
    ]);
    chunk.forEach((addr, j) => {
      const acc = infos.value[j];
      byAddr.set(addr, {
        address: addr,
        executable: acc?.executable ?? false,
        ownerProgram: acc?.owner ?? null,
        lamports: acc?.lamports ?? 0,
      });
    });
  }
  return byAddr;
}

async function main() {
  const mintInfo = await rpcSig("getAccountInfo", [MINT, { encoding: "jsonParsed" }]);
  if (!mintInfo?.value) {
    throw new Error(`mint ${MINT} not found`);
  }
  if (mintInfo.value.owner !== TOKEN_2022) {
    throw new Error(`mint owner is ${mintInfo.value.owner}, expected Token-2022`);
  }

  const signatures = await allSignatures();
  const { owners, missing } = await unionOwners(signatures);
  const sorted = [...owners].sort();
  const classified = await classify(sorted);
  const rows = sorted.map((addr) => classified.get(addr));
  const airdrop = rows
    .filter((r) => !r.executable && (r.ownerProgram === SYSTEM || r.ownerProgram == null))
    .map((r) => r.address);

  const payload = {
    mint: MINT,
    tokenProgram: TOKEN_2022,
    scannedAt: new Date().toISOString(),
    rpcHost: new URL(SIG_RPC).host,
    signatures: signatures.length,
    missingTransactions: missing,
    ownerCount: rows.length,
    airdropCount: airdrop.length,
    owners: rows,
    airdrop,
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`);
  process.stderr.write(
    `wrote ${OUT} (${rows.length} Token-2022 owners, ${airdrop.length} system wallets)\n`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
