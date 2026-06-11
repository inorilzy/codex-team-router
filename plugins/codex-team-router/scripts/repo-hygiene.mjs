#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = dirname(scriptDir);
const repoRoot = dirname(dirname(pluginRoot));
const pluginId = "codex-team-router";
const displayName = "Codex Team Router";
const jsonMode = process.argv.includes("--json");

const checks = [];

function record(ok, message, detail = "") {
  checks.push({ ok, message, detail });
  if (jsonMode) return;
  console.log(`${ok ? "PASS" : "FAIL"} ${message}`);
  if (detail) console.log(`    ${detail}`);
}

function readText(relativePath) {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function normalizedRepoPath(relativePath) {
  return normalize(join(repoRoot, relativePath));
}

function hasCjk(text) {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(text);
}

function checkReadmes() {
  const englishReadme = readText("README.md");
  const chineseReadme = readText("README.zh-CN.md");

  record(!hasCjk(englishReadme), "README.md is English-only");
  record(hasCjk(chineseReadme), "README.zh-CN.md contains Chinese content");
  record(englishReadme.includes("README.zh-CN.md"), "README.md links the Chinese README");
  record(chineseReadme.includes("README.md"), "README.zh-CN.md links the English README");
}

function checkMarketplace() {
  const marketplace = readJson(".agents/plugins/marketplace.json");
  const pluginEntry = marketplace.plugins?.find((plugin) => plugin.name === pluginId);

  record(marketplace.name === pluginId, "Marketplace name matches plugin id", marketplace.name);
  record(marketplace.interface?.displayName === displayName, "Marketplace display name matches", marketplace.interface?.displayName);
  record(Boolean(pluginEntry), "Marketplace exposes codex-team-router");
  if (!pluginEntry) return;

  record(pluginEntry.source?.source === "local", "Marketplace plugin source is local", pluginEntry.source?.source);
  record(pluginEntry.source?.path === "./plugins/codex-team-router", "Marketplace plugin path is stable", pluginEntry.source?.path);
  record(
    normalizedRepoPath(pluginEntry.source.path) === pluginRoot,
    "Marketplace plugin path resolves to this plugin root",
    pluginEntry.source.path
  );
  record(pluginEntry.policy?.installation === "AVAILABLE", "Marketplace plugin is available", pluginEntry.policy?.installation);
}

function checkPluginManifest() {
  const manifest = readJson("plugins/codex-team-router/.codex-plugin/plugin.json");

  record(manifest.name === pluginId, "Plugin manifest name matches plugin id", manifest.name);
  record(manifest.interface?.displayName === displayName, "Plugin manifest display name matches", manifest.interface?.displayName);
  record(manifest.skills === "./skills/", "Plugin manifest declares skills path", manifest.skills);
  record(manifest.hooks === "./hooks/hooks.json", "Plugin manifest declares hooks path", manifest.hooks);
}

function checkSkillIdentity() {
  const skill = readText("plugins/codex-team-router/skills/codex-team-router/SKILL.md");
  const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  record(Boolean(frontmatter), "Skill has frontmatter");
  if (!frontmatter) return;

  record(/^name:\s*codex-team-router\s*$/m.test(frontmatter[1]), "Skill name matches plugin id");
  record(/description:\s*".+"/m.test(frontmatter[1]), "Skill has a quoted description");
}

function checkRuntimeArtifacts() {
  const runtimeDirs = [
    ".codex/team-router",
    ".codex/subagent-squad"
  ];

  for (const runtimeDir of runtimeDirs) {
    record(!existsSync(join(repoRoot, runtimeDir)), `No runtime artifact directory: ${runtimeDir}`);
  }

  const gitignore = readText(".gitignore");
  record(gitignore.includes(".codex/"), ".gitignore excludes .codex runtime state");
  record(
    gitignore.includes("plugins/**/references/model-profiles.generated.json"),
    ".gitignore excludes generated model profile reports"
  );
}

function checkCiWorkflow() {
  const workflow = readText(".github/workflows/source-check.yml");

  record(workflow.includes("ubuntu-latest"), "Source Check runs on Ubuntu");
  record(workflow.includes("windows-latest"), "Source Check runs on Windows");
  record(workflow.includes("node-version: \"22\""), "Source Check pins Node.js 22");
}

try {
  if (!jsonMode) {
    console.log("Codex Team Router repo hygiene");
    console.log(`Repo root: ${repoRoot}`);
    console.log("");
  }

  checkReadmes();
  checkMarketplace();
  checkPluginManifest();
  checkSkillIdentity();
  checkRuntimeArtifacts();
  checkCiWorkflow();

  const failCount = checks.filter((check) => !check.ok).length;
  if (jsonMode) {
    console.log(JSON.stringify({
      tool: "repo-hygiene",
      repo_root: repoRoot,
      summary: {
        fail_count: failCount,
        check_count: checks.length
      },
      checks
    }, null, 2));
  } else {
    console.log("");
    console.log(`Summary: ${failCount} fail(s), ${checks.length} check(s).`);
  }

  if (failCount > 0) {
    process.exit(1);
  }
} catch (error) {
  if (jsonMode) {
    console.log(JSON.stringify({
      tool: "repo-hygiene",
      repo_root: repoRoot,
      summary: {
        fail_count: 1,
        check_count: checks.length
      },
      checks,
      error: error.message
    }, null, 2));
  } else {
    console.error(`FAIL ${error.message}`);
  }
  process.exit(1);
}
