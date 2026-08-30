/** 1e6 = $1. Same scale as SPL USDC. */
export const USD_DECIMALS = 6;
export const WINDOW_ALL = "all" as const;

export type ChainVenue = "solana";

export type MarketParams = {
  fomoUserId: string;
  thresholdUsd: bigint;
  resolutionTime: number;
  startPnlUsd: bigint;
  window: typeof WINDOW_ALL;
};

export function usdToMicro(usd: number): bigint {
  return BigInt(Math.round(usd * 10 ** USD_DECIMALS));
}

export function microToUsd(micro: bigint): number {
  return Number(micro) / 10 ** USD_DECIMALS;
}

/** Strip UUID dashes → 16 bytes. */
export function fomoUserIdToBytes(id: string): Uint8Array {
  const hex = id.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error("invalid fomo user id");
  }
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToFomoUserId(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new Error("expected 16 bytes");
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isYes(endPnlUsd: bigint, thresholdUsd: bigint): boolean {
  return endPnlUsd >= thresholdUsd;
}

/** Stored in on-chain `Market.window`. FomoScan PnL window is always `all`. */
export const SETTLE_CLOSE_AT_T = 0;
export const SETTLE_FIRST_PRINT = 1;

export function isFirstPrint(settleKind: number): boolean {
  return settleKind === SETTLE_FIRST_PRINT;
}

export function canCreate(startPnlUsd: bigint, thresholdUsd: bigint): boolean {
  return startPnlUsd < thresholdUsd;
}

/** Open only on the current top 25. Rank is not on-chain — FomoScan is. */
export const CREATE_MAX_RANK = 25;
/** Same 3-day cap as programs/fomo-pnl MAX_RESOLUTION_WINDOW_SECS. */
export const MAX_RESOLUTION_SECS = 3 * 24 * 60 * 60;

export function canOpenByRank(rank: number): boolean {
  return Number.isInteger(rank) && rank >= 1 && rank <= CREATE_MAX_RANK;
}

export function canOpenByTime(
  resolutionTimeSec: number,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  return (
    Number.isFinite(resolutionTimeSec) &&
    resolutionTimeSec > nowSec &&
    resolutionTimeSec <= nowSec + MAX_RESOLUTION_SECS
  );
}

/** Same floor as programs/fomo-pnl FOUNDER_BPS. Not an instruction argument. */
export const FOUNDER_BPS = 50;
export const MAX_FEE_BPS = 1000;
export const DEFAULT_RAKE_BPS = 500;
export const DEFAULT_BURN_BPS = 300;
export const DEFAULT_AGENT_BPS = 100;
export const DEFAULT_CREATOR_BPS = 50;

export function validateRake(
  rakeBps: number,
  burnBps: number,
  agentBps: number,
  creatorBps: number,
): boolean {
  return (
    rakeBps >= FOUNDER_BPS &&
    rakeBps <= MAX_FEE_BPS &&
    FOUNDER_BPS + burnBps + agentBps + creatorBps === rakeBps
  );
}

export function bpsOf(amount: number, bps: number): number {
  return Math.floor((amount * bps) / 10_000);
}

/** Sum of the four floor slices. Matches on-chain `rake_total`. */
export function rakeAmount(
  losingPool: number,
  founderBps = FOUNDER_BPS,
  burnBps = DEFAULT_BURN_BPS,
  agentBps = DEFAULT_AGENT_BPS,
  creatorBps = DEFAULT_CREATOR_BPS,
): number {
  return (
    bpsOf(losingPool, founderBps) +
    bpsOf(losingPool, burnBps) +
    bpsOf(losingPool, agentBps) +
    bpsOf(losingPool, creatorBps)
  );
}

export function winnerPayoutAfterRake(
  userBet: number,
  winPool: number,
  losePool: number,
  rakeTotal: number,
): number {
  return userBet + Math.floor((userBet * (losePool - rakeTotal)) / winPool);
}
