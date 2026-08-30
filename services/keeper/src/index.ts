import { isFirstPrint, isYes, usdToMicro, type ChainVenue } from "@fomopred/shared";

export type MarketRecord = {
  id: string;
  chain: ChainVenue;
  fomoUserId: string;
  thresholdUsd: bigint;
  resolutionTime: number;
  yesPool?: bigint;
  noPool?: bigint;
  settleKind?: number;
};

/** One FomoScan traders-board print. Settlement never fetches per pot. */
export type BoardPrint = {
  capturedAt?: number;
  traders: { id: string; pnl: number }[];
};

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
  nowMs = Date.now()
): SettleAction {
  const due = nowMs >= market.resolutionTime * 1000;
  const row = board?.traders.find((t) => t.id === market.fomoUserId);
  const hit = row != null && isYes(usdToMicro(row.pnl), market.thresholdUsd);
  const firstPrintHit = isFirstPrint(market.settleKind ?? 0) && hit;
  if (!due && !firstPrintHit) {
    return { kind: "cancel", reason: "not_due" };
  }
  if (market.yesPool === 0n || market.noPool === 0n) {
    return { kind: "cancel", reason: "empty_book" };
  }
  if (!board) {
    return { kind: "cancel", reason: "fomoscan_down" };
  }
  if (!row) {
    return due ? { kind: "cancel", reason: "off_board" } : { kind: "cancel", reason: "not_due" };
  }
  const endPnlUsd = usdToMicro(row.pnl);
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
  nowMs = Date.now()
): Promise<SettleAction> {
  const action = decideFromBoard(market, board, nowMs);
  if (action.kind === "report") {
    await poster.report(market.id, action.endPnlUsd, action.capturedAt);
  } else if (action.reason !== "not_due") {
    await poster.cancel(market.id);
  }
  return action;
}
