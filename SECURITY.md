# Security

This program is unaudited until an engagement is published. It is derived from an educational pot template; see [NOTICE](NOTICE) and [docs/UPSTREAM.md](docs/UPSTREAM.md).

## Report a vulnerability

Use GitHub’s private vulnerability reporting (Security advisory) on this repository. Do not open a public issue for an exploitable bug.

Include:

- Affected instruction or file
- What an attacker can do (funds, pause, false resolve)
- Cluster (localnet / devnet / mainnet) and program id if deployed

We will acknowledge reports and fix or document trust assumptions before any mainnet deploy.

## Trust assumptions (not bugs by themselves)

- `config.resolver` is a trusted oracle. The program does not fetch FomoScan on-chain.
- The server keypair that signs resolve / faucet must stay off the client.
- Upgrade authority on a live program must not be a hot single key before mainnet.

## Scope

In scope: `programs/fomo-pnl`, the keeper decision path, and server-side signing in `apps/web`.

Out of scope: FomoScan availability, third-party RPC honesty, and phishing of user wallets.
