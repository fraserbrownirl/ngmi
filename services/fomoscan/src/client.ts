const BASE = "https://api.fomoscan.sh";

export type FomoUser = {
  id: string;
  handle: string;
  name?: string;
  solanaAddress: string | null;
  evmAddress: string | null;
};

export type LeaderboardEntry = {
  rank: number;
  id: string;
  handle: string;
  label?: string;
  avatarUrl?: string;
  pnl: number;
  volume: number;
  followers?: number;
  numTrades: number;
};

export type Leaderboard = {
  window: string;
  capturedAt?: number;
  traders: LeaderboardEntry[];
};

export class FomoScanError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "FomoScanError";
  }
}

export function requireApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.FOMOSCAN_API_KEY?.trim();
  if (!key) {
    throw new Error("FOMOSCAN_API_KEY is required");
  }
  return key;
}

/** Optional spare key. Never required. */
export function spareApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.FOMOSCAN_API_KEY_2?.trim();
  return key || null;
}

export function createFomoScan(apiKey = requireApiKey()) {
  async function request<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const retryable = res.status >= 500;
      throw new FomoScanError(`FomoScan ${res.status} ${path}`, res.status, retryable);
    }
    return (await res.json()) as T;
  }

  return {
    async me() {
      return request<Record<string, unknown>>("/v2/me");
    },

    async userByHandle(handle: string): Promise<FomoUser> {
      const h = handle.replace(/^@/, "");
      return request<FomoUser>(`/v2/user/handle/${encodeURIComponent(h)}`);
    },

    async userById(id: string): Promise<FomoUser> {
      return request<FomoUser>(`/v2/user/id/${encodeURIComponent(id)}`);
    },

    async tradersBoard(atMs?: number): Promise<Leaderboard> {
      const q = new URLSearchParams({ window: "all" });
      if (atMs !== undefined) q.set("at", String(atMs));
      const raw = await request<Leaderboard | LeaderboardEntry[]>(`/v2/leaderboard/traders?${q}`);
      return normalizeBoard(raw);
    },

    async pnlForId(id: string, atMs?: number): Promise<LeaderboardEntry | null> {
      const board = await this.tradersBoard(atMs);
      return board.traders.find((t) => t.id === id) ?? null;
    },
  };
}

export function normalizeBoard(raw: Leaderboard | LeaderboardEntry[] | Record<string, unknown>): Leaderboard {
  if (Array.isArray(raw)) {
    return { window: "all", traders: raw };
  }
  const obj = raw as Record<string, unknown>;
  const traders = (obj.traders ?? obj.entries ?? obj.data ?? []) as LeaderboardEntry[];
  return {
    window: (obj.window as string) ?? "all",
    capturedAt: obj.capturedAt as number | undefined,
    traders,
  };
}

export type FomoScan = ReturnType<typeof createFomoScan>;
