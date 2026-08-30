# Audit

Published review is **`programs/fomo-pnl` only**. Off-chain clients (tote UI, keeper, FomoScan HTTP) are out of scope and are not treated as open source here.

| Date | What | Result |
|---|---|---|
| 2026-08-30 | Trail of Bits six-pattern scan ([skill](../../.agents/skills/solana-vulnerability-scanner/SKILL.md)) | No hits. Notes only. |

- Engagement brief (roles, settle rules, what to send an external auditor): [`../../AUDIT.md`](../../AUDIT.md)
- Parent-template delta: [`../UPSTREAM.md`](../UPSTREAM.md)
- How to report a bug: [`../../SECURITY.md`](../../SECURITY.md)

Re-run after any instruction, PDA, or CPI change:

```bash
# skill checklist lives in .agents/skills/solana-vulnerability-scanner/
cargo test -p fomo_pnl settle
# anchor test   # full lifecycle
```
