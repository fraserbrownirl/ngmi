import { Connection } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import type { SimConfig } from "./env";
import { loadProgram, configPda, positionPda } from "./program";
import { fetchMarkets } from "./discover";
import { expectedPayout, CLAIM_FLOOR_MICRO } from "./claim";
import { DecisionLog } from "./log";
import { loadAgents, solBalance, usdcBalance } from "./wallets";

/**
 * Reconciliation: on-chain balances and open exposure per agent, plus
 * lifetime stats from the decision log. Read-only — safe to run anytime.
 */
export async function report(config: SimConfig): Promise<void> {
  const agents = loadAgents(config.agentKeypairFiles);
  const connection = new Connection(config.rpcUrl, "confirmed");
  const program = loadProgram(connection);
  const cfg = await program.account.config.fetch(configPda(program.programId));
  const markets = await fetchMarkets(program);
  const active = markets.filter((m) => m.state === "active");
  const log = new DecisionLog(config.dataDir);
  const entries = log.readAll();

  console.log(`cluster: ${config.cluster} — ${markets.length} market(s), ${active.length} active\n`);

  let totUsdc = 0;
  let totExposure = 0;
  let totClaimable = 0;
  for (const agent of agents) {
    const who = agent.keypair.publicKey;
    const ata = await getAssociatedTokenAddress(cfg.tokenMint, who);
    const usdc = await usdcBalance(connection, ata);
    const sol = await solBalance(connection, who);

    // Open exposure + unclaimed settled payouts, from on-chain positions.
    let exposure = 0;
    let claimable = 0;
    const pdas = markets.map((m) => positionPda(program.programId, m.id, who));
    const positions = await program.account.userPosition.fetchMultiple(pdas);
    for (let i = 0; i < markets.length; i++) {
      const p = positions[i];
      if (!p) continue;
      const yes = Number(p.yesBet.toString()) / 1e6;
      const no = Number(p.noBet.toString()) / 1e6;
      if (markets[i].state === "active") {
        exposure += yes + no;
      } else if (!p.claimed) {
        const payout = expectedPayout(
          markets[i],
          BigInt(p.yesBet.toString()),
          BigInt(p.noBet.toString()),
        );
        if (payout >= CLAIM_FLOOR_MICRO) claimable += Number(payout) / 1e6;
      }
    }

    // Lifetime stats from the decision log.
    const bets = entries.filter((e) => e.agent === agent.name && e.action === "bet" && !e.dryRun && e.sig);
    const volume = bets.reduce((s, e) => s + (e.amountUsdc ?? 0), 0);
    const claims = entries.filter((e) => e.agent === agent.name && e.action === "claim" && !e.dryRun);
    const claimed = claims.reduce((s, e) => s + (e.payoutUsdc ?? 0), 0);
    const spent24 = log.spentLast24h(agent.name);

    totUsdc += usdc;
    totExposure += exposure;
    totClaimable += claimable;
    console.log(`${agent.name} ${who.toBase58()}`);
    console.log(`  USDC $${usdc.toFixed(2)} | SOL ${sol.toFixed(4)} | open exposure $${exposure.toFixed(2)} | claimable $${claimable.toFixed(2)}`);
    console.log(`  lifetime: ${bets.length} bet(s), $${volume.toFixed(2)} volume, $${claimed.toFixed(2)} claimed | 24h spend $${spent24.toFixed(2)}/$${config.dailySpendUsdc}`);
  }
  console.log(`\ntotal: $${totUsdc.toFixed(2)} USDC + $${totExposure.toFixed(2)} open + $${totClaimable.toFixed(2)} claimable`);
}
