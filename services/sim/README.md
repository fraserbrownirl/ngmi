# @fomopred/sim

Autonomous trading agents for the pot. Each agent has its own wallet (USDC +
SOL) and **only trades existing markets** — `place_bet` and `claim_winnings`,
never `create_market`, never resolve. Resolution stays with the production
keeper: agents read the same FomoScan `window=all` board the keeper settles
from, so their edge estimates price the exact data that decides outcomes.

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
   5% losing-pool rake; a bet needs `|P − breakeven| > SIM_EDGE_MARGIN`.
4. **Proximity guard** — within `SIM_PROXIMITY_GUARD` of the mark (default
   20%), NO bets are suppressed: the closer the print gets to the target, the
   less the agents trade against it.
5. **Cancel trap** — a one-sided pool auto-cancels at resolve (refund, not
   payout), so the heavy side is never bet.
6. **Sizing** — 4–12% of the agent's current bankroll, jittered, floored at
   `SIM_MIN_BET_USDC`, capped at `SIM_MAX_BET_USDC` and the rolling 24h spend
   cap.

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
`place_bet` / `claim_winnings`.

## Env

See the root README env table for `SIM_*` knobs. `FOMOSCAN_API_KEY` (or a paid
`_3`/`_4` key) is required to run — the board pull is 250 CU and shared
across all agents in the process (10-minute cache).

## Tests

```bash
pnpm --filter @fomopred/sim test
```

Policy math is unit-tested hermetically; no chain access needed.
