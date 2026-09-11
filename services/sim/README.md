# @fomopred/sim

Autonomous trading agents for the pot. Each agent has its own wallet (USDC +
SOL) and trades existing markets — `place_bet` and `claim_winnings`, never
resolve. Agents do not open markets by default; creation is opt-in (below).
Resolution stays
with the production keeper: agents read the same FomoScan `window=all` board
the keeper settles from, so their edge estimates price the exact data that
decides outcomes.

## Market-making (opt-in)

Set `SIM_MARKET_MAKER` to an agent name (e.g. `agent-1`) to let that agent
create markets; empty (the default) keeps the fleet trading-only. When fewer
than `SIM_MAX_ACTIVE_MARKETS` (default 1) markets are active, the
maker plans one pot per wake and returns without betting:

- Trader: a real top-25 board trader with PnL ≥ $100 who has no active pot,
  rotating deterministically by next market id.
- Mark: current board PnL × (1 + `SIM_MARK_MARKUP_PCT`, default 3%), priced
  off a **freshly forced** board print — a stale print lets a fast trader
  cross the mark before creation confirms, and a market that opens already
  over its mark is a foregone dud nobody can bet on.
- Term: `SIM_MARKET_TTL_SEC` (default 45 min), first-print settle — the next
  hourly keeper tick over the mark resolves YES, otherwise the tick after T
  resolves on the then-current print. Either way the pot settles soon.

## Policy

Per active market, per wake (jittered 2–6 min, at most one bet per wake):

1. **Win probability** — logistic on the gap between the trader's current
   board PnL and the mark, with a scale that tracks the mark's size and
   tightens as T approaches.
2. **Keeper foresight** — the keeper's own `decideFromBoard` runs locally. A
   first-print market over the mark on a fresh board resolves YES at the next
   tick: P_yes ≈ 0.99. A market the keeper would cancel (off-board, FomoScan
   down) is skipped.
3. **Edge vs pool odds** — breakeven probability from the pools including the
   5% losing-pool rake, **size-aware**: the bet's own pool impact is priced
   (`p* = (Y+b) / (Y+b + N(1−r))`), so an oversized bet against a small pool
   is correctly rejected as betting against itself. A bet needs
   `P − breakeven > SIM_EDGE_MARGIN`; failures at full size retry at the
   minimum bet (smaller bets get better pool odds).
4. **Conviction jitter** — a deterministic per-agent-per-market offset
   (±`SIM_CONVICTION_JITTER`, default 0.12) shifts each agent's P_yes. Same
   model, same board, different opinion — the disagreement that makes agents
   take opposite sides of one book.
5. **Proximity guard** — within `SIM_PROXIMITY_GUARD` of the mark (default
   20%), NO bets are suppressed: the closer the print gets to the target, the
   less the agents trade against it.
6. **Book building** — an empty book gets a minimum-size opener on the
   model's favored side, but only under genuine uncertainty (0.2 < P_yes <
   0.8); foregone conclusions stay empty since one-sided pools auto-cancel at
   resolve. A one-sided book can only be opposed (the whole pool is the
   prize), never piled into. A dominant two-sided book (>75%) allows a
   min-size pile-in under uncertainty — depth that makes opposition
   attractive.
7. **Sizing** — 4–12% of the agent's current bankroll, jittered, floored at
   `SIM_MIN_BET_USDC`, capped at `SIM_MAX_BET_USDC`, the rolling 24h spend
   cap, and `SIM_MAX_MARKET_EXPOSURE_USDC` per market.

Every evaluation is appended to `data/decisions.jsonl` (gitignored) with the
inputs, edge, side, amount, rationale, and tx signature — the agents'
reasoning audit trail. The rolling 24h spend cap is reconstructed from that
log on restart.

## Commands

From the repo root (env via `set -a && source .env && set +a`):

```bash
pnpm sim:fund -- --generate   # create missing keypairs (~/.config/fomo/sim-agent-N.json), top up SOL + USDC
pnpm sim:run -- --dry-run     # evaluate live markets, send nothing
pnpm sim:run                  # live loop (devnet unless CLUSTER=mainnet)
pnpm sim:run -- --once        # one wake per agent, then exit
pnpm sim:report               # balances, open exposure, claimable, lifetime stats
```

Mainnet sends require `CLUSTER=mainnet MAINNET_ACK=YES` (same gate as the
smoke). Agent keypairs live outside the repo and only ever sign
`place_bet` / `claim_winnings` (plus `create_market` when a maker is
configured).

## Env

See the root README env table for `SIM_*` knobs. `FOMOSCAN_API_KEY` (or a paid
`_3`/`_4` key) is required to run — the board pull is 250 CU and shared
across all agents in the process (10-minute cache).

## Tests

```bash
pnpm --filter @fomopred/sim test
```

Policy math is unit-tested hermetically; no chain access needed.
