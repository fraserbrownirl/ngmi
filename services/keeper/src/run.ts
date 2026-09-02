import {
  indexBoard,
  settleFromBoard,
  type BoardPrint,
  type ChainPoster,
  type MarketRecord,
} from "./index.ts";

/** One board print covers every due pot. Do not pull FomoScan per market. */
export async function runDue(
  markets: MarketRecord[],
  poster: ChainPoster,
  board: BoardPrint | null,
  nowMs = Date.now()
) {
  const byId = indexBoard(board);
  const results = [];
  for (const market of markets) {
    results.push(await settleFromBoard(poster, market, board, nowMs, byId));
  }
  return results;
}
