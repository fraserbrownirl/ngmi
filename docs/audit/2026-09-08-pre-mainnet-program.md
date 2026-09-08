# Pre-mainnet program audit — 2026-09-08

Scope: `programs/fomo-pnl` only (the published audit surface). Full-platform
review was performed the same day; off-chain items (tote, keeper, posting
pipeline) are tracked privately until fixed, per `SECURITY.md` scope.

Toolchain: anchor-cli 0.32.1 · solana-cli 2.1.21 (Agave) · rustc 1.89.0.

## Verdict

No critical on-chain findings. One HIGH (creator can force a refund by closing
their USDC token account) and a set of medium/low hardening items, all with
concrete fix directions. The program is **not** mainnet-ready until the HIGH
and the go/no-go operational items below are closed.

## Findings (program scope)

### HIGH — Unconditional creator/founder ATA checks in `resolve_market`

`resolve_market.rs:129–139` runs `require_usdc_ata` on the creator and founder
token accounts before any slice is computed, even when the slice floors to
zero (`pay_from_vault` skips `amount == 0`, but the check is unconditional).
A creator who **closes** their USDC ATA makes resolve always revert; the only
remaining path is resolver `cancel_market` after T, refunding everyone. A
creator who also bet therefore holds a free option: force a refund whenever
their side is losing. (Freeze only blocks when a non-zero transfer to the ATA
is attempted; empty-pool books early-cancel at lines 123–127 before the
checks, so only non-empty books are exposed.)

**Fix direction:** compute `rake_split` first; check the creator ATA only when
`split.creator > 0`, and route an unpayable creator slice to the founder/burn
slice instead of erroring. Same treatment for the founder ATA (below).

**Status:** open — fix before mainnet, with regression test (creator closes
ATA after betting; resolve still succeeds; slice falls back).

### MEDIUM — Founder ATA is a protocol-wide settle dependency

Same helper on `founder_token` (`resolve_market.rs:130–134`). A closed founder
ATA blocks *every* non-empty resolve until re-created. Note also that resolve
pays the **live** `rake.founder` (rotation mid-market redirects the slice of
open pots), while `market.creator` is frozen at create. Same fix class as the
HIGH above; document the live-founder lookup in `SECURITY.md`.

### MEDIUM — `config.admin` is immutable

No `set_admin` exists; `update_config` writes only `fee_recipient` and
`max_fee_bps` (`update_config.rs:15–20`). A lost/compromised admin key is
permanent. Mainnet must initialize with the multisig as admin — a one-shot,
go/no-go decision. (Resolver, rake owner, and founder are all rotatable.)

### MEDIUM — Negative-test gaps

`tests/fomo_pnl.ts` has good behavioral negatives (window, threshold, settle
kind, double claim, rake validation, owner/founder auth) but is missing:
wrong-signer tests for `resolve_market` / `cancel_market` / `pause` /
`set_resolver`; a wrong-mint test; an explicit `cancel_market` test with
refund claims; a wrong-owner claim test; and the ATA-closed regression tests
above. **Status:** open — add before mainnet.

### LOW — Create-fee recipient unbound; `max_fee_bps` dead

`create_market.rs:54–56` constrains `fee_recipient_token_account` only to the
mint; `fee_amount` is a free argument; `config.fee_recipient` / `max_fee_bps`
are writable but never read. **Decision needed:** enforce (bind the ATA owner
to `config.fee_recipient`, validate the fee) or delete the field and transfer.

### LOW — `set_resolver` accepts the default pubkey

`set_resolver.rs:15–17` has no non-default guard; setting resolver to
`Pubkey::default()` bricks settlement for all open pots. One-line check.

### INFO — trusted-resolver surface (documented assumptions)

- `captured_at` is stored unchecked (`resolve_market.rs:208–210`); no on-chain
  logic reads it. Bound to `[created_at, now]` or document.
- No permissionless escape hatch: resolver-key loss bricks open pots (cancel
  is resolver-only). Document as a trust assumption.
- Pause covers only `create_market` / `place_bet`; resolve/cancel/claim/rake
  run while paused. Document the intent.
- No sanity bounds on `threshold_usd` / `start_pnl_usd` beyond
  `start < threshold`.
- First-print markets can be sniped between a public over-mark print and the
  resolver tx (betting is open until T). Design property; mitigated
  operationally off-chain.
- Vault dust: floor leftovers stay in the vault; no account closes, rent never
  recovered. Accepted economics.
- Code notes: `saturating_sub(rake_total)` in claim is unreachable under
  consistent resolve; `share as u64` is bounded by `losing_pool`; both-side
  positions are intended.

### INFO — UPSTREAM leftovers (restated)

`claim_winnings.rs:30` uses `InvalidAdmin` for the position-owner check
(correct check, wrong name); `config.max_fee_bps` unused (see the LOW above).
Both should be fixed before mainnet; see `docs/UPSTREAM.md`.

## Verified not exploitable (with reasoning)

| Item | Why safe |
|---|---|
| `place_bet` / `claim_winnings` vaults lack `token::*` constraints | PDA seeds pin the vault; it can only be the account `create_market` initialized with the config mint and the market as authority |
| Claim user ATA lacks `token::mint` | SPL `Transfer` rejects mint mismatch |
| `burn_token` / `agent_token` lack `token::mint` in resolve | Pubkeys recorded under a mint constraint in `init_rake` / `set_rake`; token-account mint is immutable |
| Wrong-owner claim | Position PDA seeds include the user key; fails derivation first |
| `init_if_needed` on positions | Re-init guarded by `market_id == 0`; ids start at 1 |
| Arbitrary CPI / PDA / sysvar / introspection patterns | Absent — see scan output |
| Arithmetic | u128 intermediates, `checked_*`, `overflow-checks = true` in release |

## Gate output (2026-09-08)

Six-pattern scan (`invoke|find_program_address|try_from_slice|UncheckedAccount|AccountInfo|load_instruction_at`):
4 hits, all in `resolve_market.rs` (the two handler-validated
`UncheckedAccount`s + two `AccountInfo` parameters). Zero hits for raw CPI,
manual PDA derivation, manual deserialization outside the guarded helper, and
instruction introspection.

- `cargo test -p fomo_pnl settle` — 7 passed.
- `anchor test` — 22 passing (full lifecycle, four-wallet plan, rake
  authority).
- `cargo audit` (266 deps) — 0 vulnerabilities; 3 transitive warnings
  (bincode 1.3.3 unmaintained RUSTSEC-2025-0141; libsecp256k1 0.6.0
  unmaintained RUSTSEC-2025-0161; rand 0.7.3 RUSTSEC-2026-0097).
- `pnpm audit --prod` — clean.
- Secrets sweep — clean (history touches only `.env.example`; no key material
  in the tree).

## Go/no-go (program side)

Fix the HIGH and the founder-ATA MEDIUM with regression tests; add the missing
negative tests; decide enforce-or-delete on the create fee; fix the two
UPSTREAM leftovers; initialize mainnet with a multisig admin (no rotation
exists); re-run this scan and `anchor test` on the final build; publish a
verifiable build before mainnet.
