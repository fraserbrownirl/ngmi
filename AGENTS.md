# NGMI

Solana-only. Anchor pot in `programs/fomo-pnl`. SPL USDC. FomoScan `window=all` `pnl`. Not Base. Not Robinhood.

Public GitHub: keep the stranger/auditor first-read true. Rule: `.cursor/rules/public-repo.mdc`. Tote UI (`apps/web`) is local only — never commit it.

## Skills (read before Solana work)

1. [`.agents/skills/solana-dev/SKILL.md`](.agents/skills/solana-dev/SKILL.md) — toolchain, `anchor build` / test / deploy, Kit wallet, Surfpool, compatibility matrix, `references/anchor/migrating-v0.32-to-v1.md`.
2. [`.agents/skills/solana-vulnerability-scanner/SKILL.md`](.agents/skills/solana-vulnerability-scanner/SKILL.md) — CPI / account / PDA scan after `anchor test`, before any cluster with real USDC.

Live docs MCP the Foundation skill expects: `https://mcp.solana.com/mcp`.

Stay on Anchor **0.32** for the first deploy if the workspace already builds. Do not jump to 1.1 mid-deploy. Do not add Jupiter / Pump / other DeFi skills.

## Deploy order

1. Pin CLI versions from `solana-dev` `references/compatibility-matrix.md`.
2. `anchor test` (or Surfpool). Then the Trail of Bits scanner.
3. `anchor deploy --provider.cluster devnet`. Write the program id into `Anchor.toml` and the web client.
4. Wire Phantom/Solflare via Kit (`solana-dev` frontend notes). Drop the local JSON pot / fake wallet.
5. Keeper posts `endPnl` on a first-print hit, or after T, with a dedicated resolver keypair.
6. Mainnet only after the scanner is clean and upgrade authority is not a hot single key.
