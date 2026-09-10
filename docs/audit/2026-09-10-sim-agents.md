# Trading-agent sim — 2026-09-10

Scope: `services/sim` (new package). No program changes; agents only ever
sign `place_bet` / `claim_winnings`. Resolution stays entirely with the
production keeper.

## What this is

Three autonomous agent wallets (`~/.config/fomo/sim-agent-{1,2,3}.json`,
outside the repo) that trade existing markets with a probability policy:
logistic gap-to-mark model, keeper foresight via the keeper's own
`decideFromBoard`, size-aware pool-breakeven edge including the 5% losing-pool
rake, a proximity guard that suppresses NO bets near the mark, deterministic
per-agent conviction jitter so agents disagree, and book-building rules
(opener / oppose / pile-in). Every evaluation is appended to
`services/sim/data/decisions.jsonl` (gitignored) with inputs, edge, and
rationale.

Safety rails: `MAINNET_ACK=YES` gate, `--dry-run` mode, per-agent rolling 24h
spend cap reconstructed from the decision log, bankroll/SOL floors,
per-market exposure cap, per-bet cap. Agents hold no privileged key material.

## Devnet proof (all txs on devnet explorer)

- Agent funding: 0.05 SOL + 10 test-USDC each from the deploy wallet.
- Market 8 opened for the test (trader `unipcs`, mark $18.34M, first-print).
- Agents opened the book (NO $0.25 x2), opposed (YES $1.15), hedged
  (NO $1.00 / $1.07) — decisions logged with edge math.
- Market resolved YES; winner claimed $3.59 (exact parimutuel payout),
  losing positions correctly skipped by the claim floor. Rake $0.13.
- `pnpm sim:report` reconciled: $30 funded = $29.87 liquid + $0.13 rake.

Two policy defects were found by the devnet run and fixed at the class level
(marginal vs size-aware breakeven; identical models never disagreeing), plus
a first-wake claim skip (ATA derived after the claim phase). 22 hermetic
policy tests cover the decision surface.

## Mainnet status

- Dry-run plumbing verified against mainnet (program read, market walk,
  funding guards, evaluation path). No active mainnet markets existed at
  check time (counter 1, the resolved smoke market), so live decision quality
  is observed once real markets exist.

### Mainnet funding (2026-09-10 ~09:00 UTC, from deploy wallet)

Each agent topped to $10 USDC + 0.05 SOL (operator budget: $10/agent, small
bets via `SIM_MAX_BET_USDC=0.5`):

- agent-1 `7i9tFn3e…`: SOL `41pzZU47QbrQ8M2aEx6NGJYwBPzbhZ7q2edhcQkZgZsd1D6oUbGYMH633WnA4MxopogMh7QKGwHWeZjcR7iugNGy`, USDC `3LdiMrUNHMwSRRYCTh7rRV6ro6exqpU2RpGsGUZwQrxxnoEHRShQ97cusxDhNBJmaeELbo3Xn45k8JvHgepjgpxR`
- agent-2 `Cw4zTRJ2…`: SOL `4gf4Qx1yRbbN6eb3xVA9i7xWRQfc3cBdVBxGJUNBu9AiMhc2KPd7aS5PCytpxJHyTU5SYVMuxBG2XXn6ob6FkrE1`, USDC `3iTMPj9LZdi99T8xxw7rporFvkzGMYgAGijeXyCXS62W8ADpWRYKo1YFNRWZEouNYsgm2pStpbLqq1AWupD1Knje`
- agent-3 `3Qb9hu4b…`: SOL `33EV7TdAKC8arJqoBj7zFgv9Rt1bdSkbAyNCxU4f95gaFh5JUEfKE7taPHcEybF97Ky6jCPb8Kred8NPa7HVWQef`, USDC `V2rpVL9STh6TTnProYMJKaHWdQQTP4yBgg4XQB3zQqnojootBSVk3QmdaiHQMJhuxMiezgmpVkJpoHpB4wpgzVi`

### Mainnet market-making (2026-09-10)

The fleet gained a designated maker (`SIM_MARKET_MAKER`, default agent-1) that
creates a market only when none are active: real top-25 board trader, mark =
board PnL × 1.03 priced off a **forced fresh print**, 45-min first-print term.
Rationale: the operator's UX test loop needs pots that certainly settle at the
next hourly keeper tick, with as few markets as possible.

