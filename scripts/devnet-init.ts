/**
 * Initialize a fresh devnet deployment: config (admin/resolver/fee recipient =
 * deploy wallet, maxFeeBps 0), rake 500/300/100/50 bps, and a fresh test-USDC
 * mint (deploy wallet is mint authority — that is what the /api/faucet route
 * mints from). Idempotent: existing accounts are reported, not touched.
 *
 * Run once after `anchor deploy --provider.cluster devnet`:
 *
 *   pnpm devnet:init
 *
 * Uses SOLANA_RPC_URL (default public devnet) and ~/.config/solana/id.json.
 * Then `pnpm smoke:devnet` creates and resolves market 1.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { FomoPnl } from "../target/types/fomo_pnl";
import {
  DEFAULT_AGENT_BPS,
  DEFAULT_BURN_BPS,
  DEFAULT_CREATOR_BPS,
  DEFAULT_RAKE_BPS,
} from "@fomopred/shared";

const DECIMALS = 6;
const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const explorer = (kind: "tx" | "address", id: string) =>
  `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;

async function main() {
  const admin = Keypair.fromSecretKey(
    new Uint8Array(
      JSON.parse(
        fs.readFileSync(path.join(os.homedir(), ".config", "solana", "id.json"), "utf8"),
      ) as number[],
    ),
  );
  const provider = new anchor.AnchorProvider(
    new Connection(RPC_URL, "confirmed"),
    new anchor.Wallet(admin),
    { commitment: "confirmed" },
  );
  const idl = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../target/idl/fomo_pnl.json"), "utf8"),
  );
  const program = new Program(idl, provider) as Program<FomoPnl>;
  console.log("program:", program.programId.toBase58());
  console.log("admin:", admin.publicKey.toBase58());

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );
  const [rakePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("rake")],
    program.programId,
  );

  let tokenMint: PublicKey;
  if (await provider.connection.getAccountInfo(configPda)) {
    const cfg = await program.account.config.fetch(configPda);
    tokenMint = cfg.tokenMint;
    console.log("config exists:", explorer("address", configPda.toBase58()));
    console.log("  marketCounter:", cfg.marketCounter.toString());
  } else {
    tokenMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      DECIMALS,
    );
    const sig = await program.methods
      .initialize(admin.publicKey, 0)
      .accounts({
        admin: admin.publicKey,
        config: configPda,
        tokenMint,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
    console.log("initialized config:", explorer("tx", sig));
  }
  console.log("test-USDC mint:", explorer("address", tokenMint.toBase58()));

  if (await provider.connection.getAccountInfo(rakePda)) {
    console.log("rake exists:", explorer("address", rakePda.toBase58()));
  } else {
    const burnOwner = Keypair.generate();
    const agentOwner = Keypair.generate();
    const burnAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin,
      tokenMint,
      burnOwner.publicKey,
    );
    const agentAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin,
      tokenMint,
      agentOwner.publicKey,
    );
    const sig = await program.methods
      .initRake(
        admin.publicKey,
        admin.publicKey,
        DEFAULT_RAKE_BPS,
        DEFAULT_BURN_BPS,
        DEFAULT_AGENT_BPS,
        DEFAULT_CREATOR_BPS,
      )
      .accounts({
        admin: admin.publicKey,
        config: configPda,
        rake: rakePda,
        tokenMint,
        burnTreasury: burnAta.address,
        agentTreasury: agentAta.address,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
    console.log(
      `initialized rake ${DEFAULT_RAKE_BPS}/${DEFAULT_BURN_BPS}/${DEFAULT_AGENT_BPS}/${DEFAULT_CREATOR_BPS}:`,
      explorer("tx", sig),
    );
    console.log("  burn treasury:", burnAta.address.toBase58());
    console.log("  agent treasury:", agentAta.address.toBase58());
  }

  console.log("\nconfig PDA:", configPda.toBase58());
  console.log("rake PDA:", rakePda.toBase58());
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
