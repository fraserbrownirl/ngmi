import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FomoPnl } from "../target/types/fomo_pnl";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  getAccount,
  mintTo,
} from "@solana/spl-token";
import { assert } from "chai";
import {
  bpsOf,
  DEFAULT_AGENT_BPS,
  DEFAULT_BURN_BPS,
  DEFAULT_CREATOR_BPS,
  DEFAULT_RAKE_BPS,
  FOUNDER_BPS,
  fomoUserIdToBytes,
  rakeAmount,
  SETTLE_FIRST_PRINT,
} from "@fomopred/shared";
import {
  BET,
  CHANGE_ID,
  FALLBACK_START_USD,
  GOAT_ID,
  justOverMarks,
  justOverNoPool,
  justOverYesPool,
  moonMarks,
  moonNoPool,
  moonYesPool,
  winnerPayout,
} from "../scripts/four-wallet-plan";

type Actor = { key: Keypair; ata: PublicKey };

describe("fomo_pnl", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.FomoPnl as Program<FomoPnl>;

  let admin: Keypair;
  let resolver: Keypair;
  let alice: Keypair;
  let bob: Keypair;
  let founder: Keypair;
  let tokenMint: PublicKey;
  let feeRecipientTokenAccount: PublicKey;
  let aliceTokenAccount: PublicKey;
  let bobTokenAccount: PublicKey;
  let founderTokenAccount: PublicKey;
  let burnTokenAccount: PublicKey;
  let agentTokenAccount: PublicKey;
  let configPda: PublicKey;
  let rakePda: PublicKey;
  let currentMarketId = 0;

  const DECIMALS = 6;
  const STARTING_USDC = 10_000;
  const usdc = (n: number) => n * 10 ** DECIMALS;
  const trader = new Uint8Array(16).fill(0xae);

  const getMarketPdas = (marketId: number) => {
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
    return { marketPda, marketVaultPda };
  };

  const getPositionPda = (marketId: number, user: PublicKey) => {
    const marketIdBuffer = Buffer.alloc(8);
    marketIdBuffer.writeBigUInt64LE(BigInt(marketId));
    const [positionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), marketIdBuffer, user.toBuffer()],
      program.programId
    );
    return positionPda;
  };

  const tokenBal = async (ata: PublicKey) =>
    Number((await getAccount(provider.connection, ata)).amount);

  const waitUntil = async (unixSeconds: number) => {
    const ms = unixSeconds * 1000 - Date.now() + 1500;
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  };

  const airdrop = async (kp: Keypair) => {
    const sig = await provider.connection.requestAirdrop(
      kp.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "confirmed");
  };

  const createMarketFor = async (
    creator: Actor,
    threshold: number,
    startPnl: number,
    resolutionTime: number,
    fomoUserId: Uint8Array = trader,
    settleKind = 0
  ) => {
    currentMarketId += 1;
    const { marketPda, marketVaultPda } = getMarketPdas(currentMarketId);
    await program.methods
      .createMarket(
        Array.from(fomoUserId),
        new anchor.BN(threshold),
        new anchor.BN(resolutionTime),
        new anchor.BN(startPnl),
        new anchor.BN(0),
        settleKind
      )
      .accounts({
        creator: creator.key.publicKey,
        config: configPda,
        rake: rakePda,
        market: marketPda,
        marketVault: marketVaultPda,
        tokenMint,
        creatorTokenAccount: creator.ata,
        feeRecipientTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([creator.key])
      .rpc();
    return currentMarketId;
  };

  const createMarket = async (
    threshold: number,
    startPnl: number,
    resolutionTime: number,
    settleKind = 0
  ) =>
    createMarketFor(
      { key: alice, ata: aliceTokenAccount },
      threshold,
      startPnl,
      resolutionTime,
      trader,
      settleKind
    );

  const placeBet = async (
    user: Keypair,
    tokenAccount: PublicKey,
    marketId: number,
    yes: boolean,
    amount: number
  ) => {
    const { marketPda, marketVaultPda } = getMarketPdas(marketId);
    await program.methods
      .placeBet(new anchor.BN(marketId), yes ? { yes: {} } : { no: {} }, new anchor.BN(amount))
      .accounts({
        bettor: user.publicKey,
        config: configPda,
        market: marketPda,
        marketVault: marketVaultPda,
        userPosition: getPositionPda(marketId, user.publicKey),
        bettorTokenAccount: tokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user])
      .rpc();
  };

  const resolveMarket = async (
    marketId: number,
    endPnl: number,
    signer = admin,
    creatorAta = aliceTokenAccount
  ) => {
    const { marketPda, marketVaultPda } = getMarketPdas(marketId);
    await program.methods
      .resolveMarket(
        new anchor.BN(marketId),
        new anchor.BN(endPnl),
        new anchor.BN(Math.floor(Date.now() / 1000))
      )
      .accounts({
        resolver: signer.publicKey,
        config: configPda,
        rake: rakePda,
        market: marketPda,
        marketVault: marketVaultPda,
        tokenMint,
        founderToken: founderTokenAccount,
        burnToken: burnTokenAccount,
        agentToken: agentTokenAccount,
        creatorToken: creatorAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([signer])
      .rpc();
  };

  const claimWinnings = async (user: Actor, marketId: number) => {
    const { marketPda, marketVaultPda } = getMarketPdas(marketId);
    await program.methods
      .claimWinnings(new anchor.BN(marketId))
      .accounts({
        user: user.key.publicKey,
        market: marketPda,
        marketVault: marketVaultPda,
        userPosition: getPositionPda(marketId, user.key.publicKey),
        userTokenAccount: user.ata,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user.key])
      .rpc();
  };

  const fundActor = async (): Promise<Actor> => {
    const key = Keypair.generate();
    await airdrop(key);
    const ata = await createAccount(provider.connection, admin, tokenMint, key.publicKey);
    await mintTo(provider.connection, admin, tokenMint, ata, admin, usdc(STARTING_USDC));
    return { key, ata };
  };

  before(async () => {
    admin = Keypair.generate();
    resolver = Keypair.generate();
    alice = Keypair.generate();
    bob = Keypair.generate();
    founder = Keypair.generate();
    for (const k of [admin, resolver, alice, bob, founder]) {
      await airdrop(k);
    }

    tokenMint = await createMint(provider.connection, admin, admin.publicKey, null, DECIMALS);
    feeRecipientTokenAccount = await createAccount(provider.connection, admin, tokenMint, admin.publicKey);
    aliceTokenAccount = await createAccount(provider.connection, alice, tokenMint, alice.publicKey);
    bobTokenAccount = await createAccount(provider.connection, bob, tokenMint, bob.publicKey);
    const burnOwner = Keypair.generate();
    const agentOwner = Keypair.generate();
    founderTokenAccount = await createAccount(provider.connection, admin, tokenMint, founder.publicKey);
    burnTokenAccount = await createAccount(provider.connection, admin, tokenMint, burnOwner.publicKey);
    agentTokenAccount = await createAccount(provider.connection, admin, tokenMint, agentOwner.publicKey);
    await mintTo(provider.connection, admin, tokenMint, aliceTokenAccount, admin, usdc(STARTING_USDC));
    await mintTo(provider.connection, admin, tokenMint, bobTokenAccount, admin, usdc(STARTING_USDC));

    [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
    [rakePda] = PublicKey.findProgramAddressSync([Buffer.from("rake")], program.programId);
    await program.methods
      .initialize(admin.publicKey, 0)
      .accounts({
        admin: admin.publicKey,
        config: configPda,
        tokenMint,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
    await program.methods
      .initRake(
        admin.publicKey,
        founder.publicKey,
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
        burnTreasury: burnTokenAccount,
        agentTreasury: agentTokenAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
  });

  it("reverts create when T is more than three days out", async () => {
    try {
      await createMarket(usdc(100), usdc(50), Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60 + 60);
      assert.fail("should revert");
    } catch (e: unknown) {
      assert.include(String(e), "InvalidResolutionTime");
    }
    currentMarketId -= 1;
  });

  it("reverts create when start pnl meets threshold", async () => {
    try {
      await createMarket(usdc(100), usdc(100), Math.floor(Date.now() / 1000) + 5);
      assert.fail("should revert");
    } catch (e: unknown) {
      assert.include(String(e), "AlreadyAboveThreshold");
    }
    currentMarketId -= 1;
  });

  it("create → bet both sides → resolve equality → claim", async () => {
    const id = await createMarket(usdc(100), usdc(50), Math.floor(Date.now() / 1000) + 3);
    await placeBet(alice, aliceTokenAccount, id, true, usdc(100));
    await placeBet(bob, bobTokenAccount, id, false, usdc(400));
    await waitUntil(Math.floor(Date.now() / 1000) + 3);
    await resolveMarket(id, usdc(100));
    const { marketPda } = getMarketPdas(id);
    const m = await program.account.market.fetch(marketPda);
    assert.deepEqual(m.winningOutcome, { yes: {} });
    assert.equal(m.rakeBps, DEFAULT_RAKE_BPS);
    assert.equal(m.rakeTotal.toNumber(), rakeAmount(usdc(400)));
    await claimWinnings({ key: alice, ata: aliceTokenAccount }, id);
  });

  it("empty opposing pool cancels on resolve", async () => {
    const id = await createMarket(usdc(100), usdc(10), Math.floor(Date.now() / 1000) + 3);
    await placeBet(alice, aliceTokenAccount, id, true, usdc(50));
    await waitUntil(Math.floor(Date.now() / 1000) + 3);
    const burnBefore = await tokenBal(burnTokenAccount);
    await resolveMarket(id, usdc(200));
    const { marketPda } = getMarketPdas(id);
    const m = await program.account.market.fetch(marketPda);
    assert.deepEqual(m.state, { cancelled: {} });
    assert.equal(m.rakeTotal.toNumber(), 0);
    assert.equal(await tokenBal(burnTokenAccount), burnBefore);
    await claimWinnings({ key: alice, ata: aliceTokenAccount }, id);
  });

  it("rejects an unknown settle kind", async () => {
    try {
      await createMarket(usdc(100), usdc(50), Math.floor(Date.now() / 1000) + 8, 2);
      assert.fail("should revert");
    } catch (e: unknown) {
      assert.include(String(e), "InvalidSettleKind");
    }
    currentMarketId -= 1;
  });

  it("first-print resolves YES before T and then rejects bets", async () => {
    const id = await createMarket(
      usdc(100),
      usdc(50),
      Math.floor(Date.now() / 1000) + 30,
      SETTLE_FIRST_PRINT
    );
    const { marketPda } = getMarketPdas(id);
    assert.equal((await program.account.market.fetch(marketPda)).window, SETTLE_FIRST_PRINT);
    await placeBet(alice, aliceTokenAccount, id, true, usdc(100));
    await placeBet(bob, bobTokenAccount, id, false, usdc(100));
    await resolveMarket(id, usdc(100));
    const m = await program.account.market.fetch(marketPda);
    assert.deepEqual(m.state, { resolved: {} });
    assert.deepEqual(m.winningOutcome, { yes: {} });
    try {
      await placeBet(alice, aliceTokenAccount, id, true, usdc(10));
      assert.fail("should revert");
    } catch (e: unknown) {
      assert.include(String(e), "MarketNotActive");
    }
  });

  it("first-print under the mark cannot resolve before T", async () => {
    const id = await createMarket(
      usdc(100),
      usdc(50),
      Math.floor(Date.now() / 1000) + 30,
      SETTLE_FIRST_PRINT
    );
    await placeBet(alice, aliceTokenAccount, id, true, usdc(50));
    await placeBet(bob, bobTokenAccount, id, false, usdc(50));
    try {
      await resolveMarket(id, usdc(99));
      assert.fail("should revert");
    } catch (e: unknown) {
      assert.include(String(e), "MarketNotExpired");
    }
  });

  it("close-at-T cannot resolve before T even when over", async () => {
    const id = await createMarket(usdc(100), usdc(50), Math.floor(Date.now() / 1000) + 30);
    await placeBet(alice, aliceTokenAccount, id, true, usdc(50));
    await placeBet(bob, bobTokenAccount, id, false, usdc(50));
    try {
      await resolveMarket(id, usdc(200));
      assert.fail("should revert");
    } catch (e: unknown) {
      assert.include(String(e), "MarketNotExpired");
    }
  });

  it("first-print at T with no hit is NO", async () => {
    const id = await createMarket(
      usdc(100),
      usdc(50),
      Math.floor(Date.now() / 1000) + 3,
      SETTLE_FIRST_PRINT
    );
    await placeBet(alice, aliceTokenAccount, id, true, usdc(100));
    await placeBet(bob, bobTokenAccount, id, false, usdc(100));
    await waitUntil(Math.floor(Date.now() / 1000) + 3);
    await resolveMarket(id, usdc(99));
    const { marketPda } = getMarketPdas(id);
    const m = await program.account.market.fetch(marketPda);
    assert.deepEqual(m.state, { resolved: {} });
    assert.deepEqual(m.winningOutcome, { no: {} });
  });

  /**
   * Four-wallet plan — pots a real book would actually fade or back.
   *
   *   A  @change     just $1 over existing PnL. A small tick prints YES.
   *   B  @PoorGoat_  $25M moon shot. A +$40k print still misses; NO.
   *
   * Keeper is a dedicated resolver key (setResolver), not the admin hot key.
   */
  describe("four-wallet lifecycle", () => {
    const JUST_OVER = justOverMarks(FALLBACK_START_USD);
    const MOON = moonMarks(FALLBACK_START_USD);
    const CHANGE = fomoUserIdToBytes(CHANGE_ID);
    const GOAT = fomoUserIdToBytes(GOAT_ID);
    const LOCAL_WINDOW_SECS = 8;

    let creator: Actor;
    let yesWallet: Actor;
    let noWallet: Actor;
    let fade: Actor;

    let yesMarketId: number;
    let noMarketId: number;
    let yesDeadline: number;
    let noDeadline: number;

    before(async () => {
      assert.isAbove(JUST_OVER.endPnl, JUST_OVER.threshold);
      assert.isBelow(MOON.endPnl, MOON.threshold);
      assert.equal(JUST_OVER.threshold, JUST_OVER.startPnl + usdc(1));

      creator = await fundActor();
      yesWallet = await fundActor();
      noWallet = await fundActor();
      fade = await fundActor();

      await program.methods
        .setResolver(resolver.publicKey)
        .accounts({
          admin: admin.publicKey,
          config: configPda,
        })
        .signers([admin])
        .rpc();
    });

    it("W1 opens a 1h pot just $1 over existing PnL (obvious YES)", async () => {
      yesDeadline = Math.floor(Date.now() / 1000) + LOCAL_WINDOW_SECS;
      yesMarketId = await createMarketFor(
        creator,
        JUST_OVER.threshold,
        JUST_OVER.startPnl,
        yesDeadline,
        CHANGE
      );

      const { marketPda, marketVaultPda } = getMarketPdas(yesMarketId);
      const market = await program.account.market.fetch(marketPda);
      assert.equal(market.marketId.toNumber(), yesMarketId);
      assert.equal(market.creator.toBase58(), creator.key.publicKey.toBase58());
      assert.deepEqual(market.state, { active: {} });
      assert.deepEqual(market.winningOutcome, { none: {} });
      assert.equal(market.startPnlUsd.toNumber(), JUST_OVER.startPnl);
      assert.equal(market.thresholdUsd.toNumber(), JUST_OVER.threshold);
      assert.deepEqual(Uint8Array.from(market.fomoUserId), CHANGE);
      assert.equal(market.yesPool.toNumber(), 0);
      assert.equal(market.noPool.toNumber(), 0);
      assert.equal(market.rakeBps, DEFAULT_RAKE_BPS);
      assert.equal(market.burnBps, DEFAULT_BURN_BPS);
      assert.equal(market.agentBps, DEFAULT_AGENT_BPS);
      assert.equal(market.creatorBps, DEFAULT_CREATOR_BPS);
      assert.equal(market.founderBps, FOUNDER_BPS);
      assert.equal(market.rakeTotal.toNumber(), 0);
      assert.equal(await tokenBal(marketVaultPda), 0);
    });

    it("smart wallets stack YES; fade wallets take the doomed NO", async () => {
      await placeBet(creator.key, creator.ata, yesMarketId, true, BET.justOverYesCreator);
      await placeBet(yesWallet.key, yesWallet.ata, yesMarketId, true, BET.justOverYesStacked);
      await placeBet(yesWallet.key, yesWallet.ata, yesMarketId, true, BET.justOverYesStacked);
      await placeBet(noWallet.key, noWallet.ata, yesMarketId, false, BET.justOverNoFade);
      await placeBet(fade.key, fade.ata, yesMarketId, false, BET.justOverNoFade);

      const { marketPda, marketVaultPda } = getMarketPdas(yesMarketId);
      const market = await program.account.market.fetch(marketPda);
      assert.equal(market.yesPool.toNumber(), justOverYesPool);
      assert.equal(market.noPool.toNumber(), justOverNoPool);
      assert.equal(await tokenBal(marketVaultPda), justOverYesPool + justOverNoPool);

      const yesPos = await program.account.userPosition.fetch(
        getPositionPda(yesMarketId, yesWallet.key.publicKey)
      );
      assert.equal(yesPos.yesBet.toNumber(), BET.justOverYesStacked * 2);
      assert.equal(yesPos.noBet.toNumber(), 0);

      assert.equal(await tokenBal(creator.ata), usdc(STARTING_USDC) - BET.justOverYesCreator);
      assert.equal(await tokenBal(yesWallet.ata), usdc(STARTING_USDC) - BET.justOverYesStacked * 2);
      assert.equal(await tokenBal(noWallet.ata), usdc(STARTING_USDC) - BET.justOverNoFade);
      assert.equal(await tokenBal(fade.ata), usdc(STARTING_USDC) - BET.justOverNoFade);
    });

    it("resolver posts a small 1h tick that clears by $11 — YES", async () => {
      await waitUntil(yesDeadline);
      const treasuries = {
        founder: await tokenBal(founderTokenAccount),
        burn: await tokenBal(burnTokenAccount),
        agent: await tokenBal(agentTokenAccount),
      };
      await resolveMarket(yesMarketId, JUST_OVER.endPnl, resolver, creator.ata);

      const { marketPda } = getMarketPdas(yesMarketId);
      const market = await program.account.market.fetch(marketPda);
      assert.deepEqual(market.state, { resolved: {} });
      assert.deepEqual(market.winningOutcome, { yes: {} });
      assert.equal(market.endPnlUsd.toNumber(), JUST_OVER.endPnl);
      assert.isAtLeast(market.endPnlUsd.toNumber(), market.thresholdUsd.toNumber());
      assert.equal(market.rakeTotal.toNumber(), rakeAmount(justOverNoPool));
      assert.equal(
        (await tokenBal(founderTokenAccount)) - treasuries.founder,
        bpsOf(justOverNoPool, FOUNDER_BPS)
      );
      assert.equal(
        (await tokenBal(burnTokenAccount)) - treasuries.burn,
        bpsOf(justOverNoPool, DEFAULT_BURN_BPS)
      );
      assert.equal(
        (await tokenBal(agentTokenAccount)) - treasuries.agent,
        bpsOf(justOverNoPool, DEFAULT_AGENT_BPS)
      );
    });

    it("YES winners receive stake plus share; NO wallets get nothing back", async () => {
      const creatorPayout = winnerPayout(BET.justOverYesCreator, justOverYesPool, justOverNoPool);
      const yesPayout = winnerPayout(BET.justOverYesStacked * 2, justOverYesPool, justOverNoPool);
      assert.equal(creatorPayout, usdc(247.5));
      assert.equal(yesPayout, usdc(247.5));

      const before = {
        creator: await tokenBal(creator.ata),
        yes: await tokenBal(yesWallet.ata),
        no: await tokenBal(noWallet.ata),
        fade: await tokenBal(fade.ata),
      };

      await claimWinnings(creator, yesMarketId);
      await claimWinnings(yesWallet, yesMarketId);
      await claimWinnings(noWallet, yesMarketId);
      await claimWinnings(fade, yesMarketId);

      assert.equal((await tokenBal(creator.ata)) - before.creator, creatorPayout);
      assert.equal((await tokenBal(yesWallet.ata)) - before.yes, yesPayout);
      assert.equal((await tokenBal(noWallet.ata)) - before.no, 0);
      assert.equal((await tokenBal(fade.ata)) - before.fade, 0);

      assert.equal(
        await tokenBal(creator.ata),
        usdc(STARTING_USDC) - BET.justOverYesCreator + bpsOf(justOverNoPool, DEFAULT_CREATOR_BPS) + creatorPayout
      );
      assert.equal(await tokenBal(yesWallet.ata), usdc(STARTING_USDC) - BET.justOverYesStacked * 2 + yesPayout);
      assert.equal(await tokenBal(noWallet.ata), usdc(STARTING_USDC) - BET.justOverNoFade);
      assert.equal(await tokenBal(fade.ata), usdc(STARTING_USDC) - BET.justOverNoFade);

      const { marketVaultPda } = getMarketPdas(yesMarketId);
      assert.equal(await tokenBal(marketVaultPda), 0);

      const claimed = await program.account.userPosition.fetch(
        getPositionPda(yesMarketId, creator.key.publicKey)
      );
      assert.isTrue(claimed.claimed);
    });

    it("rejects a second claim from a YES winner", async () => {
      try {
        await claimWinnings(creator, yesMarketId);
        assert.fail("double claim should revert");
      } catch (e: unknown) {
        assert.include(String(e), "AlreadyClaimed");
      }
    });

    it("W1 opens a $25M moon pot against $2.59M existing (obvious NO)", async () => {
      noDeadline = Math.floor(Date.now() / 1000) + LOCAL_WINDOW_SECS;
      noMarketId = await createMarketFor(
        creator,
        MOON.threshold,
        MOON.startPnl,
        noDeadline,
        GOAT
      );

      const { marketPda } = getMarketPdas(noMarketId);
      const market = await program.account.market.fetch(marketPda);
      assert.equal(market.creator.toBase58(), creator.key.publicKey.toBase58());
      assert.deepEqual(market.state, { active: {} });
      assert.equal(market.startPnlUsd.toNumber(), MOON.startPnl);
      assert.equal(market.thresholdUsd.toNumber(), MOON.threshold);
      assert.deepEqual(Uint8Array.from(market.fomoUserId), GOAT);
      assert.isBelow(market.startPnlUsd.toNumber(), market.thresholdUsd.toNumber());
    });

    it("smart wallets stack NO; fade wallets buy the moon", async () => {
      await placeBet(creator.key, creator.ata, noMarketId, false, BET.moonNoCreator);
      await placeBet(yesWallet.key, yesWallet.ata, noMarketId, true, BET.moonYesFade);
      await placeBet(noWallet.key, noWallet.ata, noMarketId, false, BET.moonNoStacked);
      await placeBet(fade.key, fade.ata, noMarketId, true, BET.moonYesFade);

      const { marketPda, marketVaultPda } = getMarketPdas(noMarketId);
      const market = await program.account.market.fetch(marketPda);
      assert.equal(market.yesPool.toNumber(), moonYesPool);
      assert.equal(market.noPool.toNumber(), moonNoPool);
      assert.equal(await tokenBal(marketVaultPda), moonYesPool + moonNoPool);
    });

    it("resolver posts a +$40k hour that is still $22M short — NO", async () => {
      await waitUntil(noDeadline);
      const founderBefore = await tokenBal(founderTokenAccount);
      await resolveMarket(noMarketId, MOON.endPnl, resolver, creator.ata);

      const { marketPda } = getMarketPdas(noMarketId);
      const market = await program.account.market.fetch(marketPda);
      assert.deepEqual(market.state, { resolved: {} });
      assert.deepEqual(market.winningOutcome, { no: {} });
      assert.equal(market.endPnlUsd.toNumber(), MOON.endPnl);
      assert.isBelow(market.endPnlUsd.toNumber(), market.thresholdUsd.toNumber());
      assert.equal(market.rakeTotal.toNumber(), rakeAmount(moonYesPool));
      assert.equal(
        (await tokenBal(founderTokenAccount)) - founderBefore,
        bpsOf(moonYesPool, FOUNDER_BPS)
      );
    });

    it("NO winners receive stake plus share; YES wallets get nothing back", async () => {
      const creatorPayout = winnerPayout(BET.moonNoCreator, moonNoPool, moonYesPool);
      const noPayout = winnerPayout(BET.moonNoStacked, moonNoPool, moonYesPool);
      assert.equal(creatorPayout, usdc(247.5));
      assert.equal(noPayout, usdc(247.5));

      const before = {
        creator: await tokenBal(creator.ata),
        yes: await tokenBal(yesWallet.ata),
        no: await tokenBal(noWallet.ata),
        fade: await tokenBal(fade.ata),
      };

      await claimWinnings(creator, noMarketId);
      await claimWinnings(yesWallet, noMarketId);
      await claimWinnings(noWallet, noMarketId);
      await claimWinnings(fade, noMarketId);

      assert.equal((await tokenBal(creator.ata)) - before.creator, creatorPayout);
      assert.equal((await tokenBal(yesWallet.ata)) - before.yes, 0);
      assert.equal((await tokenBal(noWallet.ata)) - before.no, noPayout);
      assert.equal((await tokenBal(fade.ata)) - before.fade, 0);

      const justOverCreatorCut = bpsOf(justOverNoPool, DEFAULT_CREATOR_BPS);
      const moonCreatorCut = bpsOf(moonYesPool, DEFAULT_CREATOR_BPS);
      const justOverYesPayout = winnerPayout(
        BET.justOverYesStacked * 2,
        justOverYesPool,
        justOverNoPool
      );
      assert.equal(
        await tokenBal(creator.ata),
        usdc(STARTING_USDC) -
          BET.justOverYesCreator +
          justOverCreatorCut +
          winnerPayout(BET.justOverYesCreator, justOverYesPool, justOverNoPool) -
          BET.moonNoCreator +
          moonCreatorCut +
          creatorPayout
      );
      assert.equal(
        await tokenBal(yesWallet.ata),
        usdc(STARTING_USDC) - BET.justOverYesStacked * 2 + justOverYesPayout - BET.moonYesFade
      );
      assert.equal(
        await tokenBal(noWallet.ata),
        usdc(STARTING_USDC) - BET.justOverNoFade - BET.moonNoStacked + noPayout
      );
      assert.equal(
        await tokenBal(fade.ata),
        usdc(STARTING_USDC) - BET.justOverNoFade - BET.moonYesFade
      );

      const { marketVaultPda } = getMarketPdas(noMarketId);
      assert.equal(await tokenBal(marketVaultPda), 0);
    });
  });

  describe("rake authority", () => {
    it("set_rake rejects a split that does not include founder 50", async () => {
      try {
        await program.methods
          .setRake(500, 400, 100, 50)
          .accounts({
            owner: admin.publicKey,
            rake: rakePda,
            config: configPda,
            tokenMint,
            burnTreasury: burnTokenAccount,
            agentTreasury: agentTokenAccount,
          })
          .signers([admin])
          .rpc();
        assert.fail("should revert");
      } catch (e: unknown) {
        assert.include(String(e), "InvalidFee");
      }
    });

    it("resolver cannot set_rake", async () => {
      try {
        await program.methods
          .setRake(500, 300, 100, 50)
          .accounts({
            owner: resolver.publicKey,
            rake: rakePda,
            config: configPda,
            tokenMint,
            burnTreasury: burnTokenAccount,
            agentTreasury: agentTokenAccount,
          })
          .signers([resolver])
          .rpc();
        assert.fail("should revert");
      } catch (e: unknown) {
        assert.include(String(e), "InvalidRakeOwner");
      }
    });

    it("open pot keeps snapshotted bps after a later set_rake", async () => {
      const id = await createMarket(usdc(100), usdc(10), Math.floor(Date.now() / 1000) + 8);
      await placeBet(alice, aliceTokenAccount, id, true, usdc(100));
      await placeBet(bob, bobTokenAccount, id, false, usdc(100));

      await program.methods
        .setRake(600, 400, 100, 50)
        .accounts({
          owner: admin.publicKey,
          rake: rakePda,
          config: configPda,
          tokenMint,
          burnTreasury: burnTokenAccount,
          agentTreasury: agentTokenAccount,
        })
        .signers([admin])
        .rpc();

      const { marketPda } = getMarketPdas(id);
      await waitUntil(Math.floor(Date.now() / 1000) + 8);
      await resolveMarket(id, usdc(200), resolver);
      const market = await program.account.market.fetch(marketPda);
      assert.equal(market.rakeBps, DEFAULT_RAKE_BPS);
      assert.equal(market.burnBps, DEFAULT_BURN_BPS);
      assert.equal(market.rakeTotal.toNumber(), rakeAmount(usdc(100)));
    });

    it("two-step owner transfer; founder can rotate the wallet only", async () => {
      const nextOwner = Keypair.generate();
      const nextFounder = Keypair.generate();
      await airdrop(nextOwner);
      await airdrop(nextFounder);

      await program.methods
        .transferRakeOwner(nextOwner.publicKey)
        .accounts({ owner: admin.publicKey, rake: rakePda })
        .signers([admin])
        .rpc();

      await program.methods
        .acceptRakeOwner()
        .accounts({ pending: nextOwner.publicKey, rake: rakePda })
        .signers([nextOwner])
        .rpc();

      try {
        await program.methods
          .setRake(500, 300, 100, 50)
          .accounts({
            owner: admin.publicKey,
            rake: rakePda,
            config: configPda,
            tokenMint,
            burnTreasury: burnTokenAccount,
            agentTreasury: agentTokenAccount,
          })
          .signers([admin])
          .rpc();
        assert.fail("old owner should fail");
      } catch (e: unknown) {
        assert.include(String(e), "InvalidRakeOwner");
      }

      await program.methods
        .setRake(500, 300, 100, 50)
        .accounts({
          owner: nextOwner.publicKey,
          rake: rakePda,
          config: configPda,
          tokenMint,
          burnTreasury: burnTokenAccount,
          agentTreasury: agentTokenAccount,
        })
        .signers([nextOwner])
        .rpc();

      try {
        await program.methods
          .setFounder(nextFounder.publicKey)
          .accounts({ founder: admin.publicKey, rake: rakePda })
          .signers([admin])
          .rpc();
        assert.fail("admin is not founder");
      } catch (e: unknown) {
        assert.include(String(e), "InvalidFounder");
      }

      await program.methods
        .setFounder(nextFounder.publicKey)
        .accounts({ founder: founder.publicKey, rake: rakePda })
        .signers([founder])
        .rpc();

      const rake = await program.account.rake.fetch(rakePda);
      assert.equal(rake.owner.toBase58(), nextOwner.publicKey.toBase58());
      assert.equal(rake.founder.toBase58(), nextFounder.publicKey.toBase58());
      assert.equal(rake.rakeBps, 500);
    });
  });
});
