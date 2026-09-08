/**
 * Runs the improved four-wallet plan on the cluster the web app reads
 * (devnet — the UI test network) so pots, resolution, and claims show up.
 *
 *   A  @change     just $1 over live PnL — YES after a $12 tick
 *   B  @PoorGoat_  $25M moon              — NO after a +$40k print
 *
 * Requires pnpm dev and ~/.config/solana/id.json as admin/resolver.
 * Run after `anchor test` is green: pnpm seed:scenarios
 */
import { assert } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  address,
  createClient,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  generateKeyPairSigner,
  type Address,
  type TransactionSigner,
} from "@solana/kit";
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
  fetchRake,
  findMarketPda,
  findMarketVaultPda,
  findRakePda,
  getClaimWinningsInstructionAsync,
  getCreateMarketInstructionAsync,
  getPlaceBetInstructionAsync,
  getResolveMarketInstructionAsync,
  Outcome,
} from "@fomopred/fomo-pnl-client";
import { fomoUserIdToBytes, sendWithRetry } from "@fomopred/shared";
import {
  BET,
  justOverMarks,
  justOverNoPool,
  justOverYesPool,
  moonMarks,
  moonNoPool,
  moonYesPool,
  winnerPayout,
} from "./four-wallet-plan";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const WINDOW_SECS = 240;

type Trader = { id: string; handle: string; pnl: number; label?: string };
type KitClient = Awaited<ReturnType<typeof kit>>;

