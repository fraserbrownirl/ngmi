# Six-pattern reconfirm — 2026-08-30 (program-only tree)

Re-ran the [scanner skill](../../.agents/skills/solana-vulnerability-scanner/SKILL.md) after removing the tote UI from the published repository. Program source unchanged since [2026-08-30-trail-of-bits-six-pattern.md](./2026-08-30-trail-of-bits-six-pattern.md).

**Scope:** `programs/fomo-pnl` only. `apps/web` is local/gitignored — not reviewed, not shipped.

| # | Pattern | Result |
|---|---|---|
| 1 | Arbitrary CPI | Pass — no `invoke` / `invoke_signed`; SPL via `Program<'info, Token>` |
| 2 | Improper PDA validation | Pass — Anchor `seeds` + stored bumps |
| 3 | Missing ownership check | Pass — `UncheckedAccount` ATAs owner-checked before deserialize |
| 4 | Missing signer check | Pass — all authorities `Signer<'info>` |
| 5 | Sysvar spoof | Pass — `Clock::get()` only |
| 6 | Instruction introspection | Pass — unused |

`cargo test -p fomo_pnl settle` — 7 passed.

Notes unchanged: trusted resolver, `InvalidAdmin` leftover, unused `max_fee_bps`.
