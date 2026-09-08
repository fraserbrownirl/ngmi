# Security

On-chain review lives in [docs/audit/](docs/audit/). It is a Trail of Bits six-pattern pass, not a Big-4 audit. Derived from an educational pot template; see [NOTICE](NOTICE) and [docs/UPSTREAM.md](docs/UPSTREAM.md).

## Report a vulnerability

Use GitHub’s private vulnerability reporting (Security advisory) on this repository. Do not open a public issue for an exploitable bug. Do not send exploits through the Telegram group feedback Menu.

Include:

- Affected instruction or file
- What an attacker can do (funds, pause, false resolve)
- Cluster (localnet / devnet / mainnet) and program id if deployed

We will acknowledge reports and fix or document trust assumptions before any mainnet deploy.

## Trust assumptions (not bugs by themselves)

- `config.resolver` is a trusted oracle. The program does not fetch FomoScan on-chain.
- Whoever holds `config.resolver` is trusted to post an honest `end_pnl_usd`. That key is off-chain and not part of this repo’s published surface.
- Resolver **liveness** is a fund-safety dependency: there is no permissionless escape hatch. If the resolver key is lost, open pots can neither resolve nor cancel, and claims stay locked. Cancel after T is resolver-only; admin cannot cancel.
- `config.admin` rotates only through two-step `transfer_admin` / `accept_admin` (the pending admin must sign). There is no one-call rotation. Mainnet should still initialize with a multisig as admin.
- Resolve pays the founder slice to the **current** `rake.founder` (rotation mid-market redirects the slice of open pots). Founder/creator recipient ATAs are checked only when their slice is non-zero; an unpayable slice falls back to the burn treasury, so a closed ATA can never block resolution.
- Resolve records `captured_at` bounded to `[created_at, now + 300s]`; the resolver cannot backdate or future-date the oracle print beyond clock skew.
- Pause covers only `create_market` / `place_bet`. Resolve, cancel, claim, and rake operations run while paused — pause cannot halt settlement or trap funds.
- First-print markets can be sniped between a public over-mark print and the resolver transaction: betting stays open until T, so a late YES bet after the winning print is risk-free and dilutes early YES bettors. Mitigated operationally (prompt settlement), not on-chain.
- Upgrade authority on a live program must not be a hot single key before mainnet.

## Scope

In scope: `programs/fomo-pnl`.

Out of scope: tote UI, keeper, FomoScan availability, third-party RPC honesty, and phishing of user wallets.
