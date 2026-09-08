import * as fs from "fs";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FomoPnl } from "../target/types/fomo_pnl";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { assert } from "chai";
import {
  DEFAULT_AGENT_BPS,
  DEFAULT_BURN_BPS,
  DEFAULT_CREATOR_BPS,
  DEFAULT_RAKE_BPS,
} from "@fomopred/shared";

const DECIMALS = 6;
const usdc = (n: number) => n * 10 ** DECIMALS;
const trader = new Uint8Array(16).fill(0xae);
const explorer = (kind: "tx" | "address", id: string) =>
  `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;

describe("devnet smoke: fomo_pnl", () => {
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
  const [rakePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("rake")],
    program.programId
  );

  const pdas = (marketId: number) => {
    const marketIdBuffer = Buffer.alloc(8);
    marketIdBuffer.writeBigUInt64LE(BigInt(marketId));
    const [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), marketIdBuffer],
      program.programId
    );
    const [marketVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), marketIdBuffer],
      program.programId
    );
    const position = (user: PublicKey) => {
      const [positionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("position"), marketIdBuffer, user.toBuffer()],
        program.programId
      );
      return positionPda;
    };
    return { marketPda, marketVaultPda, position };
  };

  it("initialize (once) → create → both sides bet → resolve YES at equality → claim", async () => {
    const bob = Keypair.generate();
    const fund = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: bob.publicKey,
        lamports: 80_000_000,
      })
    );
    await provider.sendAndConfirm(fund, [admin]);

    let tokenMint: PublicKey;
    const existing = await provider.connection.getAccountInfo(configPda);
    if (!existing) {
      tokenMint = await createMint(
        provider.connection,
        admin,
        admin.publicKey,
        null,
        DECIMALS
      );
      await program.methods
        .initialize(admin.publicKey)
        .accounts({
          admin: admin.publicKey,
          config: configPda,
          tokenMint,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
      console.log("initialized", explorer("address", configPda.toBase58()));
      console.log("test mint", explorer("address", tokenMint.toBase58()));
    } else {
      const cfg = await program.account.config.fetch(configPda);
      tokenMint = cfg.tokenMint;
      console.log("config already live", explorer("address", configPda.toBase58()));
    }

    const feeAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin,
      tokenMint,
      admin.publicKey
    );
    const aliceAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin,
      tokenMint,
      admin.publicKey
    );
    const bobAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin,
      tokenMint,
      bob.publicKey
    );
    const burnOwner = Keypair.generate();
    const agentOwner = Keypair.generate();
    const burnAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin,
      tokenMint,
      burnOwner.publicKey
    );
    const agentAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin,
      tokenMint,
      agentOwner.publicKey
    );
    if (!(await provider.connection.getAccountInfo(rakePda))) {
      await program.methods
        .initRake(
          admin.publicKey,
          admin.publicKey,
          DEFAULT_RAKE_BPS,
          DEFAULT_BURN_BPS,
          DEFAULT_AGENT_BPS,
          DEFAULT_CREATOR_BPS
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
      console.log("init_rake", explorer("address", rakePda.toBase58()));
    }
    await mintTo(
      provider.connection,
      admin,
      tokenMint,
      aliceAta.address,
      admin,
      usdc(10_000)
    );
    await mintTo(
      provider.connection,
      admin,
      tokenMint,
      bobAta.address,
      admin,
      usdc(10_000)
    );

    const cfg = await program.account.config.fetch(configPda);
    const marketId = cfg.marketCounter.toNumber() + 1;
    const { marketPda, marketVaultPda, position } = pdas(marketId);
    const resolutionTime = Math.floor(Date.now() / 1000) + 90;

    const createSig = await program.methods
      .createMarket(
        Array.from(trader),
        new anchor.BN(usdc(100)),
        new anchor.BN(resolutionTime),
        new anchor.BN(usdc(50)),
        new anchor.BN(0),
        0
      )
      .accounts({
        creator: admin.publicKey,
        config: configPda,
        rake: rakePda,
        market: marketPda,
        marketVault: marketVaultPda,
        tokenMint,
        creatorTokenAccount: aliceAta.address,
        feeRecipientTokenAccount: feeAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
    console.log("create_market", explorer("tx", createSig));

    const yesSig = await program.methods
      .placeBet(new anchor.BN(marketId), { yes: {} }, new anchor.BN(usdc(100)))
      .accounts({
        bettor: admin.publicKey,
        config: configPda,
        market: marketPda,
        marketVault: marketVaultPda,
        userPosition: position(admin.publicKey),
        bettorTokenAccount: aliceAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
    console.log("yes bet", explorer("tx", yesSig));

    const noSig = await program.methods
      .placeBet(new anchor.BN(marketId), { no: {} }, new anchor.BN(usdc(400)))
      .accounts({
        bettor: bob.publicKey,
        config: configPda,
        market: marketPda,
        marketVault: marketVaultPda,
        userPosition: position(bob.publicKey),
        bettorTokenAccount: bobAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([bob])
      .rpc();
    console.log("no bet", explorer("tx", noSig));

    const waitMs = Math.max(0, resolutionTime * 1000 - Date.now()) + 4000;
    console.log(`waiting ${Math.ceil(waitMs / 1000)}s for T`);
    await new Promise((r) => setTimeout(r, waitMs));

    const resolveSig = await program.methods
      .resolveMarket(
        new anchor.BN(marketId),
        new anchor.BN(usdc(100)),
        new anchor.BN(Math.floor(Date.now() / 1000))
      )
      .accounts({
        resolver: admin.publicKey,
        config: configPda,
        rake: rakePda,
        market: marketPda,
        marketVault: marketVaultPda,
        tokenMint,
        founderToken: aliceAta.address,
        burnToken: (await program.account.rake.fetch(rakePda)).burnTreasury,
        agentToken: (await program.account.rake.fetch(rakePda)).agentTreasury,
        creatorToken: aliceAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();
    console.log("resolve_market", explorer("tx", resolveSig));

    const market = await program.account.market.fetch(marketPda);
    assert.deepEqual(market.winningOutcome, { yes: {} });
    assert.deepEqual(market.state, { resolved: {} });

    const before = await getAccount(provider.connection, aliceAta.address);
    const claimSig = await program.methods
      .claimWinnings(new anchor.BN(marketId))
      .accounts({
        user: admin.publicKey,
        market: marketPda,
        marketVault: marketVaultPda,
        userPosition: position(admin.publicKey),
        userTokenAccount: aliceAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();
    console.log("claim_winnings", explorer("tx", claimSig));
    console.log("market", explorer("address", marketPda.toBase58()));

    const after = await getAccount(provider.connection, aliceAta.address);
    assert.equal(after.amount - before.amount, BigInt(usdc(480)));
  });
});
