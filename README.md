# NGMI

Will this FOMO trader’s **leaderboard total PnL** print over **$X** before this **datetime**?

Solana pots. One API: [FomoScan](https://api.fomoscan.sh/docs). PnL is `GET /v2/leaderboard/traders?window=all` field `pnl`. Create only if the trader is on the current top-25 `all` board and `T` is within three days. Default settle is first-print: the next board print over the mark resolves YES and closes betting. Close-at-T waits for the deadline print. Off-board at T cancels. No public resolve.

MIT. Derived from an educational binary pot — see [NOTICE](NOTICE) and [docs/UPSTREAM.md](docs/UPSTREAM.md). Program audit: [docs/audit/](docs/audit/). Engagement brief: [AUDIT.md](AUDIT.md). Reports: [SECURITY.md](SECURITY.md).

## Layout

```
programs/fomo-pnl/  Anchor pot program (Solana, SPL USDC)
apps/web/           Tote board + pots
services/fomoscan/  Handle + leaderboard client
services/keeper/    Settles due pots from one board print
packages/shared/    Shared 6-decimal compare
```

Program id (localnet / devnet): `6PMKc3TbVhbYPDCX73cAvFnEePKSgNy34167qeCVDP8e`

## Toolchain

- Anchor **0.32.1** (`Anchor.toml`)
- Rust **1.89.0** (`rust-toolchain.toml`)
- pnpm 10, Node 22+

Stay on Anchor 0.32 for the first deploy. See [AGENTS.md](AGENTS.md).

## Env

Copy `.env.example` → `.env`. Only `FOMOSCAN_API_KEY` is required for the board.

| Variable | Required | Purpose |
|---|---|---|
| `FOMOSCAN_API_KEY` | yes (board) | FomoScan bearer token |
| `FOMOSCAN_API_KEY_2` | no | Spare key for a one-shot cache seed |
| `FOMO_SERVER_KEYPAIR` | no locally | JSON byte array; else `~/.config/solana/id.json` |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | no | Defaults to `https://api.devnet.solana.com` |
| `SOLANA_RPC_URL` | no | Scripts; same default |
| `APP_URL` | no | Seed/e2e; defaults to `http://localhost:3000` |

Never commit a real keypair or `.env`.

## Verify

```bash
pnpm install
pnpm test
# cargo test -p fomo_pnl settle   # comparison unit tests
# anchor test                     # full Solana lifecycle (needs Anchor CLI)
pnpm dev
```

Review the pot vs the parent template:

```bash
git diff $(git rev-list --max-parents=0 HEAD) HEAD -- programs/fomo-pnl
```
