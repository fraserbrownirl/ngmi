#!/usr/bin/env node
/**
 * Generate apps/landing/testwallets.html from the airdrop roster.
 *
 * Reads data/ngmi-airdrop-roster-equal.json and emits a static table with
 * client-side balance fetching for devnet SOL and test USDC.
 *
 * pnpm generate:testwallets-page
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROSTER = join(__dirname, "../data/ngmi-airdrop-roster-equal.json");
const OUT = join(__dirname, "../apps/landing/testwallets.html");
const MINT = "C3DSDS51XgRUN8zKdzU3zvzVrsTVBkYLLsTS1dhSsKxz";

const roster = JSON.parse(readFileSync(ROSTER, "utf8"));
const rows = roster.roster.map((r) => ({
  wallet: r.address,
  x: r.xUsername || null,
  pumpfun: r.pumpfunUsername || null,
  fomo: null,
  followsNgmiMarkets: null,
}));

const tableRows = rows
  .map(
    (r, i) => `
    <tr data-wallet="${r.wallet}">
      <td class="mono"><a href="https://explorer.solana.com/address/${r.wallet}?cluster=devnet" target="_blank" rel="noopener">${r.wallet}</a></td>
      <td class="x">${renderX(r.x)}</td>
      <td class="pumpfun">${renderPumpfun(r.pumpfun)}</td>
      <td class="fomo"><span class="tag tag-tbd">TBD</span></td>
      <td class="follows"><span class="tag tag-tbd">TBD</span></td>
      <td class="balance mono" data-kind="sol">—</td>
      <td class="balance mono" data-kind="usdc">—</td>
    </tr>
  `
  )
  .join("");

function renderX(x) {
  if (!x) return `<span class="tag tag-none">none</span>`;
  return `<a href="https://x.com/${x.replace(/^@/, "")}" target="_blank" rel="noopener">@${x.replace(/^@/, "")}</a>`;
}

function renderPumpfun(pf) {
  if (!pf) return `<span class="tag tag-none">none</span>`;
  return `<a href="https://pump.fun/profile/${pf}" target="_blank" rel="noopener">${pf}</a>`;
}

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>NGMI Testnet Wallets</title>
    <meta name="description" content="Devnet wallets that received NGMI test SOL and test USDC." />
    <meta name="theme-color" content="#0a0614" />
    <link rel="icon" href="/bg.jpg" type="image/jpeg" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Schibsted+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body class="legal">
    <div class="sky" role="img" aria-label="Psychedelic space scene with meme coins and a rainbow figure holding a rising chart"></div>
    <div class="scrim" aria-hidden="true"></div>

    <header class="mast">
      <p class="mark"><a href="/">NGMI</a></p>
      <nav>
        <a href="https://x.com/ngmidotmarkets">X</a>
        <a href="https://github.com/fraserbrownirl/ngmi">GitHub</a>
        <a href="https://github.com/fraserbrownirl/ngmi/blob/main/AUDIT.md">Audit</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/testwallets" aria-current="page">Test Wallets</a>
      </nav>
    </header>

    <main>
      <section class="policy">
        <p class="kicker">Community Testnet</p>
        <h1>Testnet Wallets</h1>
        <p class="lede">
          ${rows.length} wallets that received devnet SOL and test USDC during the NGMI community testnet drop. Balances are fetched live from Solana devnet. FomoScan handles and X follow status are marked TBD until verified.
        </p>

        <div class="table-wrap">
          <table class="wallet-table">
            <thead>
              <tr>
                <th>Wallet</th>
                <th>X</th>
                <th>Pump.fun</th>
                <th>Fomo</th>
                <th>Follows @ngmi_markets</th>
                <th>Devnet SOL</th>
                <th>Test USDC</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </div>
      </section>
    </main>

    <script>
      const RPC = "https://api.devnet.solana.com";
      const MINT = "${MINT}";
      const rows = document.querySelectorAll(".wallet-table tbody tr");

      async function rpc(method, params) {
        const res = await fetch(RPC, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
        const json = await res.json();
        return json.result;
      }

      async function updateWallet(row) {
        const wallet = row.dataset.wallet;
        try {
          const sol = await rpc("getBalance", [wallet, { commitment: "confirmed" }]);
          row.querySelector('[data-kind="sol"]').textContent = (sol.value / 1e9).toFixed(4);
        } catch (e) {
          row.querySelector('[data-kind="sol"]').textContent = "err";
        }

        try {
          const token = await rpc("getTokenAccountsByOwner", [
            wallet,
            { mint: MINT },
            { encoding: "jsonParsed", commitment: "confirmed" },
          ]);
          const total = token.value.reduce((sum, v) => {
            const amount = v.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
            return sum + amount;
          }, 0);
          row.querySelector('[data-kind="usdc"]').textContent = total.toLocaleString(undefined, { maximumFractionDigits: 2 });
        } catch (e) {
          row.querySelector('[data-kind="usdc"]').textContent = "err";
        }
      }

      async function run() {
        for (const row of rows) {
          await updateWallet(row);
          await new Promise((r) => setTimeout(r, 120));
        }
      }

      run();
    </script>
  </body>
</html>
`;

writeFileSync(OUT, html);
console.log(`wrote ${OUT} with ${rows.length} rows`);
