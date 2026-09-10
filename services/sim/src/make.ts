import * as anchor from "@coral-xyz/anchor";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import type { Program } from "@coral-xyz/anchor";
import type { FomoPnl } from "../../../target/types/fomo_pnl";
import type { Leaderboard } from "@fomopred/fomoscan";
import {
  CREATE_MAX_RANK,
  SETTLE_FIRST_PRINT,
  fomoUserIdToBytes,
  sendWithRetry,
  usdToMicro,
} from "@fomopred/shared";
import type { SimConfig } from "./env";
import { configPda, marketPda, vaultPda } from "./program";
import type { AgentWallet } from "./wallets";

export type MarketPlan = {
  traderId: string;
  handle: string;
  pnlUsd: number;
  markUsd: number;
  resolutionTime: number;
  rationale: string;
};

/** A trader's PnL must be at least this for a sane mark above it. */
export const MIN_TRADER_PNL_USD = 100;

/**
 * Decide the next sim market, or null. Pure — unit-tested without a chain.
 *
 * Markets are cheap to resolve by construction: the mark sits just over the
 * trader's current board PnL, so the next hourly print that ticks up
 * first-prints YES, and otherwise the short T closes it. Either way the pot
 * settles soon, which is what the UX test loop needs.
 *
 * Few as possible: one creation per wake, only when active markets are below
 * `maxActiveMarkets`, never a second active pot on the same trader.
 */
export function planMarket(opts: {
  board: Leaderboard | null;
  activeCount: number;
  /** Trader ids with an already-active market. */
  busyTraderIds: Set<string>;
  nextMarketId: number;
  nowSec: number;
  markupPct: number;
  ttlSec: number;
  maxActive: number;
}): MarketPlan | null {
  const { board } = opts;
  if (!board || board.traders.length === 0) return null;
  if (opts.activeCount >= opts.maxActive) return null;

  const eligible = board.traders
    .filter((t) => t.rank >= 1 && t.rank <= CREATE_MAX_RANK)
    .filter((t) => t.pnl >= MIN_TRADER_PNL_USD)
    .filter((t) => !opts.busyTraderIds.has(t.id));
  if (eligible.length === 0) return null;

  // Deterministic rotation through the eligible list for variety across pots.
  const trader = eligible[opts.nextMarketId % eligible.length];
  const markUsd = Math.ceil(trader.pnl * (1 + opts.markupPct) * 100) / 100;
  const resolutionTime = opts.nowSec + opts.ttlSec;
  return {
    traderId: trader.id,
    handle: trader.handle,
    pnlUsd: trader.pnl,
    markUsd,
    resolutionTime,
    rationale:
      `trader @${trader.handle} rank ${trader.rank} pnl $${trader.pnl.toFixed(0)} ` +
      `-> mark $${markUsd.toFixed(2)} (+${(opts.markupPct * 100).toFixed(0)}%), ` +
      `T ${new Date(resolutionTime * 1000).toISOString()} first-print`,
  };
}

/** Create the planned market on-chain. Returns the signature, or null in dry-run. */
export async function createMarket(
  program: Program<FomoPnl>,
  maker: AgentWallet,
  plan: MarketPlan,
  config: SimConfig,
): Promise<{ sig: string | null; marketId: number }> {
  const cfg = await program.account.config.fetch(configPda(program.programId));
  const marketId = cfg.marketCounter.toNumber() + 1;
  if (config.dryRun) return { sig: null, marketId };

  const makerAta = await getAssociatedTokenAddress(
    cfg.tokenMint,
    maker.keypair.publicKey,
  );
  // Fee recipient may be a PDA (Squads vault) — allow off-curve owner.
  const feeAta = await getAssociatedTokenAddress(cfg.tokenMint, cfg.feeRecipient, true);
  const sig = await sendWithRetry(() =>
    program.methods
      .createMarket(
        Array.from(fomoUserIdToBytes(plan.traderId)),
        new anchor.BN(usdToMicro(plan.markUsd).toString()),
        new anchor.BN(plan.resolutionTime),
        new anchor.BN(usdToMicro(plan.pnlUsd).toString()),
        new anchor.BN(0),
        SETTLE_FIRST_PRINT,
      )
      .accountsPartial({
        creator: maker.keypair.publicKey,
        market: marketPda(program.programId, marketId),
        marketVault: vaultPda(program.programId, marketId),
        tokenMint: cfg.tokenMint,
        creatorTokenAccount: makerAta,
        feeRecipientTokenAccount: feeAta,
      })
      .signers([maker.keypair])
      .rpc(),
  );
  return { sig, marketId };
}
