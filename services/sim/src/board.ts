import { createFomoScan, FomoScanError } from "@fomopred/fomoscan";
import type { Leaderboard } from "@fomopred/fomoscan";
import type { BoardPrint } from "@fomopred/keeper";

/**
 * Shared board cache. One process runs every agent; a board pull costs 250 CU,
 * so all agents read the same print and we never refetch inside `ttlMs`.
 * Keeps the raw leaderboard too: market creation needs rank and handle, which
 * the keeper's BoardPrint shape drops.
 */
export class BoardCache {
  private cached: { at: number; board: BoardPrint; raw: Leaderboard } | null = null;

  constructor(
    private readonly keys: string[],
    private readonly ttlMs = 10 * 60 * 1000,
  ) {}

  /** Fresh print, or the cached one inside the TTL. Null when every key fails. */
  async get(force = false): Promise<BoardPrint | null> {
    return (await this.pull(force))?.board ?? null;
  }

  /** The raw leaderboard behind the print (rank/handle), same TTL rules. */
  async getRaw(force = false): Promise<Leaderboard | null> {
    return (await this.pull(force))?.raw ?? null;
  }

  private async pull(force: boolean): Promise<{ at: number; board: BoardPrint; raw: Leaderboard } | null> {
    if (!force && this.cached && Date.now() - this.cached.at < this.ttlMs) {
      return this.cached;
    }
    for (const key of this.keys) {
      try {
        const raw = await createFomoScan(key).tradersBoard();
        const board: BoardPrint = {
          capturedAt: raw.capturedAt,
          traders: raw.traders.map((t) => ({ id: t.id, pnl: t.pnl })),
        };
        this.cached = { at: Date.now(), board, raw };
        return this.cached;
      } catch (e) {
        if (e instanceof FomoScanError && e.retryable) continue;
        if (e instanceof FomoScanError && e.status === 429) continue;
        // Auth/quota failures on one key should not poison the others either.
        continue;
      }
    }
    return this.cached;
  }
}
