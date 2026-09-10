/**
 * Initialize a deployment: config + rake (500/300/100/50 bps) + treasury ATAs.
 * Idempotent: existing accounts are reported, not touched.
 *
 * CLUSTER=devnet (default): fresh test-USDC mint (deploy wallet is mint
 * authority — that is what the tote /api/faucet route mints from), all roles
 * = deploy wallet, throwaway treasury owners. Uses SOLANA_RPC_URL (default
 * public devnet) and ~/.config/solana/id.json. Then `pnpm smoke:devnet`
 * creates and resolves market 1.
 *
 * CLUSTER=mainnet: real USDC, roles from env, and an explicit MAINNET_ACK=YES
 * gate. Two modes:
 *
 *   MAINNET_MODE=squads (default): the Squads vault is admin from the first
 *     instruction. This script only creates the treasury/fee ATAs (deploy
 *     wallet pays) and prints the initialize / init_rake / set_resolver
 *     instruction payloads (accounts + data + unsigned message) for the
 *     vault to execute through Squads. Nothing privileged is signed here.
 *
 *   MAINNET_MODE=rotate: the deploy wallet initializes as admin, sets the
 *     resolver, and stages transfer_admin to the vault, then prints the
 *     accept_admin payload for the vault. Brief hot-admin window on an empty
 *     deployment; the vault's accept is the final step. Prefer squads mode.
 *
 * Required on mainnet: MAINNET_ADMIN (Squads vault), MAINNET_FOUNDER,
 * MAINNET_RESOLVER, MAINNET_ACK=YES.
 * Optional: MAINNET_RAKE_OWNER (default MAINNET_ADMIN),
 * MAINNET_BURN_TREASURY_OWNER (default rake owner), MAINNET_FEE_RECIPIENT
 * (default admin), SOLANA_RPC_URL (default Helius via HELIUS_API_KEY,
 * else public mainnet).
 * Required on mainnet (no default): MAINNET_AGENT_TREASURY_OWNER — the
 * program rejects burn == agent treasury, and one owner has exactly one ATA
 * per mint, so the agent treasury needs its own owner (dedicated ops key).
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createMint,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { FomoPnl } from "../target/types/fomo_pnl";
// @ts-ignore - bs58 ships no types; transitive dep of anchor
import bs58 from "bs58";
import {
  DEFAULT_AGENT_BPS,
  DEFAULT_BURN_BPS,
  DEFAULT_CREATOR_BPS,
  DEFAULT_RAKE_BPS,
} from "@fomopred/shared";

const DECIMALS = 6;
const CLUSTER = process.env.CLUSTER ?? "devnet";
const USDC_MAINNET = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

const RPC_URL =
  process.env.SOLANA_RPC_URL ??
  (CLUSTER === "mainnet"
    ? process.env.HELIUS_API_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
      : "https://api.mainnet-beta.solana.com"
    : "https://api.devnet.solana.com");

const explorer = (kind: "tx" | "address", id: string) =>
  `https://explorer.solana.com/${kind}/${id}${CLUSTER === "mainnet" ? "" : "?cluster=devnet"}`;

function loadPayer(): Keypair {
  return Keypair.fromSecretKey(
    new Uint8Array(
      JSON.parse(
        fs.readFileSync(path.join(os.homedir(), ".config", "solana", "id.json"), "utf8"),
      ) as number[],
    ),
  );
}

async function printSquadsPayload(
  connection: Connection,
  name: string,
  feePayer: PublicKey,
  ix: TransactionInstruction,
) {
  console.log(`\n=== SQUADS PAYLOAD: ${name} ===`);
  console.log("program:", ix.programId.toBase58());
  ix.keys.forEach((k, i) => {
    console.log(
      `  account ${i}: ${k.pubkey.toBase58()}${k.isSigner ? " [signer]" : ""}${k.isWritable ? " [writable]" : ""}`,
    );
  });
  console.log("  data (base64):", Buffer.from(ix.data).toString("base64"));
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer, recentBlockhash: blockhash }).add(ix);
  const msg = tx.compileMessage();
  console.log(
    "  unsigned message (base64):",
    Buffer.from(msg.serialize()).toString("base64"),
  );
}

async function main() {
  if (CLUSTER !== "devnet" && CLUSTER !== "mainnet") {
    throw new Error(`CLUSTER must be devnet or mainnet, got "${CLUSTER}"`);
  }

  const payer = loadPayer();
  const provider = new anchor.AnchorProvider(
    new Connection(RPC_URL, "confirmed"),
    new anchor.Wallet(payer),
    { commitment: "confirmed" },
  );
  const idl = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../target/idl/fomo_pnl.json"), "utf8"),
  );
  const program = new Program(idl, provider) as Program<FomoPnl>;
  console.log("cluster:", CLUSTER);
  console.log("program:", program.programId.toBase58());
  console.log("local payer:", payer.publicKey.toBase58());

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );
  const [rakePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("rake")],
    program.programId,
  );

  if (CLUSTER === "mainnet") {
    await mainnetInit(provider, program, payer, configPda, rakePda);
  } else {
    await devnetInit(provider, program, payer, configPda, rakePda);
  }

  console.log("\nconfig PDA:", configPda.toBase58());
  console.log("rake PDA:", rakePda.toBase58());
}

async function devnetInit(
  provider: anchor.AnchorProvider,
  program: Program<FomoPnl>,
  admin: Keypair,
  configPda: PublicKey,
  rakePda: PublicKey,
) {
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
      .initialize(admin.publicKey)
      .accounts({
        admin: admin.publicKey,
        tokenMint,
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
        tokenMint,
        burnTreasury: burnAta.address,
        agentTreasury: agentAta.address,
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
}

async function mainnetInit(
  provider: anchor.AnchorProvider,
  program: Program<FomoPnl>,
  payer: Keypair,
  configPda: PublicKey,
  rakePda: PublicKey,
) {
  if (process.env.MAINNET_ACK !== "YES") {
    throw new Error("mainnet init requires MAINNET_ACK=YES in the environment");
  }
  const required = [
    "MAINNET_ADMIN",
    "MAINNET_FOUNDER",
    "MAINNET_RESOLVER",
    "MAINNET_AGENT_TREASURY_OWNER",
  ];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`missing ${key}`);
  }
  const admin = new PublicKey(process.env.MAINNET_ADMIN!);
  const founder = new PublicKey(process.env.MAINNET_FOUNDER!);
  const resolver = new PublicKey(process.env.MAINNET_RESOLVER!);
  const rakeOwner = process.env.MAINNET_RAKE_OWNER
    ? new PublicKey(process.env.MAINNET_RAKE_OWNER)
    : admin;
  const burnTreasuryOwner = process.env.MAINNET_BURN_TREASURY_OWNER
    ? new PublicKey(process.env.MAINNET_BURN_TREASURY_OWNER)
    : rakeOwner;
  const agentTreasuryOwner = new PublicKey(process.env.MAINNET_AGENT_TREASURY_OWNER!);
  const feeRecipient = process.env.MAINNET_FEE_RECIPIENT
    ? new PublicKey(process.env.MAINNET_FEE_RECIPIENT)
    : admin;
  const mode = process.env.MAINNET_MODE ?? "squads";
  if (mode !== "squads" && mode !== "rotate") {
    throw new Error(`MAINNET_MODE must be squads or rotate, got "${mode}"`);
  }

  console.log("\n--- mainnet roles ---");
  console.log("admin (Squads vault):", admin.toBase58());
  console.log("rake owner:          ", rakeOwner.toBase58());
  console.log("founder:             ", founder.toBase58());
  console.log("resolver:            ", resolver.toBase58());
  console.log("burn treasury owner: ", burnTreasuryOwner.toBase58());
  console.log("agent treasury owner:", agentTreasuryOwner.toBase58());
  console.log("fee recipient:       ", feeRecipient.toBase58());
  console.log("token mint (USDC):   ", USDC_MAINNET.toBase58());
  console.log("mode:                ", mode);

  // Founder ATA must exist or every founder slice burns at resolve.
  const founderAta = await getAssociatedTokenAddress(USDC_MAINNET, founder, true);
  if (await provider.connection.getAccountInfo(founderAta)) {
    console.log("founder USDC ATA:    ", founderAta.toBase58(), "(exists)");
  } else {
    console.log(
      "founder USDC ATA:    ",
      founderAta.toBase58(),
      "MISSING — founder slices will burn until it exists",
    );
  }

  // Treasury + fee ATAs: created by the local payer, owned by the configured
  // owners. create_market requires the fee recipient ATA to exist.
  // allowOwnerOffCurve: the Squads vault is a PDA (off-curve).
  const burnAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    USDC_MAINNET,
    burnTreasuryOwner,
    true,
  );
  const agentAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    USDC_MAINNET,
    agentTreasuryOwner,
    true,
  );
  if (burnAta.address.equals(agentAta.address)) {
    throw new Error(
      "burn and agent treasuries resolve to the same account; init_rake rejects that. Give MAINNET_AGENT_TREASURY_OWNER its own owner.",
    );
  }
  const feeAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    USDC_MAINNET,
    feeRecipient,
    true,
  );
  console.log("\nburn treasury ATA: ", burnAta.address.toBase58());
  console.log("agent treasury ATA:", agentAta.address.toBase58());
  console.log("fee recipient ATA: ", feeAta.address.toBase58());

  const configExists = !!(await provider.connection.getAccountInfo(configPda));
  const rakeExists = !!(await provider.connection.getAccountInfo(rakePda));
  if (configExists) {
    const cfg = await program.account.config.fetch(configPda);
    console.log("\nconfig exists:", explorer("address", configPda.toBase58()));
    console.log("  admin:", cfg.admin.toBase58());
    console.log("  resolver:", cfg.resolver.toBase58());
    console.log("  marketCounter:", cfg.marketCounter.toString());
  }
  if (rakeExists) {
    console.log("rake exists:", explorer("address", rakePda.toBase58()));
  }

  if (mode === "squads") {
    const ixs: TransactionInstruction[] = [];
    const names: string[] = [];
    if (!configExists) {
      const ix = await program.methods
        .initialize(feeRecipient)
        .accounts({
          admin,
          tokenMint: USDC_MAINNET,
        })
        .instruction();
      await printSquadsPayload(provider.connection, "initialize", admin, ix);
      ixs.push(ix);
      names.push("initialize");
    }
    if (!rakeExists) {
      const ix = await program.methods
        .initRake(
          rakeOwner,
          founder,
          DEFAULT_RAKE_BPS,
          DEFAULT_BURN_BPS,
          DEFAULT_AGENT_BPS,
          DEFAULT_CREATOR_BPS,
        )
        .accounts({
          admin,
          tokenMint: USDC_MAINNET,
          burnTreasury: burnAta.address,
          agentTreasury: agentAta.address,
        })
        .instruction();
      await printSquadsPayload(provider.connection, "init_rake", admin, ix);
      ixs.push(ix);
      names.push("init_rake");
    }
    let needResolver = true;
    if (configExists) {
      const cfg = await program.account.config.fetch(configPda);
      needResolver = !cfg.resolver.equals(resolver);
    }
    if (needResolver) {
      const ix = await program.methods
        .setResolver(resolver)
        .accounts({ admin })
        .instruction();
      await printSquadsPayload(provider.connection, "set_resolver", admin, ix);
      ixs.push(ix);
      names.push("set_resolver");
    }
    if (ixs.length === 0) {
      console.log("\nalready initialized with target resolver; nothing to emit.");
      return;
    }
    // One combined transaction for the Squads TX Builder "Import base58
    // encoded tx" path: decodes into all instructions in a single draft.
    const { blockhash } = await provider.connection.getLatestBlockhash("confirmed");
    const combined = new Transaction({ feePayer: admin, recentBlockhash: blockhash });
    combined.add(...ixs);
    const raw = combined.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
    console.log("\n=== SQUADS IMPORT (one transaction, all instructions) ===");
    console.log("instructions:", names.join(" + "));
    console.log("base58:", bs58.encode(raw));
    return;
  }

  // rotate mode: deploy wallet is admin for a short, supervised window.
  if (!configExists) {
    const sig = await program.methods
      .initialize(feeRecipient)
      .accounts({
        admin: payer.publicKey,
        tokenMint: USDC_MAINNET,
      })
      .signers([payer])
      .rpc();
    console.log("\ninitialized config (hot admin):", explorer("tx", sig));
  }
  if (!rakeExists) {
    const sig = await program.methods
      .initRake(
        rakeOwner,
        founder,
        DEFAULT_RAKE_BPS,
        DEFAULT_BURN_BPS,
        DEFAULT_AGENT_BPS,
        DEFAULT_CREATOR_BPS,
      )
      .accounts({
        admin: payer.publicKey,
        tokenMint: USDC_MAINNET,
        burnTreasury: burnAta.address,
        agentTreasury: agentAta.address,
      })
      .signers([payer])
      .rpc();
    console.log("initialized rake:", explorer("tx", sig));
  }
  const sigResolver = await program.methods
    .setResolver(resolver)
    .accounts({ admin: payer.publicKey })
    .signers([payer])
    .rpc();
  console.log("resolver set:", explorer("tx", sigResolver));
  const sigTransfer = await program.methods
    .transferAdmin(admin)
    .accounts({ admin: payer.publicKey })
    .signers([payer])
    .rpc();
  console.log("pending_admin staged:", explorer("tx", sigTransfer));

  const ix = await program.methods
    .acceptAdmin()
    .accounts({ pending: admin })
    .instruction();
  await printSquadsPayload(provider.connection, "accept_admin", admin, ix);
  console.log(
    "\nHOT ADMIN WINDOW OPEN until the vault executes accept_admin. Do not create markets before it lands.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
