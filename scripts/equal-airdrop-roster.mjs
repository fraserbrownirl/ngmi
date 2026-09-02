/**
 * Build an equal-allocation airdrop roster from the curated CSV.
 *
 *   AMOUNT_USDC=1000 pnpm equal:airdrop-roster
 *
 * Output: data/ngmi-airdrop-roster-equal.json
 */
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const IN = process.env.IN ?? path.join(ROOT, "Downloads", "ngmi-airdrop-recommendations-2026-09-02.csv");
const OUT = process.env.OUT ?? path.join(ROOT, "data", "ngmi-airdrop-roster-equal.json");
const AMOUNT_USDC = Number(process.env.AMOUNT_USDC ?? 1000);
const SKIP_DUST = process.env.SKIP_DUST !== "0"; // default: exclude dust tier (<1k NGMI)
const DECIMALS = 6;
const MICRO = 10 ** DECIMALS;

// Minimal RFC-4180-ish CSV parser (no external deps).
function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

async function* readRows() {
  let header = null;
  for await (const line of createInterface(createReadStream(IN))) {
    if (!line.trim()) continue;
    const fields = parseCsvLine(line);
    if (!header) {
      header = fields;
      continue;
    }
    const row = {};
    header.forEach((h, i) => (row[h] = fields[i] ?? ""));
    yield row;
  }
}

const records = [];
for await (const record of readRows()) {
  if (record.action?.toUpperCase() !== "AIRDROP") continue;
  if (SKIP_DUST && record.tier_label === "dust") continue;
  records.push(record);
}

const roster = records.map((r) => ({
  address: r.owner,
  amount: String(BigInt(Math.round(AMOUNT_USDC * MICRO))),
  amountHuman: AMOUNT_USDC,
  tier: r.tier_label,
  pumpfunUsername: r.pumpfun_username || null,
  xUsername: r.x_username || null,
  outreachPriority: r.outreach_priority || null,
  mainnetSol: r.mainnet_sol_account || null,
  devnetSol: r.devnet_sol_recommended || null,
}));

const totalSol = records.reduce((sum, r) => sum + Number(r.devnet_sol_recommended || 0), 0);

const payload = {
  source: IN,
  createdAt: new Date().toISOString(),
  amountUsdcEach: AMOUNT_USDC,
  decimals: DECIMALS,
  recipients: roster.length,
  totalUsdc: roster.length * AMOUNT_USDC,
  totalSol,
  roster,
};

await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`);
process.stderr.write(`wrote ${OUT} (${roster.length} recipients, ${payload.totalUsdc} USDC, ${payload.totalSol} SOL)\n`);
console.log(JSON.stringify({ recipients: roster.length, totalUsdc: payload.totalUsdc, totalSol: payload.totalSol }, null, 2));
