# Post-fix devnet redeploy — 2026-09-08

**Previous program id:** `pjfBomyM7swYJ9SuirxQWYqJfzfftSxYjhbGnpPsL2j`
**Current program id:** `CnJCzEEpfxtDWex5rA5c1H5A5YZQPqSG2LjnhxwRLMQM`

## Why

Follow-up to the [pre-mainnet audit](2026-09-08-pre-mainnet-program.md): every
finding in that report is now fixed in source. Because the `Config` struct
changed (`max_fee_bps` removed, `pending_admin` added for two-step admin
rotation), existing config accounts are ABI-incompatible, so the fixes ship on
a fresh devnet id. The previous id was **abandoned, not closed** — its
accounts stay readable and the rent stays tied up.

## What changed (on-chain)

- **Resolve no longer bricks on a closed recipient ATA** (HIGH). Founder and
  creator token accounts are validated only when their rake slice is non-zero;
  an unpayable slice falls back to the burn treasury, so a closed or wrong ATA
  can never block resolution.
- **Create-market fee is bound to the configured fee recipient**
  (`token::authority = config.fee_recipient` on `create_market`).
- **`max_fee_bps` removed** from `Config`, `initialize`, and `update_config`
  (was written, never read).
- **Two-step admin rotation**: `transfer_admin` stages `pending_admin`,
  `accept_admin` rotates it in. `set_resolver` rejects the default pubkey.
- **`captured_at` bounded** to the market window (`created_at` … chain time +
  300 s skew) in `resolve_market`.
- **`claim_winnings` wrong-owner error** renamed `InvalidAdmin` →
  `InvalidOwner` (was mislabeled; no behavior change).

Off-chain hardening from the same report (tote API auth, rate limits, tweet
sanitization, board-row validation, server-signer production guard) landed in
the same change set; per published scope those components remain out of the
audited surface.

## Gates

- Six-pattern scan re-run on the changed source: clean. The only manual
  deserializer is the founder/creator ATA check in `resolve_market.rs`,
  guarded by a token-program owner check plus mint and owner-field checks; the
  only `UncheckedAccount`s are those same two fallback accounts. Both are now
  enforced by `scripts/six-pattern-scan.sh` in CI.
- `anchor test` green, including 12 new negative/regression tests: non-resolver
  resolve/cancel, non-admin pause/set_resolver, default-pubkey resolver,
  wrong-mint bet, cross-user claim, closed founder/creator ATA fallback,
  zero-slice ATA skip, `captured_at` bounds, fee-recipient binding, two-step
  admin rotation.
- CI (`.github/workflows/test.yml`) now runs the six-pattern scan,
  `cargo audit`, `pnpm audit --prod`, and a full `anchor test` job.

## Verification

- Program: https://explorer.solana.com/address/CnJCzEEpfxtDWex5rA5c1H5A5YZQPqSG2LjnhxwRLMQM?cluster=devnet
- Config PDA: `4y5PYSv1GrvvYrD8xvnf5URgi1jLVxEXymW3gzxXuV1n` (`pending_admin` = default, as initialized)
- Rake PDA: `3Vfi1CYBmYv8uk3s8Umd7Eg7nMEsoE5aTKcJFwUcppSc` (500/300/100/50 bps)
- Test USDC mint: `Hm6tgDrnor3CCWneCgbiYameThHEf46p6SKfrYJhQ36z` (deploy wallet is mint authority)
- Smoke market 1 (created, both sides bet, resolved YES, claimed):
  `Btuwk5y4Ergrd7szLJmhepogKNvMJLZgdcjouSDkU1VD`
