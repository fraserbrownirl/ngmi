/** X's hard cap. Compose never returns more than this. */
export const TWEET_MAX = 280;

export type AnnounceKind = "opened" | "yes" | "no";

export type AnnounceInput = {
  kind: AnnounceKind;
  handle: string;
  /** Display name. Opened tweets use this; handle is the fallback. */
  name?: string | null;
  thresholdUsd: number;
  tickers: string[];
  /** Live / start PnL. Used on opened tweets for the "% needed" line. */
  pnlUsd?: number;
};

/** X handle rules: 1–15 chars, letters/digits/underscore. Anything else is not a handle. */
export function handleTag(handle: string): string {
  const h = handle.replace(/^@/, "").trim();
  return /^[A-Za-z0-9_]{1,15}$/.test(h) ? `@${h}` : "@unknown";
}

/**
 * Display names are free text from the oracle or from POST bodies. Strip
 * control characters (newline injection breaks tweet structure) and `@`
 * (a name must not mint mentions), collapse whitespace, cap length.
 */
export function displayName(name: string | null | undefined, handle: string): string {
  const n = name
    ?.replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/@/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50);
  if (n) return n;
  const h = handle.replace(/^@/, "").trim();
  return /^[A-Za-z0-9_]{1,15}$/.test(h) ? h : "this trader";
}

/** Extra % of current PnL needed to hit the mark. Null when PnL is not positive. */
export function percentNeeded(pnlUsd: number, thresholdUsd: number): number | null {
  if (!(pnlUsd > 0)) return null;
  if (pnlUsd >= thresholdUsd) return 0;
  return ((thresholdUsd - pnlUsd) / pnlUsd) * 100;
}

export function formatPct(pct: number): string {
  if (pct <= 0) return "0%";
  if (pct >= 10) return `${Math.round(pct)}%`;
  const one = pct.toFixed(1).replace(/\.0$/, "");
  return `${one}%`;
}

/** Compact USD for a tweet mark. */
export function formatMarkUsd(usd: number): string {
  const n = Math.abs(usd);
  const sign = usd < 0 ? "-" : "";
  if (n >= 1_000_000) return `${sign}$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;
  if (n >= 10_000) {
    const k = n / 1_000;
    const digits = k >= 100 || Number.isInteger(k) ? 0 : 1;
    return `${sign}$${k.toFixed(digits)}k`;
  }
  return `${sign}$${Math.round(n).toLocaleString("en-US")}`;
}

export function tickerTag(raw: string): string | null {
  const sym = raw.replace(/^\$/, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!sym) return null;
  return `$${sym}`;
}

/** Unique $TICKER tags, alpha-sorted, that fit in `budget` chars (with a leading space each). */
export function fitTickers(tickers: string[], budget: number): string {
  const tags = [...new Set(tickers.map(tickerTag).filter((t): t is string => t != null))].sort(
    (a, b) => a.localeCompare(b),
  );
  if (tags.length === 0 || budget < 2) return "";
  const kept: string[] = [];
  let used = 0;
  for (let i = 0; i < tags.length; i++) {
    const rest = tags.length - i - 1;
    const piece = (kept.length === 0 ? "" : " ") + tags[i];
    const more = rest > 0 ? ` +${rest}` : "";
    if (used + piece.length + more.length <= budget) {
      kept.push(tags[i]);
      used += piece.length;
      continue;
    }
    const suffix = ` +${tags.length - kept.length}`;
    if (kept.length > 0 && used + suffix.length <= budget) return `${kept.join(" ")}${suffix}`;
    return kept.join(" ");
  }
  return kept.join(" ");
}

function headline(kind: AnnounceKind, who: string, mark: string): string {
  if (kind === "yes") return `YES — ${who} printed over ${mark}.`;
  return `NO — ${who} missed ${mark}.`;
}

function composeOpened(input: AnnounceInput): string {
  const who = displayName(input.name, input.handle);
  const mark = formatMarkUsd(input.thresholdUsd);
  const pnl = formatMarkUsd(input.pnlUsd ?? 0);
  const pct = percentNeeded(input.pnlUsd ?? 0, input.thresholdUsd);
  const prefix = `Is ${who} gonna make to ${mark} in 3 days or NGMI! Place your bets!! ${who} is currently holding `;
  const suffix =
    pct == null ? ` with a PNL of ${pnl}` : ` with a PNL of ${pnl} (${formatPct(pct)} needed to make it)`;
  const budget = TWEET_MAX - prefix.length - suffix.length;
  const tickers = fitTickers(input.tickers, budget) || "none listed";
  return `${prefix}${tickers}${suffix}`.slice(0, TWEET_MAX);
}

export function composeAnnounce(input: AnnounceInput): string {
  if (input.kind === "opened") return composeOpened(input);
  const who = handleTag(input.handle);
  const mark = formatMarkUsd(input.thresholdUsd);
  const head = headline(input.kind, who, mark);
  const holdingsLabel = "\n\nWallet now holds ";
  const budget = TWEET_MAX - head.length - holdingsLabel.length;
  const tickers = fitTickers(input.tickers, budget);
  const holdings = tickers ? `${holdingsLabel}${tickers}` : `${holdingsLabel}none listed`;
  return `${head}${holdings}`.slice(0, TWEET_MAX);
}

export type BetSide = "yes" | "no";

export type BetAnnounceInput = {
  handle: string;
  name?: string | null;
  thresholdUsd: number;
  side: BetSide;
  amountUsd: number;
  wallet?: string | null;
  yesPoolUsd: number;
  noPoolUsd: number;
};

export function shortWallet(address: string): string {
  // Base58 only — a wallet string must not carry whitespace or markup.
  const a = address.replace(/[^1-9A-HJ-NP-Za-km-z]/g, "");
  if (!a) return "unknown";
  if (a.length <= 8) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

export function betAnnounceKey(input: {
  signature?: string | null;
  marketId: string;
  wallet?: string | null;
  side: BetSide;
  amountUsd: number;
  nowMs?: number;
}): string {
  const sig = input.signature?.trim();
  if (sig) return sig;
  const wallet = input.wallet?.trim() || "unknown";
  const amt = Math.round(input.amountUsd * 1e6);
  const bucket = Math.floor((input.nowMs ?? Date.now()) / 5_000);
  return `${input.marketId}:${wallet}:${input.side}:${amt}:${bucket}`;
}

export function composeBet(input: BetAnnounceInput): string {
  const who = displayName(input.name, input.handle);
  const mark = formatMarkUsd(input.thresholdUsd);
  const stake = formatMarkUsd(input.amountUsd);
  const side = input.side === "yes" ? "YES" : "NO";
  const book = `YES ${formatMarkUsd(input.yesPoolUsd)} / NO ${formatMarkUsd(input.noPoolUsd)}`;
  const head = `BET ${stake} ${side} — ${who} to ${mark}`;
  const wallet = input.wallet?.trim() ? shortWallet(input.wallet) : "";
  const text = wallet ? `${head}\n${wallet} · ${book}` : `${head}\n${book}`;
  return text.slice(0, TWEET_MAX);
}
