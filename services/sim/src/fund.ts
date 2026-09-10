import * as os from "os";
import * as path from "path";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { sendWithRetry } from "@fomopred/shared";
import type { SimConfig } from "./env";
import { loadProgram, configPda } from "./program";
import { ensureAgentKeypairs, loadAgents, loadKeypair } from "./wallets";

const LAMPORTS = 1e9;
const MICRO = 1e6;

const explorer = (cluster: string, sig: string) =>
  `https://explorer.solana.com/tx/${sig}${cluster === "mainnet" ? "" : "?cluster=devnet"}`;

/**
 * Top every agent up to SIM_FUND_SOL / SIM_FUND_USDC from the funder wallet
 * (default ~/.config/solana/id.json). Idempotent: only the shortfall moves.
 */
export async function fundAgents(
  config: SimConfig,
  opts: { generate?: boolean; funderFile?: string } = {},
): Promise<void> {
  if (opts.generate) {
    const { created } = ensureAgentKeypairs(config.agentKeypairFiles);
    for (const f of created) console.log(`generated ${f}`);
  }
  const agents = loadAgents(config.agentKeypairFiles);
  const funder = loadKeypair(
    opts.funderFile ?? path.join(os.homedir(), ".config", "solana", "id.json"),
  );
  const connection = new Connection(config.rpcUrl, "confirmed");
  const program = loadProgram(connection);
  const cfg = await program.account.config.fetch(configPda(program.programId));
  const mint: PublicKey = cfg.tokenMint;
  const funderAta = await getAssociatedTokenAddress(mint, funder.publicKey);
  const funderBal = Number((await getAccount(connection, funderAta)).amount) / MICRO;
  console.log(
    `funder ${funder.publicKey.toBase58()} — $${funderBal.toFixed(2)} USDC, ` +
      `${((await connection.getBalance(funder.publicKey)) / LAMPORTS).toFixed(3)} SOL`,
  );

  const needUsdc = agents.length * config.fundUsdc;
  if (funderBal < needUsdc) {
    throw new Error(
      `funder needs >= ${needUsdc} USDC to fund ${agents.length} agent(s) at $${config.fundUsdc} each (has $${funderBal.toFixed(2)})`,
    );
  }

  for (const agent of agents) {
    const who = agent.keypair.publicKey;
    const solBal = (await connection.getBalance(who)) / LAMPORTS;
    if (solBal < config.fundSol) {
      const lamports = Math.round((config.fundSol - solBal) * LAMPORTS);
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: funder.publicKey,
          toPubkey: who,
          lamports,
        }),
      );
      const sig = await sendWithRetry(() =>
        connection.sendTransaction(tx, [funder]),
      );
      await connection.confirmTransaction(sig, "confirmed");
      console.log(`${agent.name}: +${(lamports / LAMPORTS).toFixed(4)} SOL ${explorer(config.cluster, sig)}`);
    }

    // ATA rent paid by the funder so agents keep their SOL for positions.
    const ata = await getOrCreateAssociatedTokenAccount(connection, funder, mint, who);
    let usdcBal = 0;
    try {
      usdcBal = Number((await getAccount(connection, ata.address)).amount) / MICRO;
    } catch {
      /* just created */
    }
    if (usdcBal < config.fundUsdc) {
      const micro = BigInt(Math.round((config.fundUsdc - usdcBal) * MICRO));
      const tx = new Transaction().add(
        createTransferInstruction(funderAta, ata.address, funder.publicKey, micro),
      );
      const sig = await sendWithRetry(() =>
        connection.sendTransaction(tx, [funder]),
      );
      await connection.confirmTransaction(sig, "confirmed");
      console.log(`${agent.name}: +$${(Number(micro) / MICRO).toFixed(2)} USDC ${explorer(config.cluster, sig)}`);
    }
    console.log(`${agent.name}: ready — ${who.toBase58()} ATA ${ata.address.toBase58()}`);
  }
}
