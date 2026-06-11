#!/usr/bin/env node
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const jsonMode = process.argv.includes("--json");

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
    name: "route fixtures JSON report",
    args: [join(scriptDir, "route-fixtures.mjs"), "--json"]
  },
  {
    name: "repo hygiene JSON report",
    args: [join(scriptDir, "repo-hygiene.mjs"), "--json"]
  },
  {
    name: "source-only doctor JSON report",
    args: [join(scriptDir, "doctor.mjs"), "--source-only", "--json"]
  },
  {
    name: "sync agents JSON report",
    args: [join(scriptDir, "sync-agents.mjs"), "--json"]
  }
];
const syncAgentsWriteCheckName = "sync agents write JSON report";

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

function collectTextCheck(check) {
  const result = spawnSync(process.execPath, check.args, {
    encoding: "utf8",
    cwd: process.cwd(),
    env: process.env
  });

  return {
    name: check.name,
    kind: "text",
    ok: result.status === 0,
    exit_code: result.status || 0,
    output_tail: result.status === 0 ? "" : `${result.stdout || ""}${result.stderr || ""}`.slice(-4000)
  };
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

  if (report?.schema_version !== 1) {
    console.error(result.stdout);
    console.error(`\nFAIL ${check.name}: expected schema_version=1`);
    process.exit(1);
  }

  const failCount = report?.summary?.fail_count;
  const warnCount = report?.summary?.warn_count || 0;
  const itemCount = report?.summary?.check_count || report?.summary?.fixture_count || report?.summary?.template_count;
  if (failCount !== 0) {
    console.error(result.stdout);
    console.error(`\nFAIL ${check.name}: report contains ${failCount} failure(s)`);
    process.exit(1);
  }

  console.log(`PASS ${check.name}: ${failCount} fail(s), ${warnCount} warning(s), ${itemCount} item(s).`);
}

function collectJsonCheck(check) {
  const result = spawnSync(process.execPath, check.args, {
    encoding: "utf8",
    cwd: process.cwd(),
    env: process.env
  });

  const collected = {
    name: check.name,
    kind: "json",
    ok: false,
    exit_code: result.status || 0,
    report_summary: null,
    output_tail: ""
  };

  if (result.status !== 0) {
    collected.output_tail = `${result.stdout || ""}${result.stderr || ""}`.slice(-4000);
    return collected;
  }

  try {
    const report = JSON.parse(result.stdout);
    if (report?.schema_version !== 1) {
      collected.output_tail = `Expected schema_version=1\n${result.stdout}`.slice(-4000);
      return collected;
    }
    collected.report_summary = report?.summary || null;
    collected.ok = report?.summary?.fail_count === 0;
    if (!collected.ok) {
      collected.output_tail = result.stdout.slice(-4000);
    }
  } catch (error) {
    collected.output_tail = `Invalid JSON: ${error.message}\n${result.stdout}`.slice(-4000);
  }

  return collected;
}

function runSyncAgentsWriteCheck() {
  console.log(`\n== ${syncAgentsWriteCheckName} ==`);
  const tempDir = mkdtempSync(join(tmpdir(), "codex-team-router-sync-"));
  try {
    const result = spawnSync(process.execPath, [join(scriptDir, "sync-agents.mjs"), "--target", tempDir, "--write", "--json"], {
      encoding: "utf8",
      cwd: process.cwd(),
      env: process.env
    });

    if (result.status !== 0) {
      console.error(result.stderr || result.stdout);
      console.error(`\nFAIL ${syncAgentsWriteCheckName}`);
      process.exit(result.status || 1);
    }

    let report;
    try {
      report = JSON.parse(result.stdout);
    } catch (error) {
      console.error(result.stdout);
      console.error(`\nFAIL ${syncAgentsWriteCheckName}: invalid JSON (${error.message})`);
      process.exit(1);
    }

    const files = readdirSync(tempDir).filter((name) => name.endsWith(".toml"));
    const failCount = report?.summary?.fail_count;
    const templateCount = report?.summary?.template_count;
    if (report?.schema_version !== 1 || failCount !== 0 || templateCount !== 7 || files.length !== 7) {
      console.error(result.stdout);
      console.error(`\nFAIL ${syncAgentsWriteCheckName}: expected schema_version=1, fail_count=0, template_count=7, files=7`);
      process.exit(1);
    }

    console.log(`PASS ${syncAgentsWriteCheckName}: ${failCount} fail(s), ${templateCount} template(s), ${files.length} file(s).`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function collectSyncAgentsWriteCheck() {
  const tempDir = mkdtempSync(join(tmpdir(), "codex-team-router-sync-"));
  try {
    const result = spawnSync(process.execPath, [join(scriptDir, "sync-agents.mjs"), "--target", tempDir, "--write", "--json"], {
      encoding: "utf8",
      cwd: process.cwd(),
      env: process.env
    });
    const collected = {
      name: syncAgentsWriteCheckName,
      kind: "json",
      ok: false,
      exit_code: result.status || 0,
      report_summary: null,
      output_tail: ""
    };

    if (result.status !== 0) {
      collected.output_tail = `${result.stdout || ""}${result.stderr || ""}`.slice(-4000);
      return collected;
    }

    try {
      const report = JSON.parse(result.stdout);
      const files = readdirSync(tempDir).filter((name) => name.endsWith(".toml"));
      collected.report_summary = report?.summary || null;
      collected.ok =
        report?.schema_version === 1 &&
        report?.summary?.fail_count === 0 &&
        report?.summary?.template_count === 7 &&
        files.length === 7;
      if (!collected.ok) {
        collected.output_tail = `Expected schema_version=1, fail_count=0, template_count=7, files=7\n${result.stdout}`.slice(-4000);
      }
    } catch (error) {
      collected.output_tail = `Invalid JSON: ${error.message}\n${result.stdout}`.slice(-4000);
    }

    return collected;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function printJsonReport(checks) {
  const failCount = checks.filter((check) => !check.ok).length;
  const warnCount = checks.reduce((count, check) => count + (check.report_summary?.warn_count || 0), 0);
  console.log(JSON.stringify({
    tool: "check-source",
    schema_version: 1,
    summary: {
      fail_count: failCount,
      warn_count: warnCount,
      check_count: checks.length,
      text_check_count: textChecks.length,
      json_check_count: jsonChecks.length + 1
    },
    checks
  }, null, 2));

  if (failCount > 0) {
    process.exit(1);
  }
}

if (jsonMode) {
  const checks = [
    ...textChecks.map(collectTextCheck),
    ...jsonChecks.map(collectJsonCheck),
    collectSyncAgentsWriteCheck()
  ];
  printJsonReport(checks);
} else {
  for (const check of textChecks) {
    runTextCheck(check);
  }

  for (const check of jsonChecks) {
    runJsonCheck(check);
  }

  runSyncAgentsWriteCheck();

  console.log("\nSource checks passed.");
}