- Market 2: @pointfarmcap, start $6,595,552.90 → mark $6,793,419.49, T
  09:45:17 UTC, first-print. Create tx
  `2Kx8qw6KL8qKHxH74p3utp7mqHP46zwvZ2K7Prhj5X56G19gytv2HmZ7i14UeGwvwTuNFZnR1hZfbMFGioPv2cbv`.
  The trader crossed the mark within a minute of creation (the plan priced a
  ~10-min-cached board); agents correctly abstained (foregone YES, empty-book
  opener suppressed), pools stayed empty. The fresh-print fix landed after
  (`a036c05`) and applies from market 3.

### Market 2 settled NO (2026-09-10, 10:47 UTC)

- The first settle attempt (manual tick dispatch, 10:32 UTC) failed on-chain.
  Decoding the nested Kit error (5663037 = "simulation failed during
  resource estimation" wrapper; leaf program logs) gave the real cause:
  `AnchorError caused by account: resolver — InvalidResolver (6001)`. The
  tote's Vercel `FOMO_SERVER_KEYPAIR` production secret predated mainnet
  init (set 2026-09-08) and was not the on-chain `config.resolver`
  (`4yWsk3…`). Contributing factor: the hourly cron had never fired —
  `.github/workflows/board-tick.yml` landed on main at 08:53 UTC the same
  day, so the manual dispatch was the first-ever run.
- Fix: the secret was replaced with the resolver keypair from
  `~/.config/fomo/mainnet-resolver.json` (derived pubkey verified equal to
  on-chain `config.resolver` before deploy), the tote redeployed, and the
  tick re-dispatched.
- Settle tx
  `csjj2ocDycq6L9jwD6or4DW7dx8pwJi7nKWFLr4G7ZTWnfAvRUiFFupJCJoYJxFZJyeAxZsJucp17eaYQVeT6KY`:
  endPnl $6,445,029.78 < mark $6,793,419.49 → NO. The trader pumped past
  the mark within a minute of creation, then dumped back below before T.
- Class fix recorded in AGENTS.md (keeper operations): any rotation of
  `FOMO_SERVER_KEYPAIR` must derive the pubkey and assert it equals on-chain
  `config.resolver` before deploy — the same assert `cluster-smoke.ts` runs.
- Book: NO $0.25 (agent-1) vs YES $2.19 (five bets across agents 1/2/3).
  agent-1 held the only winning ticket and claimed +$2.33 (stake back plus
  the losing pool less 5% rake) on the loop's next wake: tx
  `64AoB7P7pL1anK1m3UEXVT66DX9ojwUcgw4FwVNnUMxZ4HhoDrdkPvh6VoxH3KmuReh3TqRTMYSXNaMnfLSjhS23`.
  Full mainnet lifecycle now verified end-to-end through the production
  keeper path: create → two-sided book → resolver settle via tote tick →
  permissionless claim.
- Market 3 (created via the tote UI by an outside wallet: 3-day term, mark
  $7.35M = the UI's +10% default on DumbCrayonEater) is active with one NO
  $0.25 opener (agent-3, tx `4uL1wZjG…`). The sim maker stays idle while any
  market is active (`SIM_MAX_ACTIVE_MARKETS=1`).

## Operator considerations

Agent bets are real mainnet activity, visible on the tote and in the keeper's
bet-announce posts. The sim is in the public repo deliberately: activity
sourcing stays auditable.

## Dependency advisories (CI `pnpm audit --prod`)

The sim's prod deps pull three high advisories with no patched release,
ignored in root `package.json` (`pnpm.auditConfig.ignoreGhsas`):

- `GHSA-3gc7-fjrx-p6mg` — `bigint-buffer@1.1.5` via `@solana/spl-token`.
  Unmaintained; spl-token calls `toBigIntLE` on fixed 8-byte amount buffers,
  not attacker-controlled lengths.
- `GHSA-82x6-q7mm-w9cf`, `GHSA-v5mp-jgw5-2x6j` — `toml@3.0.0` via
  `@coral-xyz/anchor` (pinned 0.32 per deploy rule). Anchor TS parses its own
  shipped IDL, not untrusted TOML.

Re-check on the Anchor 1.1 migration or if either path starts parsing
untrusted input.
