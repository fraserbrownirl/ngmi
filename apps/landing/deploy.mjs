#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const NGMI = "prj_RVPkHN5tGZFTCrte7DMZMMrkiMp0";
const linkPath = join(here, ".vercel/project.json");
if (!existsSync(linkPath)) {
  console.error("Link this folder to Vercel project ngmi first: vercel link --scope frsr --project ngmi --yes");
  process.exit(1);
}
const linked = JSON.parse(readFileSync(linkPath, "utf8"));
if (linked.projectId !== NGMI) {
  console.error("Refusing to deploy: splash must target project ngmi, not ngmi-stage.");
  console.error("linked", linked);
  process.exit(1);
}

const r = spawnSync(
  "npx",
  ["--yes", "vercel@latest", "deploy", "--prod", "--yes", "--scope", "frsr", "--cwd", here],
  { stdio: "inherit" },
);
process.exit(r.status ?? 1);
