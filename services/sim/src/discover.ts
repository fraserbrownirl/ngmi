import { PublicKey } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import type { FomoPnl } from "../../../target/types/fomo_pnl";
import type { MarketRecord } from "@fomopred/keeper";
import { bytesToFomoUserId } from "@fomopred/shared";
import { configPda, marketPda, vaultPda } from "./program";

export type MarketState = "active" | "resolved" | "cancelled";

/** One on-chain market, decoded into the keeper's record shape plus sim extras. */
export type SimMarket = {
  id: number;
  marketPda: PublicKey;
  vaultPda: PublicKey;
  creator: PublicKey;
  state: MarketState;
  winningOutcome: "yes" | "no" | null;
  /** Snapshotted total rake bps (losing-pool cut at resolve). */
  rakeBps: number;
  /** Rake taken at resolve, micro-USDC. 0 until resolved. */
  rakeTotalMicro: bigint;
  record: MarketRecord;
};

const stateOf = (raw: unknown): MarketState => {
  const s = raw as Record<string, unknown>;
  if ("resolved" in s) return "resolved";
  if ("cancelled" in s) return "cancelled";
  return "active";
};

const outcomeOf = (raw: unknown): "yes" | "no" | null => {
  const s = raw as Record<string, unknown>;
  if ("yes" in s) return "yes";
  if ("no" in s) return "no";
  return null;
};

/**
 * Walk every market 1..config.marketCounter. Same discovery the settle path
 * uses — there is no off-chain market registry.
 */
export async function fetchMarkets(program: Program<FomoPnl>): Promise<SimMarket[]> {
  const cfg = await program.account.config.fetch(configPda(program.programId));
  const counter = cfg.marketCounter.toNumber();
  if (counter === 0) return [];
  const ids = Array.from({ length: counter }, (_, i) => i + 1);
  const pdas = ids.map((id) => marketPda(program.programId, id));
  const accounts = await program.account.market.fetchMultiple(pdas);
  const out: SimMarket[] = [];
  for (let i = 0; i < ids.length; i++) {
    const m = accounts[i];
    if (!m) continue;
    out.push({
      id: ids[i],
      marketPda: pdas[i],
      vaultPda: vaultPda(program.programId, ids[i]),
      creator: m.creator,
      state: stateOf(m.state),
      winningOutcome: outcomeOf(m.winningOutcome),
      rakeBps: m.rakeBps,
      rakeTotalMicro: BigInt(m.rakeTotal.toString()),
      record: {
        id: String(ids[i]),
        chain: "solana",
        fomoUserId: bytesToFomoUserId(Uint8Array.from(m.fomoUserId)),
        thresholdUsd: m.thresholdUsd.toNumber
          ? BigInt(m.thresholdUsd.toString())
          : BigInt(0),
        resolutionTime: Number(m.resolutionTime.toString()),
        createdAt: Number(m.createdAt.toString()),
        yesPool: BigInt(m.yesPool.toString()),
        noPool: BigInt(m.noPool.toString()),
        settleKind: m.window,
      },
    });
  }
  return out;
}

export const activeMarkets = (markets: SimMarket[]): SimMarket[] =>
  markets.filter((m) => m.state === "active");
