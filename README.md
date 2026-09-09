# NGMI

Will this FOMO or PumpFun trader’s **leaderboard total PnL** print over **$X** before this **datetime**?

Binary USDC pots on Solana. One data source: [FomoScan](https://api.fomoscan.sh/docs). FOMO pots judge `GET /v2/leaderboard/traders?window=all`, field `pnl`. Pump.fun pots judge a **cumulative** number: the tote sums the change in `pnlUsd` across `GET /v2/pump/leaderboard/traders?period=weekly` prints, because FomoScan has no pump `all` window and the weekly figure resets. A pot may be created only if the handle is on the current top-25 board and `T` is within three days.

Default settle is **first-print**: the next board print over the mark, at or after the pot opened, resolves YES and closes betting. FOMO `window=all` is pulled hourly; pump.fun weekly is pulled daily (the fleet board only moves about once a day). A leftover file after a failed refresh does not first-print. **Close-at-T** waits for a print at or after T. Off-board at T cancels. Empty opposing pool cancels (refunds). YES iff `end_pnl >= threshold`. The program does not call FomoScan; a dedicated resolver posts `end_pnl_usd`.

MIT. Tote UI is not in this repository.

**Program id** (localnet / devnet): `CnJCzEEpfxtDWex5rA5c1H5A5YZQPqSG2LjnhxwRLMQM`

| | |
|---|---|
| Audit | [docs/audit/](docs/audit/) |
| Brief | [AUDIT.md](AUDIT.md) |
| Report a bug | [SECURITY.md](SECURITY.md) |
| vs parent template | [docs/UPSTREAM.md](docs/UPSTREAM.md) |

## Layout

```
programs/fomo-pnl/        Anchor pot (SPL USDC)
services/fomoscan/        Leaderboard client
services/keeper/          Settles due pots from one board print
services/telegram-bot/    Public-group feedback Menu
packages/shared/          6-decimal compare + rake helpers
```

## Toolchain

Anchor **0.32.1** · Rust **1.89.0** · pnpm 10 · Node 22+. Stay on Anchor 0.32 for the first deploy ([AGENTS.md](AGENTS.md)).

## Roadmap

Clawpump Ansemhack and bootstrap - first agent constantly analysing $NGMI buy and burn and other metrics
Agentic Company - rake admin key to agent for constant data driven optimisation

## Env

Copy `.env.example` → `.env`. Only `FOMOSCAN_API_KEY` is required to call the board API.

| Variable | Required | Purpose |
|---|---|---|
| `FOMOSCAN_API_KEY` | yes (board client) | FomoScan bearer token |
| `FOMOSCAN_API_KEY_2` | no | Spare key for a one-shot cache seed |
| `FOMOSCAN_API_KEY_3` | no | Paid / extra live board key |
| `FOMO_SERVER_KEYPAIR` | no locally | JSON byte array; else `~/.config/solana/id.json` |
| `SOLANA_RPC_URL` | no | Scripts; defaults to public devnet |
| `MAINNET_ADMIN` / `MAINNET_FOUNDER` / `MAINNET_RESOLVER` | mainnet init | Role pubkeys for `pnpm mainnet:init`: Squads vault admin, founder cold key, resolver hot key |
| `MAINNET_AGENT_TREASURY_OWNER` | mainnet init | Agent treasury owner (dedicated ops key); must differ from the burn treasury owner — one owner has exactly one ATA per mint |
| `MAINNET_RAKE_OWNER` / `MAINNET_BURN_TREASURY_OWNER` / `MAINNET_FEE_RECIPIENT` / `MAINNET_MODE` | no | Mainnet init overrides; owners default to the vault, mode defaults to `squads` (emit payloads only) |
| `MAINNET_ACK` | mainnet init | Must be `YES`; acknowledgment gate for mainnet init |
| `TWITTERAPI_API_KEY` | no | TwitterAPI.io key; platform events post to `@ngmi_cto` and new originals copy into the group |
| `TWITTERAPI_PROXY` | yes (CTO posts) | Sticky Webshare URL; same proxy on login and every v2 write |
| `WEBSHARE_API_KEY` | no | Webshare dashboard token for the CTO proxy account (list/manage proxies) |
| `TWITTER_CTO_USERNAME` | no | Handle to post as; default `ngmi_cto` |
| `TWITTER_CTO_EMAIL` | first login | CTO account email (not needed once the session is Active) |
| `TWITTER_CTO_PASSWORD` | first login | CTO account password |
| `TWITTER_CTO_TOTP_SECRET` | first login | TOTP seed if 2FA is on |
| `TWITTER_CTO_AUTH_TOKEN` | no | Optional X `auth_token` cookie to resume a session |
| `X_CLIENT_ID` | no | OAuth 2.0 Client ID fallback if TwitterAPI.io is unset |
| `X_CLIENT_SECRET` | no | OAuth 2.0 Client Secret |
| `X_OAUTH_REDIRECT_URI` | no | Portal callback; default `http://localhost:3000/api/oauth/x/callback` |
| `NEXT_PUBLIC_APP_URL` | no | Canonical origin for that callback |
| `SOLANA_MAINNET_RPC_URL` | no | Holdings lookup for tweets; public mainnet if unset |
| `ADMIN_TOKEN` | no | Gates every privileged tote route (stats, keeper tick, announce, traders, X status). Production denies them when unset |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | no | `devnet` (default) or `mainnet`; faucet/demo routes answer on devnet only |
| `TELEGRAM_BOT_TOKEN` | yes (feedback bot) | BotFather token |
| `TELEGRAM_GROUP_ID` | no | If set, Menu and posts are scoped to that group; otherwise any group the bot is in |
| `TWITTER_BEARER_TOKEN` | no | X app Bearer; if set, new official posts are copied into the group |
| `TWITTER_USERNAME` | no | Handle to share; default `ngmidotmarkets` |
| `TWITTERAPI_CTO_USERNAME` | no | Handle for the TwitterAPI.io group poll; default `ngmi_cto` |

Never commit a real keypair, X token, bot token, or `.env`. Platform events post to `@ngmi_cto` via TwitterAPI.io when `TWITTERAPI_API_KEY` is set: new market, new bet (side, stake, wallet, book), and resolved YES/NO. Login is `user_login_v2`; writes are `_v2` with the same sticky `TWITTERAPI_PROXY`. Unset `TWITTERAPI_API_KEY` falls back to the connected OAuth account (`X_CLIENT_ID`); unset both leaves posting a no-op.

Group feedback: add the bot to the public group (admin if you want it to delete the raw `/feedback` command). Then `pnpm --filter @fomopred/telegram-bot start`. Members use the Menu next to the message field. Exploitable bugs still go through [SECURITY.md](SECURITY.md), not that channel. With `TWITTER_BEARER_TOKEN` set, the same process copies new original posts from `TWITTER_USERNAME` (default `ngmidotmarkets`) into that group every 15 minutes. The first poll only records the latest id (no history dump). Unset the Bearer to leave sharing off. X credits must be > $0 or those reads fail. With `TWITTERAPI_API_KEY` set, a second 15-minute poll copies new original posts from `TWITTERAPI_CTO_USERNAME` (default `ngmi_cto`) via TwitterAPI.io `GET /twitter/user/last_tweets` (replies, retweets, and quotes skipped). An empty first poll seeds id `0` so the next original is posted, not skipped as history. Unset the TwitterAPI.io key to leave CTO sharing off.

## Verify

```bash
pnpm install
pnpm test
cargo test -p fomo_pnl settle
# anchor test    # full Solana lifecycle (needs Anchor CLI)
```

Product changes vs the parent pot:

```bash
git diff $(git rev-list --max-parents=0 HEAD) HEAD -- programs/fomo-pnl
```

## Acknowledgements

The on-chain pot is specialized from [SivaramPg/solana-simple-prediction-market-contract](https://github.com/SivaramPg/solana-simple-prediction-market-contract) (MIT, educational). Snapshot and delta: [NOTICE](NOTICE), [docs/UPSTREAM.md](docs/UPSTREAM.md).

Build playbook: the [Solana Foundation `solana-dev` skill](.agents/skills/solana-dev/SKILL.md) (Anchor 0.32, Kit, Surfpool).

Security pass: the [Trail of Bits Solana vulnerability-scanner skill](.agents/skills/solana-vulnerability-scanner/SKILL.md) (six account-model patterns). Written report: [docs/audit/](docs/audit/).
