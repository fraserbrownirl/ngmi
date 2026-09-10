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

export type PumpPeriod = "daily" | "weekly" | "monthly";

export type PumpLeaderboardEntry = {
  rank: number;
  wallet: string;
  username: string | null;
  isVerified?: boolean | null;
  pnlSol?: number | null;
  pnlUsd: number | null;
  pnlPercent?: number | null;
  realizedPnlUsd?: number | null;
  unrealizedPnlUsd?: number | null;
};

export type PumpLeaderboard = {
  period: PumpPeriod;
  capturedAt?: number | null;
  traders: PumpLeaderboardEntry[];
};

export type FomoScanMe = {
  plan: string | null;
  scopes: string[];
  key: {
    prefix: string | null;
    name: string | null;
    environment: string | null;
  };
  entitlement: {
    monthlyUnits: number | null;
    ratePerMinute: number | null;
    unmetered: boolean;
  };
  usage: {
    period: string | null;
    /** Last ms of `usage.period` (UTC YYYY-MM). Unused monthly CU does not roll. */
    periodEndsAt: number | null;
    unitsUsed: number | null;
    unitsRemaining: number | null;
    additionalUnits: number | null;
  };
};

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** UTC billing bucket `YYYY-MM` → last millisecond of that month. */
export function periodEndsAt(period: string | null): number | null {
  if (!period || !/^\d{4}-\d{2}$/.test(period)) return null;
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  if (month < 1 || month > 12) return null;
  return Date.UTC(year, month, 1) - 1;
}

export function normalizeMe(raw: Record<string, unknown>): FomoScanMe {
  const entitlement = (raw.entitlement ?? {}) as Record<string, unknown>;
  const usage = (raw.usage ?? {}) as Record<string, unknown>;
  const key = (raw.key ?? {}) as Record<string, unknown>;
  const period = strOrNull(usage.period);
  return {
    plan: strOrNull(raw.plan),
    scopes: Array.isArray(raw.scopes)
      ? raw.scopes.filter((s): s is string => typeof s === "string")
      : [],
    key: {
      prefix: strOrNull(key.prefix),
      name: strOrNull(key.name),
      environment: strOrNull(key.environment),
    },
    entitlement: {
      monthlyUnits: numOrNull(entitlement.monthlyUnits),
      ratePerMinute: numOrNull(entitlement.ratePerMinute),
      unmetered: entitlement.unmetered === true,
    },
    usage: {
      period,
      periodEndsAt: periodEndsAt(period),
      unitsUsed: numOrNull(usage.unitsUsed),
      unitsRemaining: numOrNull(usage.unitsRemaining),
      additionalUnits: numOrNull(usage.additionalUnits),
    },
  };
}

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

/** Optional third live key (paid board). Never required. */
export function extraApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.FOMOSCAN_API_KEY_3?.trim();
  return key || null;
}

/** Optional fourth live key (paid board). Tried before key 3. Never required. */
export function extra4ApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.FOMOSCAN_API_KEY_4?.trim();
  return key || null;
}

/**
 * Live board keys, newest paid first. Spare (`FOMOSCAN_API_KEY_2`) is not
 * included — that key is a one-shot seed only.
 */
export function liveApiKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [env.FOMOSCAN_API_KEY_4, env.FOMOSCAN_API_KEY_3, env.FOMOSCAN_API_KEY]) {
    const key = raw?.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
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
      return normalizeMe(await request<Record<string, unknown>>("/v2/me"));
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

    /** Same 250 CU board pull as `tradersBoard`. Not a per-trader endpoint. */
    async pnlForId(id: string, atMs?: number): Promise<LeaderboardEntry | null> {
      const board = await this.tradersBoard(atMs);
      return board.traders.find((t) => t.id === id) ?? null;
    },

    /** pump.fun top 100, realized+unrealized. 250 CU. No `all` window. */
    async pumpTradersBoard(period: PumpPeriod = "weekly", atMs?: number): Promise<PumpLeaderboard> {
      const q = new URLSearchParams({ period });
      if (atMs !== undefined) q.set("at", String(atMs));
      const raw = await request<Record<string, unknown>>(`/v2/pump/leaderboard/traders?${q}`);
      return normalizePumpBoard(raw, period);
    },
  };
}

export function normalizePumpBoard(
  raw: Record<string, unknown>,
  fallback: PumpPeriod = "weekly",
): PumpLeaderboard {
  const period = raw.period;
  const entries = (raw.entries ?? raw.traders ?? []) as Record<string, unknown>[];
  return {
    period: period === "daily" || period === "weekly" || period === "monthly" ? period : fallback,
    capturedAt: numOrNull(raw.capturedAt),
    traders: entries
      .map((row, i) => ({
        rank: typeof row.rank === "number" ? row.rank : i + 1,
        wallet: typeof row.wallet === "string" ? row.wallet : "",
        username: strOrNull(row.username),
        isVerified: typeof row.isVerified === "boolean" ? row.isVerified : null,
        pnlSol: numOrNull(row.pnlSol),
        pnlUsd: numOrNull(row.pnlUsd),
        pnlPercent: numOrNull(row.pnlPercent),
        realizedPnlUsd: numOrNull(row.realizedPnlUsd),
        unrealizedPnlUsd: numOrNull(row.unrealizedPnlUsd),
      }))
      .filter((t) => t.wallet.length > 0),
  };
}

/**
 * One board row, validated. Rows without a string id or with a non-finite
 * pnl are dropped — a single poisoned row must not abort downstream settle
 * math (`usdToMicro` throws on non-finite input).
 */
function normalizeEntry(row: unknown, i: number): LeaderboardEntry | null {
  const r = row as Record<string, unknown>;
  const id = strOrNull(r.id);
  const pnl = numOrNull(r.pnl);
  if (!id || pnl == null) return null;
  return {
    rank: numOrNull(r.rank) ?? i + 1,
    id,
    handle: typeof r.handle === "string" ? r.handle : "",
    label: typeof r.label === "string" ? r.label : undefined,
    avatarUrl: typeof r.avatarUrl === "string" ? r.avatarUrl : undefined,
    pnl,
    volume: numOrNull(r.volume) ?? 0,
    followers: numOrNull(r.followers) ?? undefined,
    numTrades: numOrNull(r.numTrades) ?? 0,
  };
}

export function normalizeBoard(raw: Leaderboard | LeaderboardEntry[] | Record<string, unknown>): Leaderboard {
  const obj = (Array.isArray(raw) ? { traders: raw } : raw) as Record<string, unknown>;
  const rows = obj.traders ?? obj.entries ?? obj.data ?? [];
  const traders = (Array.isArray(rows) ? rows : [])
    .map((row, i) => normalizeEntry(row, i))
    .filter((t): t is LeaderboardEntry => t != null);
  return {
    window: typeof obj.window === "string" ? obj.window : "all",
    capturedAt: numOrNull(obj.capturedAt) ?? undefined,
    traders,
  };
}

export type FomoScan = ReturnType<typeof createFomoScan>;
