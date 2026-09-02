const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const JUPITER_SEARCH = "https://lite-api.jup.ag/tokens/v2/search";

export type ParsedHolding = {
  mint: string;
  amount: number;
  decimals: number;
};

type RpcTokenAccount = {
  account?: {
    data?: {
      parsed?: {
        info?: {
          mint?: string;
          tokenAmount?: { uiAmount?: number | null; decimals?: number };
        };
      };
    };
  };
};

export function parseParsedTokenAccounts(accounts: RpcTokenAccount[]): ParsedHolding[] {
  const out: ParsedHolding[] = [];
  for (const row of accounts) {
    const info = row.account?.data?.parsed?.info;
    const mint = info?.mint;
    const amt = info?.tokenAmount;
    if (!mint || !amt) continue;
    const decimals = amt.decimals ?? 0;
    const amount = amt.uiAmount ?? 0;
    if (decimals === 0) continue;
    if (!(amount > 0)) continue;
    out.push({ mint, amount, decimals });
  }
  return out;
}

async function rpc(url: string, method: string, params: unknown[]) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: { value?: RpcTokenAccount[] }; error?: { message?: string } };
  if (!res.ok || json.error) {
    throw new Error(`rpc ${method}: ${json.error?.message ?? res.status}`);
  }
  return json.result?.value ?? [];
}

export async function fetchWalletHoldings(rpcUrl: string, owner: string): Promise<ParsedHolding[]> {
  const params = (programId: string) => [
    owner,
    { programId },
    { encoding: "jsonParsed", commitment: "confirmed" },
  ];
  const [spl, t22] = await Promise.all([
    rpc(rpcUrl, "getTokenAccountsByOwner", params(TOKEN_PROGRAM)),
    rpc(rpcUrl, "getTokenAccountsByOwner", params(TOKEN_2022_PROGRAM)),
  ]);
  return parseParsedTokenAccounts([...spl, ...t22]);
}

export async function lookupSymbols(
  mints: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, string>> {
  const unique = [...new Set(mints)];
  const out = new Map<string, string>();
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const url = `${JUPITER_SEARCH}?query=${encodeURIComponent(batch.join(","))}`;
    const res = await fetchImpl(url);
    if (!res.ok) continue;
    const rows = (await res.json().catch(() => [])) as { id?: string; symbol?: string }[];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (row.id && row.symbol) out.set(row.id, row.symbol);
    }
  }
  return out;
}

export async function tickersForWallet(rpcUrl: string, owner: string): Promise<string[]> {
  const holdings = await fetchWalletHoldings(rpcUrl, owner);
  if (holdings.length === 0) return [];
  const symbols = await lookupSymbols(holdings.map((h) => h.mint));
  return holdings.map((h) => symbols.get(h.mint) ?? h.mint.slice(0, 4));
}
