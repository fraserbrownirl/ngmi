import * as fs from "fs";
import * as path from "path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";

export type AgentWallet = {
  /** "agent-1" — from the keypair filename. */
  name: string;
  keypair: Keypair;
  file: string;
};

export function loadKeypair(file: string): Keypair {
  return Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(file, "utf8")) as number[]),
  );
}

/** Generate any missing agent keypairs. Never writes inside the repo. */
export function ensureAgentKeypairs(files: string[]): { created: string[] } {
  const created: string[] = [];
  for (const file of files) {
    if (fs.existsSync(file)) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify(Array.from(Keypair.generate().secretKey)),
      { mode: 0o600 },
    );
    created.push(file);
  }
  return { created };
}

export function loadAgents(files: string[]): AgentWallet[] {
  return files.map((file, i) => {
    if (!fs.existsSync(file)) {
      throw new Error(
        `agent keypair missing: ${file} — run \`pnpm sim:fund -- --generate\` first`,
      );
    }
    const base = file.split("/").pop() ?? `agent-${i + 1}`;
    return { name: base.replace(/^sim-/, "").replace(/\.json$/, ""), keypair: loadKeypair(file), file };
  });
}

/** Agent's USDC ATA address (may not exist yet). */
export function usdcAta(mint: PublicKey, owner: PublicKey): Promise<PublicKey> {
  return getAssociatedTokenAddress(mint, owner);
}

/** Create the agent's USDC ATA if missing; the agent pays its own rent. */
export async function ensureUsdcAta(
  connection: Connection,
  agent: Keypair,
  mint: PublicKey,
): Promise<PublicKey> {
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    agent,
    mint,
    agent.publicKey,
  );
  return ata.address;
}

/** USDC balance in whole-token units; 0 when the ATA does not exist. */
export async function usdcBalance(
  connection: Connection,
  ata: PublicKey,
): Promise<number> {
  try {
    const account = await getAccount(connection, ata);
    return Number(account.amount) / 1e6;
  } catch {
    return 0;
  }
}

export async function solBalance(
  connection: Connection,
  owner: PublicKey,
): Promise<number> {
  return (await connection.getBalance(owner)) / 1e9;
}
