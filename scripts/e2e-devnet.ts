/**
 * End-to-end user tests against the live devnet deployment.
 *
 * Drives the app through the exact code paths the browser uses:
 *   - reads:      GET /api/config, /api/board, /api/markets, /api/markets/[id], /history
 *   - faucet:     POST /api/faucet (server mints test USDC)
 *   - resolution: GET /api/keeper/tick (one board print, then settle due pots)
 *   - wallet txs: createMarket / placeBet / claimWinnings via the generated Kit client
 *
 * Requires the web dev server running (pnpm dev) and ~/.config/solana/id.json
 * to be the on-chain admin/resolver/mint authority. Run: pnpm test:e2e
 */
import { assert } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  address,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  generateKeyPairSigner,
  type Address,
  type TransactionSigner,
} from "@solana/kit";
import { createClient } from "@solana/kit";
import { signer } from "@solana/kit-plugin-signer";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  fetchToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  fetchConfig,
  fetchMarket,
  fetchMaybeUserPosition,
  findConfigPda,
  findMarketPda,
  findMarketVaultPda,
  findUserPositionPda,
  getClaimWinningsInstructionAsync,
  getCreateMarketInstructionAsync,
  getPlaceBetInstructionAsync,
  MarketState,
  Outcome,
} from "@fomopred/fomo-pnl-client";
import { fomoUserIdToBytes, usdToMicro } from "@fomopred/shared";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const ADMIN_HEADERS: Record<string, string> = process.env.ADMIN_TOKEN?.trim()
  ? { "x-admin-token": process.env.ADMIN_TOKEN.trim() }
  : {};
const MICRO = 1_000_000n;
const YES_BET = 100n * MICRO;
const NO_BET = 400n * MICRO;
const POT = YES_BET + NO_BET;
const FAUCET_AMOUNT = 1_000n * MICRO;

