#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));

const checks = [
  {
    name: "route fixtures",
    args: [join(scriptDir, "route-fixtures.mjs")]
  },
  {
    name: "source-only doctor",
    args: [join(scriptDir, "doctor.mjs"), "--source-only"]
  }
];

for (const check of checks) {
  console.log(`\n== ${check.name} ==`);
  const result = spawnSync(process.execPath, check.args, {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env
  });

  if (result.status !== 0) {
    console.error(`\nFAIL ${check.name}`);
    process.exit(result.status || 1);
  }
}

console.log("\nSource checks passed.");