const api = {
  async get(route: string) {
    const res = await fetch(`${APP}${route}`);
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function kit(user: TransactionSigner) {
  return createClient().use(signer(user)).use(solanaRpc({ rpcUrl: RPC_URL }));
}

async function send(client: KitClient, ixs: Parameters<KitClient["sendTransaction"]>[0]) {
  return sendWithRetry(() => client.sendTransaction(ixs));
}

async function faucet(owner: Address) {
  const { status, body } = await api.post("/api/faucet", { address: owner });
  assert.equal(status, 200, `faucet ${owner}: ${JSON.stringify(body)}`);
}

describe("four-wallet plan on the UI cluster", () => {
  it("create → bet → resolve YES/NO → claim, visible on /api/markets", async () => {
    const ping = await fetch(`${APP}/api/config`).catch(() => null);
    assert.isOk(ping, `web app not reachable at ${APP} — start it with: pnpm dev`);

    const raw = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), ".config", "solana", "id.json"), "utf8"),
    ) as number[];
    const admin = await createKeyPairSignerFromBytes(new Uint8Array(raw));
    const yesWallet = await generateKeyPairSigner();
    const noWallet = await generateKeyPairSigner();
    const fade = await generateKeyPairSigner();

    const adminClient = await kit(admin);
    const yesClient = await kit(yesWallet);
    const noClient = await kit(noWallet);
    const fadeClient = await kit(fade);

    await send(adminClient, [
      getTransferSolInstruction({ source: admin, destination: yesWallet.address, amount: 50_000_000n }),
      getTransferSolInstruction({ source: admin, destination: noWallet.address, amount: 50_000_000n }),
      getTransferSolInstruction({ source: admin, destination: fade.address, amount: 50_000_000n }),
    ]);
    await sleep(2000);

    const { body: cfg } = await api.get("/api/config");
    assert.isString(cfg.tokenMint, JSON.stringify(cfg));
    const mint = address(cfg.tokenMint);
    const feeRecipientAta = address(cfg.feeRecipientAta);
    const rpc = createSolanaRpc(RPC_URL);

    await faucet(admin.address);
    await faucet(yesWallet.address);
    await faucet(noWallet.address);
    await faucet(fade.address);

    const ataOf = async (owner: Address) => {
      const [dest] = await findAssociatedTokenPda({
        owner,
        mint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });
      return dest;
    };
    const adminAta = await ataOf(admin.address);
    const yesAta = await ataOf(yesWallet.address);
    const noAta = await ataOf(noWallet.address);
    const fadeAta = await ataOf(fade.address);

    const bal = async (ata: Address) => Number((await fetchToken(rpc, ata)).data.amount);

    const { body: board } = await api.get("/api/board");
    const traders = (board.traders ?? []) as Trader[];
    const change = traders.find((t) => t.handle === "change");
    const goat = traders.find((t) => t.handle === "PoorGoat_");
    assert.isOk(change, "board missing @change");
    assert.isOk(goat, "board missing @PoorGoat_");
    await api.post("/api/traders", { id: change!.id, handle: change!.handle, name: change!.label ?? null });
    await api.post("/api/traders", { id: goat!.id, handle: goat!.handle, name: goat!.label ?? null });

    const JUST_OVER = justOverMarks(change!.pnl);
    const MOON = moonMarks(goat!.pnl);
    const deadline = Math.floor(Date.now() / 1000) + WINDOW_SECS;

    const create = async (trader: Trader, thresholdUsd: number, startPnlUsd: number) => {
      const { body: latest } = await api.get("/api/config");
      const marketId = BigInt(latest.marketCounter) + 1n;
      const [market] = await findMarketPda({ marketId });
      const [marketVault] = await findMarketVaultPda({ marketId });
      const ix = await getCreateMarketInstructionAsync({
        creator: admin,
        market,
        marketVault,
        tokenMint: mint,
        creatorTokenAccount: adminAta,
        feeRecipientTokenAccount: feeRecipientAta,
        fomoUserId: fomoUserIdToBytes(trader.id),
        thresholdUsd: BigInt(thresholdUsd),
        resolutionTime: BigInt(deadline),
        startPnlUsd: BigInt(startPnlUsd),
        feeAmount: 0n,
        settleKind: 0,
      });
      const createAta = await getCreateAssociatedTokenIdempotentInstructionAsync({
        payer: admin,
        ata: adminAta,
        owner: admin.address,
        mint,
      });
      try {
        await send(adminClient, [createAta, ix]);
      } catch (e) {
        const { body: after } = await api.get("/api/markets");
        const appeared = (after ?? []).find((m: { id: string }) => m.id === marketId.toString());
        if (!appeared) {
          const err = e as { cause?: unknown; message?: string };
          console.error("create failed", {
            marketId: marketId.toString(),
            trader: trader.handle,
            thresholdUsd,
            startPnlUsd,
            message: err.message,
            cause: err.cause,
          });
          throw e;
        }
      }
      await sleep(2000);
      return marketId;
    };

    const bet = async (
      user: TransactionSigner,
      client: KitClient,
      userAta: Address,
      marketId: bigint,
      yes: boolean,
      amount: number,
    ) => {
      const createAta = await getCreateAssociatedTokenIdempotentInstructionAsync({
        payer: user,
        ata: userAta,
        owner: user.address,
        mint,
      });
      const ix = await getPlaceBetInstructionAsync({
        bettor: user,
        bettorTokenAccount: userAta,
        marketId,
        outcome: yes ? Outcome.Yes : Outcome.No,
        amount: BigInt(amount),
      });
      await send(client, [createAta, ix]);
      await sleep(1500);
    };

    const resolve = async (marketId: bigint, endPnl: number) => {
      const [rakePda] = await findRakePda();
      const rake = await fetchRake(rpc, rakePda);
      const [founderToken] = await findAssociatedTokenPda({
        owner: rake.data.founder,
        mint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });
      const ix = await getResolveMarketInstructionAsync({
        resolver: admin,
        marketId,
        endPnlUsd: BigInt(endPnl),
        capturedAt: BigInt(Math.floor(Date.now() / 1000)),
        tokenMint: mint,
        founderToken,
        burnToken: rake.data.burnTreasury,
        agentToken: rake.data.agentTreasury,
        creatorToken: adminAta,
      });
      await send(adminClient, [ix]);
      await sleep(1500);
    };

    const claim = async (user: TransactionSigner, client: KitClient, userAta: Address, marketId: bigint) => {
      const ix = await getClaimWinningsInstructionAsync({
        user,
        userTokenAccount: userAta,
        marketId,
      });
      await send(client, [ix]);
      await sleep(1500);
    };

    const yesMarketId = await create(change!, JUST_OVER.threshold, JUST_OVER.startPnl);
    await bet(admin, adminClient, adminAta, yesMarketId, true, BET.justOverYesCreator);
    await bet(yesWallet, yesClient, yesAta, yesMarketId, true, BET.justOverYesStacked);
    await bet(yesWallet, yesClient, yesAta, yesMarketId, true, BET.justOverYesStacked);
    await bet(noWallet, noClient, noAta, yesMarketId, false, BET.justOverNoFade);
    await bet(fade, fadeClient, fadeAta, yesMarketId, false, BET.justOverNoFade);

    const noMarketId = await create(goat!, MOON.threshold, MOON.startPnl);
    await bet(admin, adminClient, adminAta, noMarketId, false, BET.moonNoCreator);
    await bet(noWallet, noClient, noAta, noMarketId, false, BET.moonNoStacked);
    await bet(yesWallet, yesClient, yesAta, noMarketId, true, BET.moonYesFade);
    await bet(fade, fadeClient, fadeAta, noMarketId, true, BET.moonYesFade);

    const live = ((await api.get("/api/markets")).body ?? []) as { id: string; state: string }[];
    assert.equal(live.find((m) => m.id === yesMarketId.toString())?.state, "active");
    assert.equal(live.find((m) => m.id === noMarketId.toString())?.state, "active");
    console.log(`open  /markets/${yesMarketId}  just-over YES`);
    console.log(`open  /markets/${noMarketId}  moon NO`);

    const waitMs = deadline * 1000 - Date.now() + 2000;
    if (waitMs > 0) await sleep(waitMs);

    await resolve(yesMarketId, JUST_OVER.endPnl);
    await resolve(noMarketId, MOON.endPnl);

    const adminBefore = await bal(adminAta);
    const yesBefore = await bal(yesAta);
    const noBefore = await bal(noAta);
    const fadeBefore = await bal(fadeAta);

    await claim(admin, adminClient, adminAta, yesMarketId);
    await claim(yesWallet, yesClient, yesAta, yesMarketId);
    await claim(noWallet, noClient, noAta, yesMarketId);
    await claim(fade, fadeClient, fadeAta, yesMarketId);
    await claim(admin, adminClient, adminAta, noMarketId);
    await claim(yesWallet, yesClient, yesAta, noMarketId);
    await claim(noWallet, noClient, noAta, noMarketId);
    await claim(fade, fadeClient, fadeAta, noMarketId);

    assert.equal((await bal(adminAta)) - adminBefore, winnerPayout(BET.justOverYesCreator, justOverYesPool, justOverNoPool) + winnerPayout(BET.moonNoCreator, moonNoPool, moonYesPool));
    assert.equal((await bal(yesAta)) - yesBefore, winnerPayout(BET.justOverYesStacked * 2, justOverYesPool, justOverNoPool));
    assert.equal((await bal(noAta)) - noBefore, winnerPayout(BET.moonNoStacked, moonNoPool, moonYesPool));
    assert.equal((await bal(fadeAta)) - fadeBefore, 0);

    const { status, body: settled } = await api.get("/api/markets");
    assert.equal(status, 200);
    const justOverRow = settled.find((m: { id: string }) => m.id === yesMarketId.toString());
    const moonRow = settled.find((m: { id: string }) => m.id === noMarketId.toString());
    assert.equal(justOverRow?.state, "resolved");
    assert.equal(justOverRow?.winningOutcome, "yes");
    assert.equal(justOverRow?.handle, "change");
    assert.equal(moonRow?.state, "resolved");
    assert.equal(moonRow?.winningOutcome, "no");
    assert.equal(moonRow?.handle, "PoorGoat_");

    console.log(`resolved YES  /markets/${yesMarketId}`);
    console.log(`resolved NO   /markets/${noMarketId}`);
  });
});
