/**
 * Execute a devnet test-USDC + SOL airdrop from the equal roster.
 *
 * Reads data/ngmi-airdrop-roster-equal.json and sends each recipient:
 *   - 0.01 devnet SOL
 *   - 1,000 test USDC
 *
 *   pnpm execute:devnet-airdrop
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FomoPnl } from "../target/types/fomo_pnl";
import {
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";

const DECIMALS = 6;
const MICRO = 10 ** DECIMALS;
const SOL_PER_RECIPIENT = 0.01;
const BATCH_SIZE = 2; // keep legacy tx account count under 35
const ROSTER = path.join(__dirname, "../data/ngmi-airdrop-roster-equal.json");
const START_INDEX = Number(process.env.START_INDEX ?? 0);

const explorer = (kind: "tx" | "address", id: string) =>
  `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const idl = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../target/idl/fomo_pnl.json"), "utf8")
  );
  const program = new Program(idl, provider) as Program<FomoPnl>;
  const admin = (provider.wallet as anchor.Wallet).payer;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  const cfg = await program.account.config.fetch(configPda);
  const tokenMint = cfg.tokenMint;

  const roster = JSON.parse(fs.readFileSync(ROSTER, "utf8"));
  const recipients: { address: string; amount: string }[] = roster.roster;

  console.log("recipients", recipients.length);
  console.log("admin", explorer("address", admin.publicKey.toBase58()));
  console.log("mint", explorer("address", tokenMint.toBase58()));

  // Ensure admin has enough devnet SOL.
  const adminBalance = await provider.connection.getBalance(admin.publicKey);
  const neededSol = recipients.length * SOL_PER_RECIPIENT * 1e9 + 0.1 * 1e9; // 0.1 SOL buffer for fees
  if (adminBalance < neededSol) {
    const request = Math.ceil((neededSol - adminBalance) / 1e9);
    console.log(`airdropping ${request} SOL to admin`);
    await provider.connection.requestAirdrop(admin.publicKey, request * 1e9);
    let waited = 0;
    while (await provider.connection.getBalance(admin.publicKey) < neededSol && waited < 30) {
      await new Promise((r) => setTimeout(r, 1000));
      waited += 1;
    }
  }

  // Admin ATA for test USDC.
  const adminAta = getAssociatedTokenAddressSync(tokenMint, admin.publicKey, false, TOKEN_PROGRAM_ID);
  if (!(await provider.connection.getAccountInfo(adminAta))) {
    console.log("creating admin ATA", adminAta.toBase58());
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, adminAta, admin.publicKey, tokenMint, TOKEN_PROGRAM_ID)
    );
    await provider.sendAndConfirm(tx, [admin]);
  }

  // Mint total USDC to admin if not already available.
  const adminAtaInfo = await provider.connection.getTokenAccountBalance(adminAta).catch(() => null);
  const adminUsdcBalance = adminAtaInfo ? BigInt(adminAtaInfo.value.amount) : 0n;
  const totalUsdc = recipients.reduce((sum, r) => sum + BigInt(r.amount), 0n);
  if (adminUsdcBalance < totalUsdc) {
    const toMint = totalUsdc - adminUsdcBalance;
    console.log("minting", Number(toMint) / MICRO, "USDC to admin");
    await mintTo(provider.connection, admin, tokenMint, adminAta, admin, toMint);
  } else {
    console.log("admin already holds", Number(adminUsdcBalance) / MICRO, "USDC");
  }

  // Airdrop SOL and USDC in batches.
  const signatures: string[] = [];
  for (let i = START_INDEX; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    const tx = new Transaction();
    for (const recipient of batch) {
      const owner = new PublicKey(recipient.address);
      const ata = getAssociatedTokenAddressSync(tokenMint, owner, true, TOKEN_PROGRAM_ID);
      tx.add(
        SystemProgram.transfer({
          fromPubkey: admin.publicKey,
          toPubkey: owner,
          lamports: BigInt(Math.round(SOL_PER_RECIPIENT * 1e9)),
        })
      );
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata, owner, tokenMint, TOKEN_PROGRAM_ID)
      );
      tx.add(
        createTransferInstruction(adminAta, ata, admin.publicKey, BigInt(recipient.amount), [], TOKEN_PROGRAM_ID)
      );
    }
    const sig = await provider.sendAndConfirm(tx, [admin]);
    signatures.push(sig);
    console.log(`batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(recipients.length / BATCH_SIZE)}`, explorer("tx", sig));
  }

  console.log("done");
  console.log("signatures", signatures.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
