/**
 * CLI: node --import tsx src/run.ts <fund|run|report> [--generate] [--dry-run] [--once]
 *
 * fund   — generate missing agent keypairs (--generate), top up SOL + USDC.
 * run    — agent loops. Mainnet requires MAINNET_ACK=YES, even with --dry-run.
 * report — read-only reconciliation from chain + the decision log.
 */
import { liveApiKeys } from "@fomopred/fomoscan";
import { simConfig, requireMainnetAck } from "./env";
import { fundAgents } from "./fund";
import { runAgents } from "./loop";
import { report } from "./report";

const cmd = process.argv[2];

async function main(): Promise<void> {
  const config = simConfig();
  switch (cmd) {
    case "fund":
      requireMainnetAck(config);
      await fundAgents(config, { generate: process.argv.includes("--generate") });
      return;
    case "run": {
      requireMainnetAck(config);
      config.fomoscanKeys = liveApiKeys();
      if (config.fomoscanKeys.length === 0) {
        throw new Error("FOMOSCAN_API_KEY (or _3/_4) is required — agents read the same board the keeper settles from");
      }
      await runAgents(config);
      return;
    }
    case "report":
      await report(config);
      return;
    default:
      console.log("usage: run.ts <fund|run|report> [--generate] [--dry-run] [--once]");
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