const api = {
  async get(route: string, headers?: Record<string, string>) {
    const res = await fetch(`${APP}${route}`, { headers });
    return { status: res.status, body: await res.json().catch(() => null) };
  },
  async post(route: string, payload?: unknown) {
    const res = await fetch(`${APP}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  },
};

async function expectTxFail(p: Promise<unknown>, label: string) {
  let failed = false;
  try {
    await p;
  } catch {
    failed = true;
  }
  assert.isTrue(failed, `${label} should have failed`);
}

describe("e2e devnet: full user journeys", () => {
  const rpc = createSolanaRpc(RPC_URL);
  let admin: TransactionSigner;
  let alice: TransactionSigner; // creator + YES bettor
  let bob: TransactionSigner; // NO bettor
  let aliceClient: any;
  let bobClient: any;
  let mint: Address;
  let feeRecipientAta: Address;
  let aliceAta: Address;
  let bobAta: Address;
  let trader: { id: string; handle: string; pnl: number };
  let marketId: bigint;
  let resolutionTime: number;

  const balance = async (ata: Address) => (await fetchToken(rpc, ata)).data.amount;

  before(async () => {
    const ping = await fetch(`${APP}/api/config`).catch(() => null);
    assert.isOk(ping, `web app not reachable at ${APP} — start it with: pnpm dev`);

    const raw = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), ".config", "solana", "id.json"), "utf8"),
    ) as number[];
    admin = await createKeyPairSignerFromBytes(new Uint8Array(raw));
    alice = await generateKeyPairSigner();
    bob = await generateKeyPairSigner();
    aliceClient = await createClient().use(signer(alice)).use(solanaRpc({ rpcUrl: RPC_URL }));
    bobClient = await createClient().use(signer(bob)).use(solanaRpc({ rpcUrl: RPC_URL }));

    const adminClient = await createClient().use(signer(admin)).use(solanaRpc({ rpcUrl: RPC_URL }));
    await adminClient.sendTransaction([
      getTransferSolInstruction({ source: admin, destination: alice.address, amount: 50_000_000n }),
      getTransferSolInstruction({ source: admin, destination: bob.address, amount: 50_000_000n }),
    ]);

    const [configPda] = await findConfigPda();
    const cfg = await fetchConfig(rpc, configPda);
    assert.equal(cfg.data.admin, admin.address, "local keypair is not the on-chain admin");
    mint = address(cfg.data.tokenMint);
    [aliceAta] = await findAssociatedTokenPda({
      owner: alice.address,
      mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    [bobAta] = await findAssociatedTokenPda({
      owner: bob.address,
      mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
  });

  describe("visitor journey: read-only APIs", () => {
    it("GET /api/config returns program config", async () => {
      const { status, body } = await api.get("/api/config");
      assert.equal(status, 200);
      assert.isString(body.tokenMint);
      assert.isString(body.feeRecipientAta);
      assert.isString(body.marketCounter);
      feeRecipientAta = address(body.feeRecipientAta);
    });

    it("GET /api/board returns the traders board", async () => {
      const { status, body } = await api.get("/api/board");
      assert.equal(status, 200);
      assert.isAtLeast(body.traders.length, 10);
      trader = body.traders[0];
      assert.isString(trader.id);
      assert.isNumber(trader.pnl);
    });

    it("GET /api/markets lists existing markets", async () => {
      const { status, body } = await api.get("/api/markets");
      assert.equal(status, 200);
      assert.isArray(body);
      assert.isAtLeast(body.length, 1);
    });

    it("GET /api/markets/1 returns the resolved smoke-test market", async () => {
      const { status, body } = await api.get("/api/markets/1");
      assert.equal(status, 200);
      assert.equal(body.market.state, "resolved");
      assert.equal(body.market.winningOutcome, "yes");
    });

    it("GET /api/markets/1/history returns empty points for the synthetic trader", async () => {
      const { status, body } = await api.get("/api/markets/1/history");
      assert.equal(status, 200);
      assert.deepEqual(body.points, []);
      assert.equal(body.threshold, 100);
    });

    it("rejects malformed and unknown market ids", async () => {
      assert.equal((await api.get("/api/markets/abc")).status, 400);
      assert.equal((await api.get("/api/markets/999999")).status, 404);
    });

    it("redirects the poisoned ellipsis URL to the homepage", async () => {
      const res = await fetch(`${APP}/markets/1%E2%80%A6`, { redirect: "manual" });
      assert.equal(res.status, 307);
      assert.equal(new URL(res.headers.get("location")!, APP).pathname, "/");
    });
  });

  describe("creator journey: faucet → open pot with wallet-signed tx", () => {
    it("POST /api/faucet mints 1,000 test USDC to alice", async () => {
      const { status, body } = await api.post("/api/faucet", { address: alice.address });
      assert.equal(status, 200, JSON.stringify(body));
      assert.isString(body.signature);
      assert.equal(await balance(aliceAta), FAUCET_AMOUNT);
    });

    it("POST /api/faucet rejects a bad address", async () => {
      assert.equal((await api.post("/api/faucet", { address: "nope" })).status, 400);
    });

    it("alice creates a market on a real trader (Kit client path)", async () => {
      const { body: cfgBody } = await api.get("/api/config");
      marketId = BigInt(cfgBody.marketCounter) + 1n;
      resolutionTime = Math.floor(Date.now() / 1000) + 100;
      const thresholdUsd = Math.ceil(trader.pnl * 1.05);

      const [market] = await findMarketPda({ marketId });
      const [marketVault] = await findMarketVaultPda({ marketId });
      const createAta = await getCreateAssociatedTokenIdempotentInstructionAsync({
        payer: alice,
        ata: aliceAta,
        owner: alice.address,
        mint,
      });
      const ix = await getCreateMarketInstructionAsync({
        creator: alice,
        market,
        marketVault,
        tokenMint: mint,
        creatorTokenAccount: aliceAta,
        feeRecipientTokenAccount: feeRecipientAta,
        fomoUserId: fomoUserIdToBytes(trader.id),
        thresholdUsd: usdToMicro(thresholdUsd),
        resolutionTime: BigInt(resolutionTime),
        startPnlUsd: usdToMicro(trader.pnl),
        feeAmount: 0n,
        settleKind: 0,
      });
      await aliceClient.sendTransaction([createAta, ix]);

      const { status, body } = await api.get(`/api/markets/${marketId}`);
      assert.equal(status, 200);
      assert.equal(body.market.fomoUserId, trader.id);
      assert.equal(body.market.state, "active");
      assert.equal(body.market.handle, trader.handle);
    });

    it("new market appears in the list and has real chart history", async () => {
      const list = await api.get("/api/markets");
      assert.isOk(list.body.find((m: any) => m.id === marketId.toString()));

      const { status, body } = await api.get(`/api/markets/${marketId}/history`);
      assert.equal(status, 200);
      assert.isAbove(body.points.length, 0, "real trader should have PnL history");
      assert.approximately(
        body.points[body.points.length - 1].pnl,
        trader.pnl,
        Math.abs(trader.pnl) * 0.2 + 1,
      );
    });
  });

  describe("bettor journey: both sides fund the pot", () => {
    it("faucet funds bob", async () => {
      const { status } = await api.post("/api/faucet", { address: bob.address });
      assert.equal(status, 200);
      assert.equal(await balance(bobAta), FAUCET_AMOUNT);
    });

    it("alice bets 100 YES; pools and position update", async () => {
      const ix = await getPlaceBetInstructionAsync({
        bettor: alice,
        bettorTokenAccount: aliceAta,
        marketId,
        outcome: Outcome.Yes,
        amount: YES_BET,
      });
      await aliceClient.sendTransaction([ix]);

      const [marketPda] = await findMarketPda({ marketId });
      const market = (await fetchMarket(rpc, marketPda)).data;
      assert.equal(market.yesPool, YES_BET);
      assert.equal(market.noPool, 0n);

      const [posPda] = await findUserPositionPda({ marketId, user: alice.address });
      const pos = await fetchMaybeUserPosition(rpc, posPda);
      if (!pos.exists) throw new Error("alice position missing");
      assert.equal(pos.data.yesBet, YES_BET);
      assert.equal(await balance(aliceAta), FAUCET_AMOUNT - YES_BET);
    });

    it("bob bets 400 NO", async () => {
      const ix = await getPlaceBetInstructionAsync({
        bettor: bob,
        bettorTokenAccount: bobAta,
        marketId,
        outcome: Outcome.No,
        amount: NO_BET,
      });
      await bobClient.sendTransaction([ix]);

      const [marketPda] = await findMarketPda({ marketId });
      const market = (await fetchMarket(rpc, marketPda)).data;
      assert.equal(market.noPool, NO_BET);
      assert.equal(await balance(bobAta), FAUCET_AMOUNT - NO_BET);
    });

    it("tick does not settle before the deadline", async () => {
      const { status, body } = await api.get(`/api/keeper/tick`, ADMIN_HEADERS);
      assert.equal(status, 200, JSON.stringify(body));
      const hit = (body.settled ?? []).find((row: { id: string }) => row.id === String(marketId));
      assert.isUndefined(hit);
    });
  });

  describe("resolution journey: keeper posts FomoScan PnL after T", () => {
    it("waits for the deadline", async () => {
      const waitMs = resolutionTime * 1000 - Date.now() + 3000;
      if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    });

    it("GET /api/keeper/tick settles from the board print", async () => {
      const { status, body } = await api.get(`/api/keeper/tick`, ADMIN_HEADERS);
      assert.equal(status, 200, JSON.stringify(body));
      const hit = (body.settled ?? []).find((row: { id: string }) => row.id === String(marketId));
      assert.ok(hit, JSON.stringify(body));
      assert.equal(hit.action.kind, "report");
      assert.isString(hit.signature);

      const [marketPda] = await findMarketPda({ marketId });
      const market = (await fetchMarket(rpc, marketPda)).data;
      assert.equal(market.state, MarketState.Resolved);
      assert.include([Outcome.Yes, Outcome.No], market.winningOutcome);
      assert.equal(market.endPnlUsd.toString(), hit.action.endPnlUsd);
    });

    it("tick is a no-op after settle", async () => {
      const { status, body } = await api.get(`/api/keeper/tick`, ADMIN_HEADERS);
      assert.equal(status, 200, JSON.stringify(body));
      const hit = (body.settled ?? []).find((row: { id: string }) => row.id === String(marketId));
      assert.isUndefined(hit);
    });

    it("bets are rejected after resolution", async () => {
      const ix = await getPlaceBetInstructionAsync({
        bettor: alice,
        bettorTokenAccount: aliceAta,
        marketId,
        outcome: Outcome.Yes,
        amount: MICRO,
      });
      await expectTxFail(aliceClient.sendTransaction([ix]), "bet on resolved market");
    });
  });

  describe("claim journey: winner sweeps the pot, loser gets nothing", () => {
    it("pays the winner the full 500 USDC pot and zeroes the loser", async () => {
      const [marketPda] = await findMarketPda({ marketId });
      const market = (await fetchMarket(rpc, marketPda)).data;
      const yesWon = market.winningOutcome === Outcome.Yes;
      const winnerKit = yesWon
        ? { user: alice, client: aliceClient, ata: aliceAta }
        : { user: bob, client: bobClient, ata: bobAta };
      const loserKit = yesWon
        ? { user: bob, client: bobClient, ata: bobAta }
        : { user: alice, client: aliceClient, ata: aliceAta };

      const before = await balance(winnerKit.ata);
      const claimIx = await getClaimWinningsInstructionAsync({
        user: winnerKit.user,
        userTokenAccount: winnerKit.ata,
        marketId,
      });
      await winnerKit.client.sendTransaction([claimIx]);
      assert.equal((await balance(winnerKit.ata)) - before, POT, "winner should sweep the pot");

      const loserBefore = await balance(loserKit.ata);
      const loserClaimIx = await getClaimWinningsInstructionAsync({
        user: loserKit.user,
        userTokenAccount: loserKit.ata,
        marketId,
      });
      await loserKit.client.sendTransaction([loserClaimIx]);
      assert.equal((await balance(loserKit.ata)) - loserBefore, 0n, "loser payout must be zero");
    });

    it("rejects a double claim", async () => {
      const ix = await getClaimWinningsInstructionAsync({
        user: alice,
        userTokenAccount: aliceAta,
        marketId,
      });
      await expectTxFail(aliceClient.sendTransaction([ix]), "double claim");
    });
  });
});
