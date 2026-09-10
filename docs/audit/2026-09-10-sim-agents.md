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
- Agent funding on mainnet is pending operator top-up; funding txs will be
  appended here when they happen.

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
