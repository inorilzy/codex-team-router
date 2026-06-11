#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(scriptDir, "..");
const templateDir = join(pluginRoot, "skills", "codex-team-router", "assets", "codex-agents");
const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");

function usage() {
  console.log(`Usage:
  node scripts/sync-agents.mjs [--project <dir> | --global | --target <dir>] [--write] [--force] [--role <name> ...] [--json]

Defaults:
  --project .      Target <project>/.codex/agents
  dry-run          Print actions without writing files

Examples:
  node scripts/sync-agents.mjs
  node scripts/sync-agents.mjs --write
  node scripts/sync-agents.mjs --global --write
  node scripts/sync-agents.mjs --target C:\\tmp\\agents --write --force
  node scripts/sync-agents.mjs --role planner --role reviewer --write
  node scripts/sync-agents.mjs --json
`);
}

function parseArgs(argv) {
  const options = {
    project: process.cwd(),
    target: null,
    global: false,
    write: false,
    force: false,
    roles: [],
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else if (arg === "--project") {
      options.project = argv[++index];
    } else if (arg === "--target") {
      options.target = argv[++index];
    } else if (arg === "--global") {
      options.global = true;
    } else if (arg === "--write") {
      options.write = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--role") {
      options.roles.push(argv[++index]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.target && options.global) {
    throw new Error("Use only one of --target or --global.");
  }

  return options;
}

function printJsonReport(options, destinationDir, plan, error = null) {
  const writes = plan.filter((item) => item.action === "copy" || item.action === "overwrite");
  const skippedDifferent = plan.filter((item) => item.action === "skip-different");
  const report = {
    tool: "sync-agents",
    schema_version: 1,
    mode: options.write ? "write" : "dry-run",
    target: destinationDir,
    summary: {
      fail_count: error ? 1 : 0,
      write_candidate_count: writes.length,
      skipped_different_count: skippedDifferent.length,
      template_count: plan.length
    },
    plan
  };

  if (error) {
    report.error = error.message;
  }

  console.log(JSON.stringify(report, null, 2));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function targetDir(options) {
  if (options.target) return resolve(options.target);
  if (options.global) return join(codexHome, "agents");
  return join(resolve(options.project), ".codex", "agents");
}

function templateNames(options) {
  const available = readdirSync(templateDir)
    .filter((name) => name.endsWith(".toml"))
    .sort();

  if (options.roles.length === 0) return available;

  const wanted = new Set(options.roles.map((role) => `${role.replace(/\.toml$/i, "")}.toml`));
  const missing = [...wanted].filter((name) => !available.includes(name));
  if (missing.length > 0) {
    throw new Error(`Unknown role template(s): ${missing.join(", ")}`);
  }
  return available.filter((name) => wanted.has(name));
}

function planSync(options) {
  const destinationDir = targetDir(options);
  return templateNames(options).map((name) => {
    const source = join(templateDir, name);
    const destination = join(destinationDir, name);
    if (!existsSync(destination)) {
      return { name, source, destination, action: "copy" };
    }
    if (sha256(source) === sha256(destination)) {
      return { name, source, destination, action: "skip-identical" };
    }
    return { name, source, destination, action: options.force ? "overwrite" : "skip-different" };
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(templateDir)) {
    throw new Error(`Template directory not found: ${templateDir}`);
  }

  const destinationDir = targetDir(options);
  const plan = planSync(options);
  const writes = plan.filter((item) => item.action === "copy" || item.action === "overwrite");
  const skippedDifferent = plan.filter((item) => item.action === "skip-different");

  if (options.json) {
    if (options.write && writes.length > 0) {
      mkdirSync(destinationDir, { recursive: true });
      for (const item of writes) {
        copyFileSync(item.source, item.destination);
      }
    }
    printJsonReport(options, destinationDir, plan);
    return;
  }

  console.log(`Codex Team Router agent template sync`);
  console.log(`Mode: ${options.write ? "write" : "dry-run"}`);
  console.log(`Target: ${destinationDir}`);
  console.log("");

  for (const item of plan) {
    console.log(`${item.action.padEnd(15)} ${item.name}`);
  }

  if (options.write && writes.length > 0) {
    mkdirSync(destinationDir, { recursive: true });
    for (const item of writes) {
      copyFileSync(item.source, item.destination);
    }
  }

  console.log("");
  console.log(`Summary: ${writes.length} write candidate(s), ${skippedDifferent.length} different existing file(s), ${plan.length} template(s).`);

  if (!options.write && writes.length > 0) {
    console.log("Dry-run only. Re-run with --write to copy files.");
  }
  if (skippedDifferent.length > 0 && !options.force) {
    console.log("Different existing files were skipped. Re-run with --force --write only if you intentionally want to overwrite them.");
  }

}

try {
  main();
} catch (error) {
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({
      tool: "sync-agents",
      schema_version: 1,
      summary: {
        fail_count: 1,
        write_candidate_count: 0,
        skipped_different_count: 0,
        template_count: 0
      },
      plan: [],
      error: error.message
    }, null, 2));
  } else {
    console.error(`FAIL ${error.message}`);
  }
  process.exit(1);
}
