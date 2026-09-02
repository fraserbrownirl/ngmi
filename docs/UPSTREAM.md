# Upstream delta

`programs/fomo-pnl` is specialized from [SivaramPg/solana-simple-prediction-market-contract](https://github.com/SivaramPg/solana-simple-prediction-market-contract) at `3353bc02ca005eca73725a7231ff1578087a2eaa` (MIT, educational, unaudited). Attribution: [NOTICE](../NOTICE).

The first commit on this repo is a **reconstructed baseline**: that snapshot with a path/crate rename only (`programs/prediction_market` → `programs/fomo-pnl`, crate `prediction_market` → `fomo_pnl`). No logic was changed in that commit. Review the product work with:

```bash
git diff $(git rev-list --max-parents=0 HEAD) HEAD -- programs/fomo-pnl
```

After this repo is on GitHub, the same range is `compare/<first>...<second>` on that remote.

## Intentional changes (read these)

| Template | This repo | Why |
|---|---|---|
| Admin signs `resolve_market` and passes `winning_outcome` (Yes/No) | `config.resolver` posts `end_pnl_usd`; program sets YES iff `end_pnl >= threshold` | Resolver cannot name the winner except by the number. Admin and resolver are different keys. |
| Free-text `question` | Locked `fomo_user_id`, `threshold_usd`, `start_pnl_usd`, `settle_kind` at create | The market cannot be retconned to a different trader or mark. |
| Resolve only after `resolution_time` | Close-at-T waits for T; first-print may resolve earlier when posted PnL is over the mark | Matches the tote rule (default first-print). |
| Empty opposing pool errors (`NoOpposition`) | Empty opposing pool **cancels** (refunds) | Dead pots should not trap stake. |
| Single admin for pause, config, resolve, cancel | Admin / resolver / rake owner / founder | Least privilege. Cancel after T is resolver, not admin. |
| Snapshots `config_max_fee_bps` onto the market at create | Does **not** snapshot `max_fee_bps`. Snapshots rake bps (`rake_bps`, burn/agent/creator/founder) at create | Later `set_rake` must not rewrite open pots. Creation fee is still a flat `fee_amount`. |
| No rake | Losing-pool rake split to founder, burn, agent, creator treasuries; founder/creator ATAs re-checked in the handler | Protocol take is on-chain and bounded (`validate_rake`). |
| — | Keeper + Next.js tote + FomoScan client | Off-chain: FOMO `window=all` hourly for every pot, pump.fun weekly daily. Pump pots judge a cumulative series (the weekly print resets); first-print ignores pre-open and stale leftover files. Server signer. Not in the program. |

Settlement helpers live in [`programs/fomo-pnl/src/settle.rs`](../programs/fomo-pnl/src/settle.rs) (new file vs the template).

## Leftovers (not improved)

These still match the template. Treat them as known, not as silent “best practice.”

- [`claim_winnings.rs`](../programs/fomo-pnl/src/instructions/claim_winnings.rs) still uses `PredictionMarketError::InvalidAdmin` on the position-owner check. The check is correct; the error name is not.
- `config.max_fee_bps` is still stored and writable. Tote/rake math does not read it. The template snapshotted it onto each market; we dropped that snapshot and did not delete the field.

## What the template still does that we kept

PDA seeds (`config`, `market`, `vault`, user position), pot math (winner share of the losing pool), pause, create-fee transfer, SPL token vault authority = market PDA.
