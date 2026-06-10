#!/usr/bin/env node
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(scriptDir, "..");
const repoRoot = resolve(pluginRoot, "..", "..");
const marketplacePath = join(repoRoot, ".agents", "plugins", "marketplace.json");
const keepTemp = process.argv.includes("--keep-temp");

function run(command, args, options) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    timeout: 60000
  });

  const label = `${command} ${args.join(" ")}`;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit ${result.status}\n${result.stderr || result.stdout}`);
  }

  return result.stdout || "";
}

if (!existsSync(marketplacePath)) {
  console.error(`Marketplace file not found: ${marketplacePath}`);
  process.exit(1);
}

const tempHome = mkdtempSync(join(tmpdir(), "codex-team-router-install-"));
const env = { ...process.env, CODEX_HOME: tempHome };

try {
  console.log(`Temporary CODEX_HOME: ${tempHome}`);
  run("codex", ["plugin", "marketplace", "add", repoRoot], { env });
  run("codex", ["plugin", "add", "codex-team-router@codex-team-router"], { env });
  const listOutput = run("codex", ["plugin", "list"], { env });

  if (!/codex-team-router@codex-team-router\s+installed,\s*enabled/i.test(listOutput)) {
    throw new Error(`Installed plugin not found in codex plugin list:\n${listOutput}`);
  }

  console.log("PASS local marketplace install");
  console.log("PASS codex-team-router@codex-team-router installed, enabled");
} catch (error) {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
} finally {
  if (keepTemp) {
    console.log(`Kept temporary CODEX_HOME: ${tempHome}`);
  } else {
    rmSync(tempHome, { recursive: true, force: true });
  }
}
