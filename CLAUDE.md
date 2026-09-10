# CLAUDE.md

Read `AGENTS.md` first — it is the deploy/ops playbook and the source of
truth, including the **Live state** section (program id, roles, keeper
crons, sim fleet). Before any program, wallet, RPC, or deploy work also read
`.agents/skills/solana-dev/SKILL.md`; after `anchor test` and before any
cluster with real USDC read
`.agents/skills/solana-vulnerability-scanner/SKILL.md`.

Non-negotiables:

- Never `solana program close` on any cluster — redeploys upgrade in place
  onto the same program id. Irreversible authority actions need explicit
  operator approval, devnet included.
- `apps/web` (tote UI) is local-only and gitignored — never commit it.
  Deploy per `.cursor/rules/tote-staging.mdc`: rsync `apps/web` into
  `/tmp/ngmi-stage` (keep its `.vercel` / `.env.local`), then
  `npx --yes vercel@latest deploy --prod --yes --cwd /tmp/ngmi-stage --scope frsr --logs`.
- This tree is the public repo: keep the stranger first-read true
  (`.cursor/rules/public-repo.mdc`). Never commit secrets, keypairs,
  tokenized RPC URLs, or `docs/plans/`. When you change an instruction,
  role, env var, or settle rule, update the matching public doc in the same
  change.
- Env: `set -a && source .env && set +a` before running scripts. Mainnet
  mutations require `CLUSTER=mainnet MAINNET_ACK=YES`.
- Root gate: `pnpm test`. After a CPI/PDA/instruction change, re-run the
  six-pattern scan and add a NEW dated file under `docs/audit/`.

Quick map:

- Program (mainnet): `CnJCzEEpfxtDWex5rA5c1H5A5YZQPqSG2LjnhxwRLMQM`;
  resolver hot key `4yWsk3gkSbJa5zdQnndDDGmMB2DPH8U5uJrRqosGhviR`
  (`~/.config/fomo/mainnet-resolver.json`); admin = Squads vault.
- Keeper: `.github/workflows/board-tick.yml` (hourly) →
  `https://ngmi.markets/api/keeper/tick`. Tote server secret
  `FOMO_SERVER_KEYPAIR` must equal the on-chain resolver — verify the
  derived pubkey after any rotation.
- Sim fleet: `services/sim` — `pnpm sim:run` (loop), `pnpm sim:fund`
  (top up agent wallets), `pnpm sim:report` (reconcile). Agent wallets at
  `~/.config/fomo/sim-agent-{1,2,3}.json`.
- Audits: `docs/audit/` (latest first). Anchor stays on 0.32 until the
  planned migration (`references/anchor/migrating-v0.32-to-v1.md` in the
  solana-dev skill).
