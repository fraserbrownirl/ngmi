# Devnet redeploy — 2026-09-01

**Old program id:** `6PMKc3TbVhbYPDCX73cAvFnEePKSgNy34167qeCVDP8e`  
**New program id:** `HALhAjDkAy6nJDk7LU5grN8GbChfNhi816aaVFj5iFxU`

## Why

The devnet deployment at the previous program id was an older build that did not include the `init_rake` instruction required by the current `create_market` flow. Attempting to create a market with the current client failed with `InstructionFallbackNotFound` for `init_rake`. The old devnet program id was closed, its rent reclaimed, and the current codebase was redeployed to a fresh program id.

## What changed

- No source code changes in `programs/fomo-pnl/src`.
- `Anchor.toml` and `programs/fomo-pnl/src/lib.rs` `declare_id!` updated to the new devnet program id.
- Generated `@fomopred/fomo-pnl-client` regenerated with Codama so the program id matches.
- The previous devnet markets, config, and rake accounts are orphaned under the old program id; the new deployment started fresh with a new `initialize` + `init_rake` + market 1 created by the deploy wallet.

## Scan status

The six-pattern scan from `2026-08-30-trail-of-bits-six-pattern.md` still applies to the current source code; no new source changes were introduced, so no new code scan is required. The redeploy itself was preceded by a passing `anchor test` run (22 tests) on the same commit.

## Verification

- Program: https://explorer.solana.com/address/HALhAjDkAy6nJDk7LU5grN8GbChfNhi816aaVFj5iFxU?cluster=devnet
- Config PDA: `E17Kw6MsR2MsddSNqPWutrHBzB8cCyMXQ2LqqZHLnPa4`
- Rake PDA: `9WXLXCof8T28nDepuSMoymTSpMC28DpMVHeex5xD4vyu`
- Fake USDC mint: `C3DSDS51XgRUN8zKdzU3zvzVrsTVBkYLLsTS1dhSsKxz`
- Market 1 PDA: `HudzhnVrDAcvFyfJ8Honz7Db3Xy7a47BuiCVeGMk92VC`
