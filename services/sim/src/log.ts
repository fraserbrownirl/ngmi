import * as fs from "fs";
import * as path from "path";

/** One line per evaluated market per wake — the agents' reasoning trail. */
export type DecisionEntry = {
  ts: string;
  agent: string;
  cluster: string;
  marketId: number;
  action: "bet" | "abstain" | "claim";
  reason?: string;
  side?: "yes" | "no";
  amountUsdc?: number;
  pYes?: number;
  breakeven?: number;
  edge?: number;
  rationale?: string;
  payoutUsdc?: number;
  /** Tx signature; null in dry-run. */
  sig?: string | null;
  dryRun: boolean;
};

export class DecisionLog {
  private readonly file: string;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, "decisions.jsonl");
  }

  append(entry: DecisionEntry): void {
    fs.appendFileSync(this.file, JSON.stringify(entry) + "\n");
  }

  readAll(): DecisionEntry[] {
    if (!fs.existsSync(this.file)) return [];
    return fs
      .readFileSync(this.file, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as DecisionEntry);
  }

  /**
   * Rolling-24h spend per agent, reconstructed from the log so restarts
   * don't reset the cap. Only confirmed (non-dry-run) bets count.
   */
  spentLast24h(agent: string, nowMs = Date.now()): number {
    const since = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
    return this.readAll()
      .filter(
        (e) =>
          e.agent === agent &&
          e.action === "bet" &&
          !e.dryRun &&
          e.sig != null &&
          e.ts >= since,
      )
      .reduce((sum, e) => sum + (e.amountUsdc ?? 0), 0);
  }
}
