# Devnet redeploy — 2026-09-08

**Old program id:** `HALhAjDkAy6nJDk7LU5grN8GbChfNhi816aaVFj5iFxU`  
**New program id:** `pjfBomyM7swYJ9SuirxQWYqJfzfftSxYjhbGnpPsL2j`

## Why

A clean devnet deployment for short-lived demo markets. Settling due pots
cancels any market whose trader is off the current board, so rehearsing
synthetic prints against the shared id risked cancelling real pots. The fresh
id is disposable; the old one keeps serving the existing devnet markets.

## What changed

- No source code changes in `programs/fomo-pnl/src`.
- `Anchor.toml` and `programs/fomo-pnl/src/lib.rs` `declare_id!` updated to the new devnet program id.
- Generated `@fomopred/fomo-pnl-client` regenerated with Codama (`npx codama run js`) so the program id matches.
- The old program id was **abandoned, not closed** — its markets, config, and rake accounts stay readable, and the rent stays tied up. Closing burns the id permanently and orphans every account it owns.
- The new deployment was initialized with `scripts/devnet-init.ts` (`pnpm devnet:init`): config (admin/resolver/fee recipient = deploy wallet, maxFeeBps 0), rake 500/300/100/50 bps, fresh test-USDC mint (deploy wallet is mint authority). Market 1 was then created and resolved YES by `pnpm smoke:devnet`.

## Scan status

Six-pattern scan re-run on the unchanged source before deploy:

1. **CPI** — no raw `invoke`/`invoke_signed`; all token CPIs via anchor-spl typed helpers with `Program<'info, Token>`. Clean.
2. **PDA** — no manual `find_program_address`/`create_program_address`; all PDAs via Anchor `seeds` constraints. Clean.
3. **Manual deserialization** — one site (`require_usdc_ata` in `resolve_market.rs`), guarded by token-program owner check plus mint and owner-field checks. Clean.
4. **Signer** — authority accounts are Anchor `Signer<'info>`. Clean.
5. **Sysvar** — no sysvar accounts or instruction introspection. Clean.
6. **Introspection** — not used. Clean.

`anchor test` (22 tests) passed on this source before the deploy.

## Verification

- Program: https://explorer.solana.com/address/pjfBomyM7swYJ9SuirxQWYqJfzfftSxYjhbGnpPsL2j?cluster=devnet
- Config PDA: `Z2NC6EniZQ2UWXMrK2aEDKe8EEsojTeBWZNNVeMH5yK`
- Rake PDA: `GskmJXKDgi8aL5SJzea9SAUNeiaC1WPnnURSeWte2sMv`
- Test USDC mint: `H6SWqvmaixaeznXnXAVXwWriCJPPAT1b3pkyqK2LnH5R`
- Market 1 PDA: `GRd2QXdMHu9BGM7ngP9XJ9SWZqAvYkC93JqcSsV1XeBd`
