import * as os from "os";
import * as path from "path";

/** Sim runtime configuration. All knobs are env-overridable; see .env.example. */
export type SimConfig = {
  cluster: "devnet" | "mainnet";
  rpcUrl: string;
  /** Agent keypair files, in agent order. Default: ~/.config/fomo/sim-agent-{1,2,3}.json */
  agentKeypairFiles: string[];
  /** FomoScan board keys, paid-first (from @fomopred/fomoscan liveApiKeys). */
  fomoscanKeys: string[];
  /** Per-bet hard cap, USDC. */
  maxBetUsdc: number;
  /** Per-agent rolling 24h spend cap, USDC. */
  dailySpendUsdc: number;
  /** Stop trading when an agent's USDC balance falls to this. */
  bankrollFloorUsdc: number;
  /** Stop trading when an agent's SOL balance falls below this (rent for positions). */
  solFloor: number;
  /** Wake interval jitter bounds, seconds. */
  wakeMinSec: number;
  wakeMaxSec: number;
  /** Required probability edge over the pool-implied breakeven. */
  edgeMargin: number;
  /** Gap ratio (k - p) / |k| below which NO bets are suppressed. */
  proximityGuard: number;
  minBetUsdc: number;
  /** Bankroll fraction range for sizing. */
  betFractionMin: number;
  betFractionMax: number;
  /** Per-market exposure cap per agent, USDC. */
  maxMarketExposureUsdc: number;
  /** Max deterministic per-agent probability offset (agents disagree). */
  convictionJitter: number;
  /** Agent name allowed to create markets (empty = creation disabled). */
  marketMaker: string;
  /** Mark = current board PnL * (1 + markup). Small so pots resolve soon. */
  markMarkupPct: number;
  /** Market lifetime, seconds (also the close-at-T fallback). */
  marketTtlSec: number;
  /** Only create when fewer than this many markets are active. */
  maxActiveMarkets: number;
  /** pnpm sim:fund defaults. */
  fundUsdc: number;
  fundSol: number;
  /** Decision log directory (gitignored). */
  dataDir: string;
  dryRun: boolean;
  once: boolean;
};

const num = (env: NodeJS.ProcessEnv, key: string, fallback: number): number => {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) {
    throw new Error(`${key}: expected a non-negative number, got "${raw}"`);
  }
  return v;
};

export function defaultAgentKeypairFiles(count = 3): string[] {
  return Array.from({ length: count }, (_, i) =>
    path.join(os.homedir(), ".config", "fomo", `sim-agent-${i + 1}.json`),
  );
}

export function simConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2),
): SimConfig {
  const cluster = env.CLUSTER === "mainnet" ? "mainnet" : "devnet";
  const rpcUrl =
    env.SOLANA_RPC_URL ??
    (cluster === "mainnet"
      ? env.HELIUS_API_KEY
        ? `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`
        : "https://api.mainnet-beta.solana.com"
      : "https://api.devnet.solana.com");
  const keypairs = env.SIM_AGENT_KEYPAIRS?.trim();
  return {
    cluster,
    rpcUrl,
    agentKeypairFiles: keypairs
      ? keypairs.split(",").map((p) => p.trim())
      : defaultAgentKeypairFiles(),
    fomoscanKeys: [], // filled by run.ts via liveApiKeys (kept pure for tests)
    maxBetUsdc: num(env, "SIM_MAX_BET_USDC", 5),
    dailySpendUsdc: num(env, "SIM_DAILY_SPEND_USDC", 8),
    bankrollFloorUsdc: num(env, "SIM_BANKROLL_FLOOR_USDC", 1),
    solFloor: num(env, "SIM_SOL_FLOOR", 0.01),
    wakeMinSec: num(env, "SIM_WAKE_MIN_SEC", 120),
    wakeMaxSec: num(env, "SIM_WAKE_MAX_SEC", 360),
    edgeMargin: num(env, "SIM_EDGE_MARGIN", 0.02),
    proximityGuard: num(env, "SIM_PROXIMITY_GUARD", 0.2),
    minBetUsdc: num(env, "SIM_MIN_BET_USDC", 0.25),
    betFractionMin: num(env, "SIM_BET_FRACTION_MIN", 0.04),
    betFractionMax: num(env, "SIM_BET_FRACTION_MAX", 0.12),
    maxMarketExposureUsdc: num(env, "SIM_MAX_MARKET_EXPOSURE_USDC", 2),
    convictionJitter: num(env, "SIM_CONVICTION_JITTER", 0.12),
    marketMaker: env.SIM_MARKET_MAKER?.trim() ?? "agent-1",
    markMarkupPct: num(env, "SIM_MARK_MARKUP_PCT", 0.03),
    marketTtlSec: num(env, "SIM_MARKET_TTL_SEC", 2700),
    maxActiveMarkets: num(env, "SIM_MAX_ACTIVE_MARKETS", 1),
    fundUsdc: num(env, "SIM_FUND_USDC", 10),
    fundSol: num(env, "SIM_FUND_SOL", 0.05),
    dataDir: env.SIM_DATA_DIR?.trim() || path.join(process.cwd(), "data"),
    dryRun: argv.includes("--dry-run"),
    once: argv.includes("--once"),
  };
}

/** Mainnet sends require an explicit acknowledgment, same gate as the smoke. */
export function requireMainnetAck(config: SimConfig): void {
  if (config.cluster === "mainnet" && process.env.MAINNET_ACK !== "YES") {
    throw new Error("mainnet sim requires MAINNET_ACK=YES");
  }
}
