# Audit brief (Solana / Anchor)

This is **not** an EVM or Solidity codebase. The pot is an Anchor 0.32 program on Solana. Submit this file plus the GitHub URL as the engagement description.

Program id (localnet / devnet): `6PMKc3TbVhbYPDCX73cAvFnEePKSgNy34167qeCVDP8e`

Source: [`programs/fomo-pnl/src/lib.rs`](programs/fomo-pnl/src/lib.rs)

Parent template and the product delta: [`docs/UPSTREAM.md`](docs/UPSTREAM.md)

## What it does

Users bet SPL USDC on whether a FOMO trader’s FomoScan all-time leaderboard `pnl` will print over a locked USD threshold before a locked datetime. YES iff `end_pnl >= threshold`. Empty opposing pool cancels (refunds). Default settle is first-print (resolver may post as soon as the printed PnL is over the mark). Close-at-T waits for the deadline.

The program **does not** call FomoScan. A trusted `config.resolver` posts `end_pnl_usd` and `captured_at`.

## Privileged roles

| Role | Stored on | Can |
|---|---|---|
| `config.admin` | Config PDA | pause / unpause, `update_config`, `set_resolver`, `init_rake` |
| `config.resolver` | Config PDA | `resolve_market`, `cancel_market` (after T) |
| rake `owner` | Rake PDA | `set_rake`, two-step `transfer_rake_owner` |
| rake `founder` | Rake PDA | receive founder slice; `set_founder` (founder-signed) |

Resolver is a **trusted oracle**. A compromised resolver can post a false `end_pnl_usd` and pick the winning side. That is by design, not a missed CPI.

## Instructions

`initialize`, `create_market`, `place_bet`, `resolve_market`, `cancel_market`, `claim_winnings`, `pause` / `unpause`, `update_config`, `set_resolver`, `init_rake`, `set_rake`, `transfer_rake_owner` / `accept_rake_owner`, `set_founder`.

Settlement math: [`programs/fomo-pnl/src/settle.rs`](programs/fomo-pnl/src/settle.rs). Rake is snapshotted onto the market at create; later `set_rake` does not rewrite open pots.

## Off-chain trust

- Keeper (`services/keeper`) decides when a pot is due from one board print, then the server signs `resolve_market` with `FOMO_SERVER_KEYPAIR` (or `~/.config/solana/id.json` locally).
- FomoScan API key lives on the server only (`FOMOSCAN_API_KEY`).
- Web faucet / resolve routes in `apps/web` are server-side.

## How to verify

```bash
pnpm install
pnpm test
cargo test -p fomo_pnl settle
# full lifecycle (needs Anchor 0.32 + Solana CLI):
anchor test
```

## Suggested focus

- PDA seeds and vault authority on create / bet / resolve / claim
- Resolver spoofing and whether anyone else can finalize
- `UncheckedAccount` founder/creator ATAs in [`resolve_market.rs`](programs/fomo-pnl/src/instructions/resolve_market.rs) (handler re-checks mint + owner)
- Pause / cancel griefing; first-print vs close-at-T timing
- Rake bps validation and floor-split leftovers
- Leftovers listed in [`docs/UPSTREAM.md`](docs/UPSTREAM.md) (`InvalidAdmin` on claim owner, unused `max_fee_bps`)
