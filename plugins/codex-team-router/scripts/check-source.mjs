#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));

const textChecks = [
  {
    name: "route fixtures",
    args: [join(scriptDir, "route-fixtures.mjs")]
  },
  {
    name: "repo hygiene",
    args: [join(scriptDir, "repo-hygiene.mjs")]
  },
  {
    name: "source-only doctor",
    args: [join(scriptDir, "doctor.mjs"), "--source-only"]
  }
];

const jsonChecks = [
  {
    name: "repo hygiene JSON report",
    args: [join(scriptDir, "repo-hygiene.mjs"), "--json"]
  },
  {
    name: "source-only doctor JSON report",
    args: [join(scriptDir, "doctor.mjs"), "--source-only", "--json"]
  }
];

function runTextCheck(check) {
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

function runJsonCheck(check) {
  console.log(`\n== ${check.name} ==`);
  const result = spawnSync(process.execPath, check.args, {
    encoding: "utf8",
    cwd: process.cwd(),
    env: process.env
  });

  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    console.error(`\nFAIL ${check.name}`);
    process.exit(result.status || 1);
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    console.error(result.stdout);
    console.error(`\nFAIL ${check.name}: invalid JSON (${error.message})`);
    process.exit(1);
  }

  const failCount = report?.summary?.fail_count;
  const warnCount = report?.summary?.warn_count || 0;
  const checkCount = report?.summary?.check_count;
  if (failCount !== 0) {
    console.error(result.stdout);
    console.error(`\nFAIL ${check.name}: report contains ${failCount} failure(s)`);
    process.exit(1);
  }

  console.log(`PASS ${check.name}: ${failCount} fail(s), ${warnCount} warning(s), ${checkCount} check(s).`);
}

for (const check of textChecks) {
  runTextCheck(check);
}

for (const check of jsonChecks) {
  runJsonCheck(check);
}

console.log("\nSource checks passed.");
