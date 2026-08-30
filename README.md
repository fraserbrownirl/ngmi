# NGMI

Will this FOMO or PumpFun trader’s **leaderboard total PnL** print over **$X** before this **datetime**?

Binary USDC pots on Solana. A pot may be created only if the handle is on the current top-25 `all` board and `T` is within three days.

Default settle is **first-print**: the next board print over the mark resolves YES and closes betting. **Close-at-T** waits for the deadline print. Off-board at T cancels. Empty opposing pool cancels (refunds). YES iff `end_pnl >= threshold`. The program does not call FomoScan; a dedicated resolver posts `end_pnl_usd`.

MIT. Tote UI is not in this repository.

**Program id** (localnet / devnet): `6PMKc3TbVhbYPDCX73cAvFnEePKSgNy34167qeCVDP8e`

| | |
|---|---|
| Audit | [docs/audit/](docs/audit/) |
| Brief | [AUDIT.md](AUDIT.md) |
| Report a bug | [SECURITY.md](SECURITY.md) |
| vs parent template | [docs/UPSTREAM.md](docs/UPSTREAM.md) |

## Layout

```
programs/fomo-pnl/   Anchor pot (SPL USDC)
services/fomoscan/   Leaderboard client
services/keeper/     Settles due pots from one board print
packages/shared/     6-decimal compare + rake helpers
```

## Toolchain

Anchor **0.32.1** · Rust **1.89.0** · pnpm 10 · Node 22+. Stay on Anchor 0.32 for the first deploy ([AGENTS.md](AGENTS.md)).

## Roadmap

Clawpump Ansemhack and bootstrap - first agent constantly analysing $NGMI buy and burn and other metrics
Agentic Company - rake admin key to agent for constant data driven optimisation

## Verify

```bash
pnpm install
pnpm test
cargo test -p fomo_pnl settle
# anchor test    # full Solana lifecycle (needs Anchor CLI)
```

Product changes vs the parent pot:

```bash
git diff $(git rev-list --max-parents=0 HEAD) HEAD -- programs/fomo-pnl
```

## Acknowledgements

The on-chain pot is specialized from [SivaramPg/solana-simple-prediction-market-contract](https://github.com/SivaramPg/solana-simple-prediction-market-contract) (MIT, educational). Snapshot and delta: [NOTICE](NOTICE), [docs/UPSTREAM.md](docs/UPSTREAM.md).

Build playbook: the [Solana Foundation `solana-dev` skill](.agents/skills/solana-dev/SKILL.md) (Anchor 0.32, Kit, Surfpool).

Security pass: the [Trail of Bits Solana vulnerability-scanner skill](.agents/skills/solana-vulnerability-scanner/SKILL.md) (six account-model patterns). Written report: [docs/audit/](docs/audit/).
