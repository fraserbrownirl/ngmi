# Audit

Published review is **`programs/fomo-pnl` only**. Off-chain clients (tote UI, keeper, FomoScan HTTP) are out of scope and are not treated as open source here.

| Date | What | Result |
|---|---|---|
| 2026-08-30 | Trail of Bits six-pattern scan ([skill](../../.agents/skills/solana-vulnerability-scanner/SKILL.md)) | No hits. Notes only. |
| 2026-08-30 | Reconfirm after unpublishing the tote UI | Same six-pattern pass. Program unchanged. |
| 2026-09-01 | Devnet redeploy to a new program id ([note](2026-09-01-redeploy-devnet.md)) | Source unchanged. Previous id closed; current bytecode at `HALhAjDkAy6nJDk7LU5grN8GbChfNhi816aaVFj5iFxU`. |
| 2026-09-08 | Devnet redeploy to a new program id ([note](2026-09-08-redeploy-devnet.md)) | Source unchanged. Six-pattern scan re-run clean. Previous id abandoned (not closed); current bytecode at `pjfBomyM7swYJ9SuirxQWYqJfzfftSxYjhbGnpPsL2j`. |
| 2026-09-08 | Pre-mainnet program audit ([report](2026-09-08-pre-mainnet-program.md)) | No critical on-chain findings. One HIGH (creator ATA close forces refund) plus hardening items; go/no-go list in the report. Off-chain items tracked privately until fixed. |
| 2026-09-08 | Post-fix devnet redeploy to a new program id ([note](2026-09-08-post-fix-redeploy-devnet.md)) | All report findings fixed. Six-pattern scan re-run clean; scan + audits + `anchor test` now gated in CI. Previous id abandoned (not closed); current bytecode at `CnJCzEEpfxtDWex5rA5c1H5A5YZQPqSG2LjnhxwRLMQM`. |

- Engagement brief (roles, settle rules, what to send an external auditor): [`../../AUDIT.md`](../../AUDIT.md)
- Parent-template delta: [`../UPSTREAM.md`](../UPSTREAM.md)
- How to report a bug: [`../../SECURITY.md`](../../SECURITY.md)

Re-run after any instruction, PDA, or CPI change:

```bash
# skill checklist lives in .agents/skills/solana-vulnerability-scanner/
cargo test -p fomo_pnl settle
# anchor test   # full lifecycle
```
