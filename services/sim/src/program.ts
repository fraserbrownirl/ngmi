import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import type { FomoPnl } from "../../../target/types/fomo_pnl";

const REPO_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

/**
 * Anchor client for the deployed pot. IDL is the build artifact the smoke
 * uses. With `wallet` the provider pays fees from that keypair — agents sign
 * and pay for their own bets/claims. Without it the client is read-only.
 */
export function loadProgram(
  connection: Connection,
  wallet?: anchor.web3.Keypair,
): Program<FomoPnl> {
  const idl = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "target", "idl", "fomo_pnl.json"), "utf8"),
  );
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet ?? anchor.web3.Keypair.generate()),
    { commitment: "confirmed" },
  );
  return new Program(idl, provider) as Program<FomoPnl>;
}

const marketIdLe = (marketId: number): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(marketId));
  return b;
};

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
}

export function marketPda(programId: PublicKey, marketId: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), marketIdLe(marketId)],
    programId,
  )[0];
}

export function vaultPda(programId: PublicKey, marketId: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), marketIdLe(marketId)],
    programId,
  )[0];
}

export function positionPda(
  programId: PublicKey,
  marketId: number,
  user: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), marketIdLe(marketId), user.toBuffer()],
    programId,
  )[0];
}
