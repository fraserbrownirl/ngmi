# NGMI

Solana-only. Anchor pot in `programs/fomo-pnl`. SPL USDC. FomoScan `window=all` `pnl`. Not Base. Not Robinhood.

Public GitHub: keep the stranger/auditor first-read true. Rule: `.cursor/rules/public-repo.mdc`. Tote UI (`apps/web`) is local only — never commit it.

## Skills (read before Solana work)

1. [`.agents/skills/solana-dev/SKILL.md`](.agents/skills/solana-dev/SKILL.md) — toolchain, `anchor build` / test / deploy, Kit wallet, Surfpool, compatibility matrix, `references/anchor/migrating-v0.32-to-v1.md`.
2. [`.agents/skills/solana-vulnerability-scanner/SKILL.md`](.agents/skills/solana-vulnerability-scanner/SKILL.md) — CPI / account / PDA scan after `anchor test`, before any cluster with real USDC.

Live docs MCP the Foundation skill expects: `https://mcp.solana.com/mcp`.

Stay on Anchor **0.32** for the first deploy if the workspace already builds. Do not jump to 1.1 mid-deploy. Do not add Jupiter / Pump / other DeFi skills.

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
- Upgrade authority = multisig, or frozen after a verified build. Deploy wallet plays no runtime role.
- Server env carries only the resolver key (`FOMO_SERVER_KEYPAIR`); no `~/.config/solana/id.json` fallback outside devnet.

Verification:

- Verifiable build (`solana-verify`) published and reproducible by a stranger; `[programs.mainnet]` in `Anchor.toml`.
- `anchor test` and the six-pattern scan run in CI on every PR, not just locally.
- The pre-mainnet audit's go/no-go checklist is closed (latest report in `docs/audit/`).

Live-service posture:

- Any route that signs with the server key, writes a store the settle path reads, or posts to X is authenticated and rate-limited (see `.cursor/rules/off-chain-privileged-routes.mdc`).
- Faucet and demo routes are env-gated and verified off in production; `ADMIN_TOKEN` is set.
- Never `solana program close` — on any cluster. Redeploys upgrade in place onto the same id.
