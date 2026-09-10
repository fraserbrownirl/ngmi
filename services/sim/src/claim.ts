import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import type { FomoPnl } from "../../../target/types/fomo_pnl";
import { sendWithRetry } from "@fomopred/shared";
import type { SimMarket } from "./discover";
import { positionPda } from "./program";
import type { AgentWallet } from "./wallets";

/** Don't claim payouts below this — the tx fee is worth more than the dust. */
export const CLAIM_FLOOR_MICRO = 10_000n; // $0.01

export type Claimable = {
  market: SimMarket;
  positionPda: PublicKey;
  yesBetMicro: bigint;
  noBetMicro: bigint;
  /** Expected payout per the on-chain claim math. */
  payoutMicro: bigint;
};

/**
 * On-chain payout: winners get stake + pro-rata share of (losing pool - rake);
 * cancelled markets refund both sides; losing positions pay 0 (skipped — a
 * claim tx costs more than the nothing it returns).
 */
export function expectedPayout(
  market: Pick<SimMarket, "state" | "winningOutcome" | "rakeTotalMicro" | "record">,
  yesBetMicro: bigint,
  noBetMicro: bigint,
): bigint {
  if (market.state === "cancelled") return yesBetMicro + noBetMicro;
  if (market.state !== "resolved" || !market.winningOutcome) return 0n;
  const yesPool = market.record.yesPool ?? 0n;
  const noPool = market.record.noPool ?? 0n;
  const [winBet, winPool, losePool] =
    market.winningOutcome === "yes"
      ? [yesBetMicro, yesPool, noPool]
      : [noBetMicro, noPool, yesPool];
  if (winBet === 0n || winPool === 0n) return 0n;
  const net = losePool - market.rakeTotalMicro;
  if (net <= 0n) return winBet;
  return winBet + (winBet * net) / winPool;
}

/** Unclaimed positions this agent holds on settled (resolved/cancelled) markets. */
export async function findClaimable(
  program: Program<FomoPnl>,
  markets: SimMarket[],
  agent: PublicKey,
): Promise<Claimable[]> {
  const settled = markets.filter((m) => m.state !== "active");
  if (settled.length === 0) return [];
  const pdas = settled.map((m) => positionPda(program.programId, m.id, agent));
  const positions = await program.account.userPosition.fetchMultiple(pdas);
  const out: Claimable[] = [];
  for (let i = 0; i < settled.length; i++) {
    const p = positions[i];
    if (!p || p.claimed) continue;
    const yesBet = BigInt(p.yesBet.toString());
    const noBet = BigInt(p.noBet.toString());
    const payout = expectedPayout(settled[i], yesBet, noBet);
    if (payout < CLAIM_FLOOR_MICRO) continue;
    out.push({
      market: settled[i],
      positionPda: pdas[i],
      yesBetMicro: yesBet,
      noBetMicro: noBet,
      payoutMicro: payout,
    });
  }
  return out;
}

/** Claim one position. Returns the signature, or null in dry-run. */
export async function claim(
  program: Program<FomoPnl>,
  agent: AgentWallet,
  c: Claimable,
  userTokenAccount: PublicKey,
  dryRun: boolean,
): Promise<string | null> {
  if (dryRun) return null;
  return sendWithRetry(() =>
    program.methods
      .claimWinnings(new anchor.BN(c.market.id))
      .accountsPartial({
        user: agent.keypair.publicKey,
        market: c.market.marketPda,
        marketVault: c.market.vaultPda,
        userPosition: c.positionPda,
        userTokenAccount,
      })
      .signers([agent.keypair])
      .rpc(),
  );
}
