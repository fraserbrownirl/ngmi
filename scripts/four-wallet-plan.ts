/** Shared four-wallet pot plan. Local `anchor test` and the cluster UI run use this. */
import { rakeAmount, winnerPayoutAfterRake } from "@fomopred/shared";

export const MICRO = 1_000_000;
export const usdc = (n: number) => n * MICRO;
export const microFromUsd = (usd: number) => Math.round(usd * MICRO);

export const CHANGE_ID = "2e955ffc-6fac-578a-93d8-3324605f6bed";
export const GOAT_ID = "df983a8b-5e5b-5e91-802f-1472e96f04c3";

/** Fixture book when FomoScan is not in the room (local validator). */
export const FALLBACK_START_USD = 2_591_276;
export const MOON_THRESHOLD_USD = 25_000_000;
export const JUST_OVER_GAP_USD = 1;
export const JUST_OVER_TICK_USD = 12;
export const MOON_TICK_USD = 40_000;

export const BET = {
  justOverYesCreator: usdc(200),
  justOverYesStacked: usdc(100),
  justOverNoFade: usdc(50),
  moonNoCreator: usdc(200),
  moonNoStacked: usdc(200),
  moonYesFade: usdc(50),
};

export const justOverYesPool = BET.justOverYesCreator + BET.justOverYesStacked * 2;
export const justOverNoPool = BET.justOverNoFade * 2;
export const moonYesPool = BET.moonYesFade * 2;
export const moonNoPool = BET.moonNoCreator + BET.moonNoStacked;

export function winnerPayout(userBet: number, winPool: number, losePool: number) {
  return winnerPayoutAfterRake(userBet, winPool, losePool, rakeAmount(losePool));
}

export function justOverMarks(startUsd: number) {
  const startPnl = microFromUsd(startUsd);
  return {
    startPnl,
    threshold: startPnl + usdc(JUST_OVER_GAP_USD),
    endPnl: startPnl + usdc(JUST_OVER_TICK_USD),
  };
}

export function moonMarks(startUsd: number) {
  const startPnl = microFromUsd(startUsd);
  return {
    startPnl,
    threshold: usdc(MOON_THRESHOLD_USD),
    endPnl: startPnl + usdc(MOON_TICK_USD),
  };
}
