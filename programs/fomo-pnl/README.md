# fomo-pnl (Solana)

Derived from an educational pot template; see [docs/UPSTREAM.md](../../docs/UPSTREAM.md).

Anchor pot market. Create locks `(fomo_user_id, threshold_usd, resolution_time, start_pnl_usd, settle_kind)`. `window` stores settle kind: `0` close-at-T, `1` first-print. FomoScan PnL window is always `all`. Resolver posts `end_pnl_usd`; first-print may do that before T when `end_pnl >= threshold`. YES iff `end_pnl >= threshold`. Empty opposing pool cancels.

```bash
# needs Solana + Anchor 0.32
anchor test
# comparison only:
cargo test -p fomo_pnl settle
```
