/**
 * Build a final airdrop roster from the enriched NGMI holder snapshot.
 *
 * Reads data/ngmi-holders-gpa-pumpfun.json and applies filters, then calculates
 * per-wallet amounts. Output is ready to feed into an airdrop script.
 *
 *   pnpm airdrop:roster
 *   MIN_BALANCE=100000 PUMP_USER_ONLY=1 TOTAL_AIRDROP=1000000 pnpm airdrop:roster
 *   MODE=proportional TOTAL_AIRDROP=1000000 pnpm airdrop:roster
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const IN = process.env.IN ?? path.join(ROOT, "data", "ngmi-holders-gpa-pumpfun.json");
const OUT = process.env.OUT ?? path.join(ROOT, "data", "ngmi-airdrop-roster.json");

const MIN_BALANCE = Number(process.env.MIN_BALANCE ?? 0);           // whole NGMI tokens
const MAX_BALANCE = Number(process.env.MAX_BALANCE ?? 0);           // 0 = no cap
const MIN_FOLLOWERS = Number(process.env.MIN_FOLLOWERS ?? 0);
const PUMP_USER_ONLY = process.env.PUMP_USER_ONLY === "1" || process.env.PUMP_USER_ONLY === "true";
const HAS_X_USERNAME = process.env.HAS_X_USERNAME === "1" || process.env.HAS_X_USERNAME === "true";
const TOTAL_AIRDROP = Number(process.env.TOTAL_AIRDROP ?? 0);       // whole test tokens
const MODE = process.env.MODE ?? "equal";                         // equal | proportional
const DECIMALS = Number(process.env.DECIMALS ?? 6);                 // output token decimals

function toRaw(whole) {
  return BigInt(Math.round(whole * 10 ** DECIMALS));
}

function toHuman(raw) {
  return Number(raw) / 10 ** DECIMALS;
}

async function main() {
  const snap = JSON.parse(await readFile(IN, "utf8"));
  const decimals = snap.decimals ?? 6;
  const toToken = (n) => Number(n) / 10 ** decimals;

  let rows = snap.owners.filter((r) => {
    const bal = Number(r.balanceHuman ?? 0);
    if (bal < MIN_BALANCE) return false;
    if (MAX_BALANCE > 0 && bal > MAX_BALANCE) return false;
    const p = r.pumpfun;
    if (PUMP_USER_ONLY && (!p || !p.isPumpUser)) return false;
    if (HAS_X_USERNAME && (!p || !p.xUsername)) return false;
    if (MIN_FOLLOWERS > 0 && (!p || (p.followers ?? 0) < MIN_FOLLOWERS)) return false;
    return true;
  });

  if (rows.length === 0) {
    throw new Error("no wallets match filters");
  }

  let allocations = [];
  const totalRaw = toRaw(TOTAL_AIRDROP);

  if (MODE === "equal") {
    const each = totalRaw / BigInt(rows.length);
    allocations = rows.map((r) => ({ address: r.address, amountRaw: each, reason: "equal" }));
  } else if (MODE === "proportional") {
    const totalBalance = rows.reduce((sum, r) => sum + BigInt(r.balance), 0n);
    allocations = rows.map((r) => {
      const share = (BigInt(r.balance) * totalRaw) / totalBalance;
      return { address: r.address, amountRaw: share, reason: "proportional" };
    });
  } else if (MODE === "tiered") {
    const tiers = [
      { min: 0, amount: toRaw(TOTAL_AIRDROP / rows.length / 4) },
      { min: 100_000, amount: toRaw(TOTAL_AIRDROP / rows.length / 2) },
      { min: 1_000_000, amount: toRaw(TOTAL_AIRDROP / rows.length) },
      { min: 10_000_000, amount: toRaw(TOTAL_AIRDROP / rows.length * 2) },
    ].sort((a, b) => b.min - a.min);
    allocations = rows.map((r) => {
      const bal = Number(r.balanceHuman);
      const tier = tiers.find((t) => bal >= t.min) ?? tiers[tiers.length - 1];
      return { address: r.address, amountRaw: tier.amount, reason: `tier_${tier.min}` };
    });
  } else {
    throw new Error(`unknown MODE: ${MODE}`);
  }

  const totalAllocated = allocations.reduce((sum, a) => sum + a.amountRaw, 0n);
  const roster = allocations.map((a) => ({
    address: a.address,
    amount: String(a.amountRaw),
    amountHuman: toHuman(a.amountRaw),
    reason: a.reason,
  }));

  const payload = {
    source: IN,
    createdAt: new Date().toISOString(),
    filters: {
      minBalance: MIN_BALANCE,
      maxBalance: MAX_BALANCE || null,
      minFollowers: MIN_FOLLOWERS || null,
      pumpUserOnly: PUMP_USER_ONLY,
      hasXUsername: HAS_X_USERNAME,
    },
    distribution: {
      mode: MODE,
      totalAirdropHuman: TOTAL_AIRDROP,
      totalAirdropRaw: String(totalRaw),
      totalAllocatedRaw: String(totalAllocated),
      totalAllocatedHuman: toHuman(totalAllocated),
      recipients: rows.length,
    },
    roster,
  };

  await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`);
  process.stderr.write(
    `wrote ${OUT} (${rows.length} recipients, ${toHuman(totalAllocated)} tokens allocated)\n`
  );
  console.log(JSON.stringify({ recipients: rows.length, totalAllocated: toHuman(totalAllocated) }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
