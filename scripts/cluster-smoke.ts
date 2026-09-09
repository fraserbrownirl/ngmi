/**
 * Smoke: create → both sides bet → resolve after T → claim, direct on-chain.
 *
 * CLUSTER=devnet (default): fresh test-USDC minted to the bettors, deploy
 * wallet plays every role. Uses SOLANA_RPC_URL (default public devnet).
 *
 * CLUSTER=mainnet: real USDC, deploy wallet bets BOTH sides of one short
 * market with SMOKE_YES_USDC / SMOKE_NO_USDC (default 0.5 each), and the
 * dedicated resolver key posts the resolve. Requires MAINNET_ACK=YES and
 * real USDC in the deploy wallet. Verifies every rake slice lands:
 * founder / burn / agent / creator.
 *
 * Market note: the smoke uses a synthetic trader id (0xae…), so the market
 * reads as a test on any UI that maps ids to FomoScan handles.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FomoPnl } from "../target/types/fomo_pnl";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddress,
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
const CLUSTER = process.env.CLUSTER ?? "devnet";
const RPC_URL =
  process.env.SOLANA_RPC_URL ??
  (CLUSTER === "mainnet"
    ? process.env.HELIUS_API_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
      : "https://api.mainnet-beta.solana.com"
    : "https://api.devnet.solana.com");
const RESOLVER_KEYPAIR_FILE =
  process.env.FOMO_RESOLVER_KEYPAIR_FILE ??
  path.join(os.homedir(), ".config", "fomo", "mainnet-resolver.json");
const explorer = (kind: "tx" | "address", id: string) =>
  `https://explorer.solana.com/${kind}/${id}${CLUSTER === "mainnet" ? "" : "?cluster=devnet"}`;

const loadKeypair = (file: string) =>
  Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(file, "utf8")) as number[]),
  );

describe(`${CLUSTER} smoke: fomo_pnl`, () => {
  const payer = loadKeypair(
    path.join(os.homedir(), ".config", "solana", "id.json"),
  );
  const provider = new anchor.AnchorProvider(
    new Connection(RPC_URL, "confirmed"),
    new anchor.Wallet(payer),
    { commitment: "confirmed" },
  );
  anchor.setProvider(provider);
  const idl = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../target/idl/fomo_pnl.json"), "utf8"),
  );
  const program = new Program(idl, provider) as Program<FomoPnl>;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );
  const [rakePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("rake")],
    program.programId,
  );

  const pdas = (marketId: number) => {
    const marketIdBuffer = Buffer.alloc(8);
    marketIdBuffer.writeBigUInt64LE(BigInt(marketId));
    const [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), marketIdBuffer],
      program.programId,
    );
    const [marketVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), marketIdBuffer],
      program.programId,
    );
    const position = (user: PublicKey) => {
      const [positionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("position"), marketIdBuffer, user.toBuffer()],
        program.programId,
      );
      return positionPda;
    };
    return { marketPda, marketVaultPda, position };
  };

  it("create → both sides bet → resolve YES at equality → claim", async () => {
    if (CLUSTER === "mainnet") {
      await mainnetSmoke();
    } else {
      await devnetSmoke();
    }
  });

  async function devnetSmoke() {
    const admin = payer;
    const bob = Keypair.generate();
    const fund = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: bob.publicKey,
        lamports: 80_000_000,
      }),
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
        DECIMALS,
      );
      await program.methods
        .initialize(admin.publicKey)
        .accounts({ admin: admin.publicKey, tokenMint })
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
      admin.publicKey,
    );
    const aliceAta = feeAta;
    const bobAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin,
      tokenMint,
      bob.publicKey,
    );
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
    if (!(await provider.connection.getAccountInfo(rakePda))) {
      await program.methods
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
      console.log("init_rake", explorer("address", rakePda.toBase58()));
    }
    await mintTo(
      provider.connection,
      admin,
      tokenMint,
      aliceAta.address,
      admin,
      usdc(10_000),
    );
    await mintTo(
      provider.connection,
      admin,
      tokenMint,
      bobAta.address,
      admin,
      usdc(10_000),
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
        0,
      )
      .accountsPartial({
        creator: admin.publicKey,
        market: marketPda,
        marketVault: marketVaultPda,
        tokenMint,
        creatorTokenAccount: aliceAta.address,
        feeRecipientTokenAccount: feeAta.address,
      })
      .signers([admin])
      .rpc();
    console.log("create_market", explorer("tx", createSig));

    const yesSig = await program.methods
      .placeBet(new anchor.BN(marketId), { yes: {} }, new anchor.BN(usdc(100)))
      .accountsPartial({
        bettor: admin.publicKey,
        market: marketPda,
        marketVault: marketVaultPda,
        userPosition: position(admin.publicKey),
        bettorTokenAccount: aliceAta.address,
      })
      .signers([admin])
      .rpc();
    console.log("yes bet", explorer("tx", yesSig));

    const noSig = await program.methods
      .placeBet(new anchor.BN(marketId), { no: {} }, new anchor.BN(usdc(400)))
      .accountsPartial({
        bettor: bob.publicKey,
        market: marketPda,
        marketVault: marketVaultPda,
        userPosition: position(bob.publicKey),
        bettorTokenAccount: bobAta.address,
      })
      .signers([bob])
      .rpc();
    console.log("no bet", explorer("tx", noSig));

    const waitMs = Math.max(0, resolutionTime * 1000 - Date.now()) + 4000;
    console.log(`waiting ${Math.ceil(waitMs / 1000)}s for T`);
    await new Promise((r) => setTimeout(r, waitMs));

    const rake = await program.account.rake.fetch(rakePda);
    const resolveSig = await program.methods
      .resolveMarket(
        new anchor.BN(marketId),
        new anchor.BN(usdc(100)),
        new anchor.BN(Math.floor(Date.now() / 1000)),
      )
      .accountsPartial({
        resolver: admin.publicKey,
        market: marketPda,
        marketVault: marketVaultPda,
        tokenMint,
        founderToken: aliceAta.address,
        burnToken: rake.burnTreasury,
        agentToken: rake.agentTreasury,
        creatorToken: aliceAta.address,
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
      .accountsPartial({
        user: admin.publicKey,
        market: marketPda,
        marketVault: marketVaultPda,
        userPosition: position(admin.publicKey),
        userTokenAccount: aliceAta.address,
      })
      .signers([admin])
      .rpc();
    console.log("claim_winnings", explorer("tx", claimSig));
    console.log("market", explorer("address", marketPda.toBase58()));

    const after = await getAccount(provider.connection, aliceAta.address);
    assert.equal(after.amount - before.amount, BigInt(usdc(480)));
  }

  async function mainnetSmoke() {
    if (process.env.MAINNET_ACK !== "YES") {
      throw new Error("mainnet smoke requires MAINNET_ACK=YES");
    }
    const yesUsdc = Number(process.env.SMOKE_YES_USDC ?? "0.5");
    const noUsdc = Number(process.env.SMOKE_NO_USDC ?? "0.5");
    const cfg = await program.account.config.fetch(configPda);
    const rake = await program.account.rake.fetch(rakePda);
    const tokenMint = cfg.tokenMint;
    console.log("config:", explorer("address", configPda.toBase58()));
    console.log("mint:", tokenMint.toBase58());

    // Bettor (deploy wallet) needs real USDC on both sides.
    const bettorAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      tokenMint,
      payer.publicKey,
    );
    const bal = await getAccount(provider.connection, bettorAta.address);
    const need = BigInt(usdc(yesUsdc + noUsdc));
    assert.isAtLeast(
      Number(bal.amount),
      Number(need),
      `deploy wallet needs >= ${yesUsdc + noUsdc} USDC in ${bettorAta.address.toBase58()}`,
    );

    // Resolver hot key signs the resolve; top it up with fee money.
    const resolver = loadKeypair(RESOLVER_KEYPAIR_FILE);
    assert.equal(
      resolver.publicKey.toBase58(),
      cfg.resolver.toBase58(),
      "resolver keypair file does not match on-chain config.resolver",
    );
    const resolverBal = await provider.connection.getBalance(resolver.publicKey);
    if (resolverBal < 5_000_000) {
      const fund = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: resolver.publicKey,
          lamports: 10_000_000,
        }),
      );
      const fundSig = await provider.sendAndConfirm(fund, [payer]);
      console.log("funded resolver with 0.01 SOL:", explorer("tx", fundSig));
    }

    const feeAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      tokenMint,
      cfg.feeRecipient,
      true,
    );

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
        0,
      )
      .accountsPartial({
        creator: payer.publicKey,
        market: marketPda,
        marketVault: marketVaultPda,
        tokenMint,
        creatorTokenAccount: bettorAta.address,
        feeRecipientTokenAccount: feeAta.address,
      })
      .signers([payer])
      .rpc();
    console.log("create_market", explorer("tx", createSig));

    const yesSig = await program.methods
      .placeBet(new anchor.BN(marketId), { yes: {} }, new anchor.BN(usdc(yesUsdc)))
      .accountsPartial({
        bettor: payer.publicKey,
        market: marketPda,
        marketVault: marketVaultPda,
        userPosition: position(payer.publicKey),
        bettorTokenAccount: bettorAta.address,
      })
      .signers([payer])
      .rpc();
    console.log("yes bet", explorer("tx", yesSig));

    const noSig = await program.methods
      .placeBet(new anchor.BN(marketId), { no: {} }, new anchor.BN(usdc(noUsdc)))
      .accountsPartial({
        bettor: payer.publicKey,
        market: marketPda,
        marketVault: marketVaultPda,
        userPosition: position(payer.publicKey),
        bettorTokenAccount: bettorAta.address,
      })
      .signers([payer])
      .rpc();
    console.log("no bet", explorer("tx", noSig));

    const waitMs = Math.max(0, resolutionTime * 1000 - Date.now()) + 4000;
    console.log(`waiting ${Math.ceil(waitMs / 1000)}s for T`);
    await new Promise((r) => setTimeout(r, waitMs));

    // Snapshot rake recipients before resolve.
    const founderAta = await getAssociatedTokenAddress(tokenMint, rake.founder, true);
    const sliceBefore = async (ata: PublicKey) =>
      (await getAccount(provider.connection, ata)).amount;
    const founderBefore = await sliceBefore(founderAta);
    const burnBefore = await sliceBefore(rake.burnTreasury);
    const agentBefore = await sliceBefore(rake.agentTreasury);
    const creatorBefore = await sliceBefore(bettorAta.address);

    const resolveSig = await program.methods
      .resolveMarket(
        new anchor.BN(marketId),
        new anchor.BN(usdc(100)),
        new anchor.BN(Math.floor(Date.now() / 1000)),
      )
      .accountsPartial({
        resolver: resolver.publicKey,
        market: marketPda,
        marketVault: marketVaultPda,
        tokenMint,
        founderToken: founderAta,
        burnToken: rake.burnTreasury,
        agentToken: rake.agentTreasury,
        creatorToken: bettorAta.address,
      })
      .signers([resolver])
      .rpc();
    console.log("resolve_market (resolver key):", explorer("tx", resolveSig));

    const market = await program.account.market.fetch(marketPda);
    assert.deepEqual(market.winningOutcome, { yes: {} });
    assert.deepEqual(market.state, { resolved: {} });

    // Rake: 5% of the losing pool, split founder 50 / burn 300 / agent 50 / creator 50.
    const losing = BigInt(usdc(noUsdc));
    const rakeTotal = (losing * BigInt(DEFAULT_RAKE_BPS)) / 10_000n;
    const expect = {
      founder: (losing * 50n) / 10_000n,
      burn: (losing * BigInt(DEFAULT_BURN_BPS)) / 10_000n,
      agent: (losing * BigInt(DEFAULT_AGENT_BPS)) / 10_000n,
      creator: (losing * BigInt(DEFAULT_CREATOR_BPS)) / 10_000n,
    };
    assert.equal(
      (await sliceBefore(founderAta)) - founderBefore,
      expect.founder,
      "founder slice",
    );
    assert.equal(
      (await sliceBefore(rake.burnTreasury)) - burnBefore,
      expect.burn,
      "burn slice",
    );
    assert.equal(
      (await sliceBefore(rake.agentTreasury)) - agentBefore,
      expect.agent,
      "agent slice",
    );
    // Creator is the bettor wallet; its ATA also pays out the claim below, so
    // check the creator slice as part of the claim delta instead.
    console.log(
      `rake verified: founder ${expect.founder} burn ${expect.burn} agent ${expect.agent} (total ${rakeTotal})`,
    );

    const claimSig = await program.methods
      .claimWinnings(new anchor.BN(marketId))
      .accountsPartial({
        user: payer.publicKey,
        market: marketPda,
        marketVault: marketVaultPda,
        userPosition: position(payer.publicKey),
        userTokenAccount: bettorAta.address,
      })
      .signers([payer])
      .rpc();
    console.log("claim_winnings", explorer("tx", claimSig));
    console.log("market", explorer("address", marketPda.toBase58()));

    const after = await getAccount(provider.connection, bettorAta.address);
    // Winner sweep: yes stake + (losing pool - rake) + creator slice.
    const expectedDelta =
      BigInt(usdc(yesUsdc)) + (losing - rakeTotal) + expect.creator;
    assert.equal(
      after.amount - creatorBefore,
      expectedDelta,
      "claim + creator slice",
    );
  }
});
