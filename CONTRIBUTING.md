# Contributing

## Verify

```bash
pnpm install
pnpm test
cargo test -p fomo_pnl settle
# full Solana lifecycle (Anchor 0.32 + Solana CLI):
anchor test
```

Copy `.env.example` → `.env`. Only `FOMOSCAN_API_KEY` is required to call FomoScan.

## Layout

- On-chain pot: `programs/fomo-pnl`
- Board client + keeper: `services/fomoscan`, `services/keeper`

The tote UI is not published.

## Agents

Read [AGENTS.md](AGENTS.md) before Solana, wallet, or deploy work. Use the vendored skills in `.agents/skills/` (Solana Foundation playbook, Trail of Bits scanner). Do not add Jupiter / Pump / other venue skills.

Security reports go through [SECURITY.md](SECURITY.md), not a public issue.
