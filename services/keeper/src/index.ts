import { isFirstPrint, isYes, usdToMicro, type ChainVenue } from "@fomopred/shared";

export {
  betAnnounceKey,
  composeAnnounce,
  composeBet,
  displayName,
  fitTickers,
  formatMarkUsd,
  formatPct,
  handleTag,
  percentNeeded,
  shortWallet,
  tickerTag,
  TWEET_MAX,
  type AnnounceInput,
  type AnnounceKind,
  type BetAnnounceInput,
  type BetSide,
} from "./tweet";
export {
  ensureTwitterApiLogin,
  isTwitterApiActive,
  postCtoTweet,
  twitterApiFromEnv,
  twitterApiNeedsLogin,
  type TwitterApiConfig,
} from "./twitterapi";
export {
  fetchWalletHoldings,
  lookupSymbols,
  parseParsedTokenAccounts,
  tickersForWallet,
  type ParsedHolding,
} from "./holdings";
export {
  buildAuthorizeUrl,
  exchangeCode,
  generatePkce,
  postTweet,
  refreshAccessToken,
  tokensFromGrant,
  tokensNeedRefresh,
  xAppFromEnv,
  xOAuthRedirectUri,
  X_SCOPES,
  type XAppConfig,
  type XOAuthTokens,
} from "./x";

export type MarketRecord = {
  id: string;
  chain: ChainVenue;
  fomoUserId: string;
  thresholdUsd: bigint;
  resolutionTime: number;
  /** Unix seconds. First-print ignores a board file from before the pot opened. */
  createdAt?: number;
  yesPool?: bigint;
  noPool?: bigint;
  settleKind?: number;
};

/** One FomoScan traders-board print. Settlement never fetches per pot. */
export type BoardPrint = {
  capturedAt?: number;
  /** Leftover file after a failed/skipped refresh. Charts may use it; first-print must not. */
  stale?: boolean;
  traders: { id: string; pnl: number }[];
};

/** One Map for every open pot on this print. */
export function indexBoard(board: BoardPrint | null): Map<string, number> | null {
  if (!board) return null;
  const byId = new Map<string, number>();
  for (const row of board.traders) byId.set(row.id, row.pnl);
  return byId;
}

export type SettleAction =
  | { kind: "report"; endPnlUsd: bigint; capturedAt: number; yes: boolean }
  | { kind: "cancel"; reason: "off_board" | "fomoscan_down" | "not_due" | "empty_book" };

export type ChainPoster = {
  report(marketId: string, endPnlUsd: bigint, capturedAt: number): Promise<void>;
  cancel(marketId: string): Promise<void>;
};

export function decideFromBoard(
  market: MarketRecord,
  board: BoardPrint | null,
  nowMs = Date.now(),
  byId: Map<string, number> | null = indexBoard(board),
): SettleAction {
  const due = nowMs >= market.resolutionTime * 1000;
  const observedAt = board?.capturedAt ?? nowMs;
  const openedMs = (market.createdAt ?? 0) * 1000;
  const pnl = byId?.get(market.fomoUserId);
  const onBoard = pnl != null;
  const overMark = onBoard && isYes(usdToMicro(pnl), market.thresholdUsd);
  const firstPrintHit =
    isFirstPrint(market.settleKind ?? 0) &&
    overMark &&
    board != null &&
    !board.stale &&
    observedAt >= openedMs;
  if (!due && !firstPrintHit) {
    return { kind: "cancel", reason: "not_due" };
  }
  if (due && observedAt < market.resolutionTime * 1000) {
    return { kind: "cancel", reason: "not_due" };
  }
  if (market.yesPool === 0n || market.noPool === 0n) {
    return { kind: "cancel", reason: "empty_book" };
  }
  if (!board) {
    return { kind: "cancel", reason: "fomoscan_down" };
  }
  if (!onBoard) {
    return due ? { kind: "cancel", reason: "off_board" } : { kind: "cancel", reason: "not_due" };
  }
  const endPnlUsd = usdToMicro(pnl);
  return {
    kind: "report",
    endPnlUsd,
    capturedAt: board.capturedAt ?? nowMs,
    yes: isYes(endPnlUsd, market.thresholdUsd),
  };
}

export async function settleFromBoard(
  poster: ChainPoster,
  market: MarketRecord,
  board: BoardPrint | null,
  nowMs = Date.now(),
  byId: Map<string, number> | null = indexBoard(board),
): Promise<SettleAction> {
  const action = decideFromBoard(market, board, nowMs, byId);
  if (action.kind === "report") {
    await poster.report(market.id, action.endPnlUsd, action.capturedAt);
  } else if (action.reason !== "not_due") {
    await poster.cancel(market.id);
  }
  return action;
}
