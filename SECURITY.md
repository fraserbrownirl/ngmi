# Security

On-chain review lives in [docs/audit/](docs/audit/). It is a Trail of Bits six-pattern pass, not a Big-4 audit. Derived from an educational pot template; see [NOTICE](NOTICE) and [docs/UPSTREAM.md](docs/UPSTREAM.md).

## Report a vulnerability

Use GitHub’s private vulnerability reporting (Security advisory) on this repository. Do not open a public issue for an exploitable bug.

Include:

- Affected instruction or file
- What an attacker can do (funds, pause, false resolve)
- Cluster (localnet / devnet / mainnet) and program id if deployed

We will acknowledge reports and fix or document trust assumptions before any mainnet deploy.

## Trust assumptions (not bugs by themselves)

- `config.resolver` is a trusted oracle. The program does not fetch FomoScan on-chain.
- Whoever holds `config.resolver` is trusted to post an honest `end_pnl_usd`. That key is off-chain and not part of this repo’s published surface.
- Upgrade authority on a live program must not be a hot single key before mainnet.

## Scope

In scope: `programs/fomo-pnl`.

Out of scope: tote UI, keeper, FomoScan availability, third-party RPC honesty, and phishing of user wallets.
