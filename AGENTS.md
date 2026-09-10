# NGMI

Solana-only. Anchor pot in `programs/fomo-pnl`. SPL USDC. FomoScan `window=all` `pnl`. Not Base. Not Robinhood.

Public GitHub: keep the stranger/auditor first-read true. Rule: `.cursor/rules/public-repo.mdc`. Tote UI (`apps/web`) is local only — never commit it.

## Skills (read before Solana work)

1. [`.agents/skills/solana-dev/SKILL.md`](.agents/skills/solana-dev/SKILL.md) — toolchain, `anchor build` / test / deploy, Kit wallet, Surfpool, compatibility matrix, `references/anchor/migrating-v0.32-to-v1.md`.
2. [`.agents/skills/solana-vulnerability-scanner/SKILL.md`](.agents/skills/solana-vulnerability-scanner/SKILL.md) — CPI / account / PDA scan after `anchor test`, before any cluster with real USDC.

Live docs MCP the Foundation skill expects: `https://mcp.solana.com/mcp`.

Stay on Anchor **0.32** for the first deploy if the workspace already builds. Do not jump to 1.1 mid-deploy. Do not add Jupiter / Pump / other DeFi skills.

## Live state (2026-09-10)

Mainnet-beta is deployed and initialized. Program id
`CnJCzEEpfxtDWex5rA5c1H5A5YZQPqSG2LjnhxwRLMQM`; verifiable build reproduced
from `3ce3ee8` (full chain of custody: `docs/audit/2026-09-09-mainnet-deploy.md`).

- `config.admin` / rake owner / fee recipient: Squads v4 vault
  `GMF3Qhhs2u8tgHChx1H2rFPGdYSgen6c3abnHJwrNdrD`. `config.resolver`:
  dedicated hot key `4yWsk3gkSbJa5zdQnndDDGmMB2DPH8U5uJrRqosGhviR`
  (secret at `~/.config/fomo/mainnet-resolver.json`, overridable via
  `FOMO_RESOLVER_KEYPAIR_FILE`).
- Upgrade authority: still the deploy wallet by explicit operator decision —
  the multisig/freeze gate below is OPEN until the beta label comes off.
- Tote: `https://ngmi.markets` (Vercel project `ngmi-stage`; deploy rule
  `.cursor/rules/tote-staging.mdc`).
- Settlement: GitHub Action `.github/workflows/board-tick.yml` (hourly cron
  plus `workflow_dispatch`) calls `https://ngmi.markets/api/keeper/tick`
  with a `CRON_SECRET` bearer. The keeper settles first-print hits and
  post-T markets, then reprints the board snapshots the tote serves. The
  Vercel cron in `apps/web/vercel.json` is a daily backstop only.
- Sim fleet: `services/sim` runs three agent wallets plus a designated
  market-maker against mainnet for dogfooding (`pnpm sim:run`; policy and
  audit: `docs/audit/2026-09-10-sim-agents.md`).

### Keeper operations

- The tote's `FOMO_SERVER_KEYPAIR` (Vercel production secret on
  `ngmi-stage`) must be the on-chain `config.resolver` secret and nothing
  else. After ANY rotation: derive the pubkey and assert it equals
  `config.resolver` before deploying (the assert in
  `scripts/cluster-smoke.ts` is the pattern). A stale key fails every settle
  with `InvalidResolver` (6001), surfaced through Kit as error 5663037 —
  decode nested error blobs with `npx -p @solana/errors errors decode --
  <code>` and read the leaf program logs. (Happened once:
  `docs/audit/2026-09-10-sim-agents.md`.)
- Changing any Vercel env/secret requires a redeploy to take effect.
- The resolver wallet needs a little SOL for settle fees (~0.01 SOL covers
  many settles); the smoke script tops it up from the deploy wallet when
  below 0.005 SOL.
- Keeper X posting is currently skipped ("unconfigured") in production.

## Deploy order

1. Pin CLI versions from `solana-dev` `references/compatibility-matrix.md`.
2. `anchor test` (or Surfpool). Then the Trail of Bits scanner.
3. `anchor deploy --provider.cluster devnet`. Write the program id into `Anchor.toml` and the web client, and regen the client (`npx codama run js`). Then `pnpm devnet:init` (config + rake 500/300/100/50 + fresh test-USDC mint; idempotent) and `pnpm smoke:devnet` (creates and resolves market 1). Redeploys upgrade the same id in place — never `solana program close` (burns the id forever, orphans every PDA it owns). Short on funds: stop and report; do not self-fund from program rent. After any id change, grep with gitignore disabled (`rg --no-ignore`) — local-only files (`apps/web`) still carry the old id.
4. Wire Phantom/Solflare via Kit (`solana-dev` frontend notes). Drop the local JSON pot / fake wallet.
5. Keeper posts `endPnl` on a first-print hit, or after T, with a dedicated resolver keypair.
6. Community testnet: airdrop test USDC to current NGMI holders.
   - Use `pnpm gpa:ngmi-holders` (recommended): `getProgramAccounts` on Token-2022 returns all live token accounts with balances in ~1 second. The qualified list is `data/ngmi-holders-gpa.json`.
   - Use `pnpm snapshot:ngmi-holders` only if you specifically need "ever held" history. It paginates mint signatures and is slow and unreliable on public RPC (many transactions return null).
7. Mainnet only after the scanner is clean and upgrade authority is not a hot single key.

## Mainnet gates (all must hold before `anchor deploy --provider.cluster mainnet`)

Key separation (admin rotation is two-step `transfer_admin`/`accept_admin` — still initialize with the right key):

- `initialize` with a Squads multisig as `config.admin`. Rotation exists but is two-step; a hot or wrong admin key at init is an incident, not a setting.
- `set_resolver` immediately after init: resolver = dedicated hot key that can only resolve/cancel. Never the admin, never the deploy wallet.
- Rake owner = multisig (two-step transfer exists); founder = separate cold key with a live USDC ATA (a closed founder ATA no longer blocks resolve — the slice falls back to the burn treasury — but the slice is then burned, not paid).
- Upgrade authority = multisig, or frozen after a verified build. Deploy wallet plays no runtime role. (Interim: the deploy wallet still holds it by operator decision, 2026-09-10 — this gate is OPEN.)
- Server env carries only the resolver key (`FOMO_SERVER_KEYPAIR`); no `~/.config/solana/id.json` fallback outside devnet.

Verification:

- Verifiable build (`solana-verify`) published and reproducible by a stranger; `[programs.mainnet]` in `Anchor.toml`.
- `anchor test` and the six-pattern scan run in CI on every PR, not just locally.
- The pre-mainnet audit's go/no-go checklist is closed (latest report in `docs/audit/`).

Live-service posture:

- Any route that signs with the server key, writes a store the settle path reads, or posts to X is authenticated and rate-limited (see `.cursor/rules/off-chain-privileged-routes.mdc`).
- Faucet and demo routes are env-gated and verified off in production; `ADMIN_TOKEN` is set.
- Never `solana program close` — on any cluster. Redeploys upgrade in place onto the same id.
