import * as anchor from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import type { FomoPnl } from "../../../target/types/fomo_pnl";
import { sendWithRetry } from "@fomopred/shared";
import type { SimConfig } from "./env";
import { loadProgram, configPda, positionPda } from "./program";
import { fetchMarkets, activeMarkets, type SimMarket } from "./discover";
import { BoardCache } from "./board";
import { evaluate, pickBest, type PolicyKnobs } from "./policy";
import { findClaimable, claim } from "./claim";
import { planMarket, createMarket } from "./make";
import { DecisionLog } from "./log";
import {
  ensureUsdcAta,
  loadAgents,
  solBalance,
  usdcAta,
  usdcBalance,
  type AgentWallet,
} from "./wallets";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const explorer = (cluster: string, sig: string) =>
  `https://explorer.solana.com/tx/${sig}${cluster === "mainnet" ? "" : "?cluster=devnet"}`;

/**
 * Deterministic per-agent-per-market conviction offset in [-max, +max].
 * Same model, same board, different opinion — the disagreement that makes
 * agents take opposite sides of a book.
 */
export function convictionJitter(agent: string, marketId: number, max: number): number {
  const s = `${agent}:${marketId}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return ((h % 1000) / 1000) * 2 * max - max;
}

type AgentRuntime = {
  wallet: AgentWallet;
  program: Program<FomoPnl>;
  ata: import("@solana/web3.js").PublicKey | null;
};

/**
 * One wake for one agent: claim what's settled, then at most one bet —
 * the best edge across the active board, if any clears the margin.
 */
async function wake(
  rt: AgentRuntime,
  markets: SimMarket[],
  board: import("@fomopred/keeper").BoardPrint | null,
  rawBoard: import("@fomopred/fomoscan").Leaderboard | null,
  boards: BoardCache,
  config: SimConfig,
  log: DecisionLog,
): Promise<void> {
  const { wallet } = rt;
  const now = new Date().toISOString();

  // ATA before everything: claims and bets both need it, and a fresh
  // process must not skip a claim because the account wasn't derived yet.
  if (!rt.ata) {
    const cfg = await rt.program.account.config.fetch(configPda(rt.program.programId));
    rt.ata = config.dryRun
      ? await usdcAta(cfg.tokenMint, wallet.keypair.publicKey)
      : await ensureUsdcAta(rt.program.provider.connection, wallet.keypair, cfg.tokenMint);
  }

  // Claims first: settled positions are free money back into the bankroll.
  {
    for (const c of await findClaimable(rt.program, markets, wallet.keypair.publicKey)) {
      const sig = await claim(rt.program, wallet, c, rt.ata, config.dryRun);
      log.append({
        ts: now,
        agent: wallet.name,
        cluster: config.cluster,
        marketId: c.market.id,
        action: "claim",
        payoutUsdc: Number(c.payoutMicro) / 1e6,
        sig,
        dryRun: config.dryRun,
      });
      console.log(
        `[${wallet.name}] claim market ${c.market.id} +$${(Number(c.payoutMicro) / 1e6).toFixed(2)}${sig ? " " + explorer(config.cluster, sig) : " (dry-run)"}`,
      );
    }
  }

  // Funding guards are about wallet state, not decision quality — dry-run
  // skips them and evaluates with a nominal bankroll so decisions are
  // observable before any wallet is funded.
  let bankroll = config.fundUsdc;
  let spendLeft = config.dailySpendUsdc;
  if (!config.dryRun) {
    const sol = await solBalance(rt.program.provider.connection, wallet.keypair.publicKey);
    if (sol < config.solFloor) {
      console.log(`[${wallet.name}] SOL ${sol.toFixed(4)} below floor ${config.solFloor} — skipping bets`);
      return;
    }
    bankroll = await usdcBalance(rt.program.provider.connection, rt.ata);
    if (bankroll <= config.bankrollFloorUsdc) {
      console.log(`[${wallet.name}] bankroll $${bankroll.toFixed(2)} at/below floor — skipping bets`);
      return;
    }
    const spent = log.spentLast24h(wallet.name);
    spendLeft = config.dailySpendUsdc - spent;
    if (spendLeft < config.minBetUsdc) {
      console.log(`[${wallet.name}] 24h spend cap reached ($${spent.toFixed(2)}) — skipping bets`);
      return;
    }
  }

  const active = activeMarkets(markets);

  // Market-making: the designated agent opens the next pot when the board
  // has room, then returns — it can bet on its own pot from the next wake.
  // Creation needs a funded wallet (rent), so it sits behind the same guards.
  if (wallet.name === config.marketMaker && active.length < config.maxActiveMarkets) {
    // Price the mark off a FRESH print: the shared cache can be 10 min old,
    // and a fast trader crosses a 3% markup in that window — a market that
    // opens already over its mark is a foregone dud nobody can bet on.
    const fresh = await boards.getRaw(true);
    const cfg = await rt.program.account.config.fetch(configPda(rt.program.programId));
    const plan = planMarket({
      board: fresh ?? rawBoard,
      activeCount: active.length,
      busyTraderIds: new Set(active.map((m) => m.record.fomoUserId)),
      nextMarketId: cfg.marketCounter.toNumber() + 1,
      nowSec: Math.floor(Date.now() / 1000),
      markupPct: config.markMarkupPct,
      ttlSec: config.marketTtlSec,
      maxActive: config.maxActiveMarkets,
    });
    if (plan) {
      const { sig, marketId } = await createMarket(rt.program, wallet, plan, config);
      log.append({
        ts: now,
        agent: wallet.name,
        cluster: config.cluster,
        marketId,
        action: "create",
        rationale: plan.rationale,
        traderHandle: plan.handle,
        markUsd: plan.markUsd,
        sig,
        dryRun: config.dryRun,
      });
      console.log(
        `[${wallet.name}] create market ${marketId}: ${plan.rationale}${sig ? " " + explorer(config.cluster, sig) : " (dry-run)"}`,
      );
      return;
    }
  }

  const knobs: PolicyKnobs = {
    edgeMargin: config.edgeMargin,
    proximityGuard: config.proximityGuard,
    minBetUsdc: config.minBetUsdc,
    maxBetUsdc: Math.min(config.maxBetUsdc, spendLeft),
    betFractionMin: config.betFractionMin,
    betFractionMax: config.betFractionMax,
    maxMarketExposureUsdc: config.maxMarketExposureUsdc,
  };

  // One batched fetch for this agent's positions across the active board:
  // per-market exposure caps need to know what's already staked.
  const positionPdas = active.map((m) =>
    positionPda(rt.program.programId, m.id, wallet.keypair.publicKey),
  );
  const positions = await rt.program.account.userPosition.fetchMultiple(positionPdas);
  const exposureOf = (i: number): number => {
    const p = positions[i];
    if (!p) return 0;
    return (Number(p.yesBet.toString()) + Number(p.noBet.toString())) / 1e6;
  };

  const evaluated = active.map((m, i) => ({
    marketId: m.id,
    input: {
      record: m.record,
      rakeBps: m.rakeBps,
      board,
      bankrollUsdc: bankroll,
      convictionJitter: convictionJitter(wallet.name, m.id, config.convictionJitter),
      myExposureUsdc: exposureOf(i),
      knobs,
    },
  }));
  for (const { marketId, input } of evaluated) {
    const d = evaluate(input);
    if (d.action === "abstain") {
      log.append({
        ts: now,
        agent: wallet.name,
        cluster: config.cluster,
        marketId,
        action: "abstain",
        reason: d.reason,
        pYes: d.pYes ?? undefined,
        dryRun: config.dryRun,
      });
    }
  }

  const best = pickBest(evaluated);
  if (!best) {
    console.log(`[${wallet.name}] no edge on ${active.length} active market(s)`);
    return;
  }
  const d = best.decision;
  const market = active.find((m) => m.id === best.marketId)!;
  console.log(`[${wallet.name}] market ${best.marketId}: ${d.rationale}`);

  let sig: string | null = null;
  if (!config.dryRun) {
    // The market may have resolved between discovery and send — a failed
    // MarketExpired/not-Active tx is a normal race, logged not thrown.
    try {
      sig = await sendWithRetry(() =>
        rt.program.methods
          .placeBet(
            new anchor.BN(best.marketId),
            d.side === "yes" ? { yes: {} } : { no: {} },
            new anchor.BN(Math.round(d.amountUsdc * 1e6)),
          )
          .accountsPartial({
            bettor: wallet.keypair.publicKey,
            market: market.marketPda,
            marketVault: market.vaultPda,
            userPosition: positionPda(rt.program.programId, best.marketId, wallet.keypair.publicKey),
            bettorTokenAccount: rt.ata!,
          })
          .signers([wallet.keypair])
          .rpc(),
      );
    } catch (e) {
      console.log(`[${wallet.name}] bet failed (likely resolved mid-send): ${(e as Error).message}`);
      log.append({
        ts: now,
        agent: wallet.name,
        cluster: config.cluster,
        marketId: best.marketId,
        action: "abstain",
        reason: "tx_failed_race",
        dryRun: config.dryRun,
      });
      return;
    }
    console.log(`[${wallet.name}] bet ${d.side.toUpperCase()} $${d.amountUsdc.toFixed(2)} ${explorer(config.cluster, sig!)}`);
  }
  log.append({
    ts: now,
    agent: wallet.name,
    cluster: config.cluster,
    marketId: best.marketId,
    action: "bet",
    side: d.side,
    amountUsdc: d.amountUsdc,
    pYes: d.pYes,
    breakeven: d.breakeven,
    edge: d.edge,
    rationale: d.rationale,
    sig,
    dryRun: config.dryRun,
  });
}

async function agentLoop(
  wallet: AgentWallet,
  connection: Connection,
  board: BoardCache,
  config: SimConfig,
  log: DecisionLog,
): Promise<void> {
  const rt: AgentRuntime = {
    wallet,
    program: loadProgram(connection, wallet.keypair),
    ata: null,
  };
  // Stagger first wakes so agents don't pile onto the same block.
  await sleep(Math.random() * config.wakeMaxSec * 1000);
  for (;;) {
    try {
      const reader = loadProgram(connection);
      const markets = await fetchMarkets(reader);
      const print = await board.get();
      const raw = await board.getRaw();
      await wake(rt, markets, print, raw, board, config, log);
    } catch (e) {
      console.log(`[${wallet.name}] wake failed: ${(e as Error).message}`);
    }
    if (config.once) return;
    const span = Math.max(config.wakeMaxSec - config.wakeMinSec, 0);
    await sleep((config.wakeMinSec + Math.random() * span) * 1000);
  }
}

/** Run every agent concurrently, sharing one connection and one board cache. */
export async function runAgents(config: SimConfig): Promise<void> {
  const agents = loadAgents(config.agentKeypairFiles);
  const connection = new Connection(config.rpcUrl, "confirmed");
  const board = new BoardCache(config.fomoscanKeys);
  const log = new DecisionLog(config.dataDir);
  console.log(
    `sim: ${agents.length} agent(s) on ${config.cluster}, ${config.dryRun ? "DRY-RUN, " : ""}wake ${config.wakeMinSec}-${config.wakeMaxSec}s`,
  );
  for (const a of agents) {
    console.log(`  ${a.name}: ${a.keypair.publicKey.toBase58()}`);
  }
  await Promise.all(agents.map((a) => agentLoop(a, connection, board, config, log)));
}
