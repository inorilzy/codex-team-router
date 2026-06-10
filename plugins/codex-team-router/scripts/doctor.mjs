#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(scriptDir, "..");
const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
const configPath = join(codexHome, "config.toml");
const manifestPath = join(pluginRoot, ".codex-plugin", "plugin.json");
const hooksPath = join(pluginRoot, "hooks", "hooks.json");
const hookScriptPath = join(pluginRoot, "scripts", "codex-team-router-hook.mjs");
const modelScriptPath = join(pluginRoot, "scripts", "refresh-model-profiles.mjs");
const skillRoot = join(pluginRoot, "skills", "codex-team-router");
const assetHookScriptPath = join(skillRoot, "assets", "hooks", "codex-team-router-hook.mjs");
const assetModelScriptPath = join(skillRoot, "assets", "scripts", "refresh-model-profiles.mjs");
const agentTemplateDir = join(skillRoot, "assets", "codex-agents");
const globalAgentsDir = join(codexHome, "agents");
const pluginName = "codex-team-router";
const routeMarker = "CODEX_TEAM_ROUTER_ROUTE_REQUIRED";

const results = [];

function record(level, message, detail = "") {
  results.push({ level, message, detail });
  const suffix = detail ? `\n    ${detail}` : "";
  console.log(`${level.toUpperCase()}: ${message}${suffix}`);
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readJson(path) {
  try {
    return JSON.parse(readText(path));
  } catch (error) {
    record("fail", `Could not parse JSON: ${path}`, error.message);
    return null;
  }
}

function tomlSection(content, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`\\[${escaped}\\]([\\s\\S]*?)(?=\\r?\\n\\[|$)`));
  return match ? match[1] : "";
}

function tomlBool(section, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = section.match(new RegExp(`^\\s*${escaped}\\s*=\\s*(true|false)\\s*$`, "mi"));
  return match ? match[1] === "true" : null;
}

function runHook(event, payload) {
  return spawnSync(process.execPath, [hookScriptPath, event], {
    cwd: process.cwd(),
    input: `${JSON.stringify(payload)}\n`,
    encoding: "utf8",
    timeout: 30000
  });
}

function parseHookStdout(run, label) {
  if (run.status !== 0) {
    record("fail", `${label} exited non-zero`, run.stderr || run.stdout);
    return null;
  }

  try {
    return JSON.parse(run.stdout.trim() || "{}");
  } catch (error) {
    record("fail", `${label} did not emit valid JSON`, `${error.message}\n${run.stdout}`);
    return null;
  }
}

function hookContextText(output) {
  return output?.hookSpecificOutput?.additionalContext || "";
}

function checkFiles() {
  record(existsSync(manifestPath) ? "pass" : "fail", "Plugin manifest exists", manifestPath);
  record(existsSync(hooksPath) ? "pass" : "fail", "Plugin hooks.json exists", hooksPath);
  record(existsSync(hookScriptPath) ? "pass" : "fail", "Hook script exists", hookScriptPath);
  record(existsSync(assetHookScriptPath) ? "pass" : "fail", "Asset hook script exists", assetHookScriptPath);
  record(existsSync(assetModelScriptPath) ? "pass" : "fail", "Asset model refresh script exists", assetModelScriptPath);
  if (existsSync(hookScriptPath) && existsSync(assetHookScriptPath)) {
    record(sha256(hookScriptPath) === sha256(assetHookScriptPath) ? "pass" : "fail", "Root and asset hook helpers match");
  }
  if (existsSync(modelScriptPath) && existsSync(assetModelScriptPath)) {
    record(sha256(modelScriptPath) === sha256(assetModelScriptPath) ? "pass" : "fail", "Root and asset model refresh scripts match");
  }
}

function checkManifest() {
  const manifest = readJson(manifestPath);
  if (!manifest) return;

  record(manifest.name === "codex-team-router" ? "pass" : "fail", "Manifest name is codex-team-router");
  record(manifest.skills === "./skills/" ? "pass" : "warn", "Manifest declares skills path", String(manifest.skills || ""));
  record(manifest.hooks === "./hooks/hooks.json" ? "pass" : "fail", "Manifest explicitly declares hooks path", String(manifest.hooks || ""));
}

function checkHooksJson() {
  const hooks = readJson(hooksPath);
  if (!hooks?.hooks) return;

  const serialized = JSON.stringify(hooks, null, 2);
  record(!serialized.includes("commandWindows") ? "pass" : "warn", "hooks.json does not use commandWindows");
  record(!serialized.includes("%PLUGIN_ROOT%") ? "pass" : "warn", "hooks.json avoids cmd-style %PLUGIN_ROOT% expansion");
  record(serialized.includes("${PLUGIN_ROOT}/scripts/codex-team-router-hook.mjs") ? "pass" : "fail", "hooks.json uses direct Node command through PLUGIN_ROOT");

  const expectedEvents = ["UserPromptSubmit", "SessionStart", "PreToolUse", "SubagentStart", "SubagentStop", "Stop"];
  for (const event of expectedEvents) {
    record(Array.isArray(hooks.hooks[event]) ? "pass" : "fail", `Hook event configured: ${event}`);
  }
}

function checkConfig() {
  if (!existsSync(configPath)) {
    record("warn", "Codex config.toml not found", configPath);
    return;
  }

  const config = readText(configPath);
  const features = tomlSection(config, "features");
  const hooksEnabled = tomlBool(features, "hooks");
  const pluginHooksEnabled = tomlBool(features, "plugin_hooks");
  const pluginSectionMatch = config.match(/\[plugins\."codex-team-router@[^"]+"\]([\s\S]*?)(?=\r?\n\[|$)/);
  const pluginEnabled = pluginSectionMatch ? tomlBool(pluginSectionMatch[1], "enabled") : null;
  const pluginId = pluginSectionMatch?.[0]?.match(/\[plugins\."([^"]+)"\]/)?.[1] || "not found";
  const trustCount = (config.match(/codex-team-router@[^:\s"]+:hooks\/hooks\.json/g) || []).length;

  record(pluginEnabled === true ? "pass" : "warn", "Plugin is enabled in Codex config", `[plugins."${pluginId}"] enabled=${pluginEnabled}`);
  record(hooksEnabled === false ? "warn" : "pass", "Codex hooks feature is not explicitly disabled", hooksEnabled === null ? "not set; current Codex may default-enable it" : `hooks=${hooksEnabled}`);
  record(pluginHooksEnabled === false ? "warn" : "pass", "Codex plugin_hooks feature is not explicitly disabled", pluginHooksEnabled === null ? "not set; current Codex may default-enable it" : `plugin_hooks=${pluginHooksEnabled}`);
  record(trustCount > 0 ? "pass" : "warn", "Trusted hook entries exist for this plugin", `${trustCount} matching config entries`);
}

function checkPluginCli() {
  const run = spawnSync("codex", ["plugin", "list"], {
    encoding: "utf8",
    timeout: 30000
  });

  if (run.status !== 0) {
    record("warn", "Could not inspect plugin install state with codex plugin list", run.stderr || run.stdout);
    return;
  }

  const line = run.stdout
    .split(/\r?\n/)
    .find((item) => item.includes(`${pluginName}@`)) || "";
  record(
    /installed,\s*enabled/i.test(line) ? "pass" : "warn",
    "Plugin is installed and enabled according to codex plugin list",
    line || `${pluginName}@<marketplace> not found`
  );
}

function checkHookSimulation() {
  const promptRun = runHook("UserPromptSubmit", {
    hook_event_name: "UserPromptSubmit",
    prompt: "生成一个html 版本的飞机大战。"
  });

  const output = parseHookStdout(promptRun, "UserPromptSubmit hook simulation");
  if (!output) return;

  const context = hookContextText(output);
  record(context.includes(routeMarker) ? "pass" : "fail", "UserPromptSubmit injects route-required marker");
  record(context.includes("tool_search") ? "pass" : "fail", "UserPromptSubmit tells the model to discover multi_agent_v1 with tool_search");
  record(context.includes("suggested_execution=subagents") ? "pass" : "fail", "Complex prompt suggests subagents");
  record(!context.includes("implicit authorization") ? "pass" : "fail", "UserPromptSubmit does not claim hook marker authorizes spawning");
  record(context.includes("explicitly asks for subagents") ? "pass" : "fail", "UserPromptSubmit states explicit subagent authorization boundary");

  const reviewZhRun = runHook("UserPromptSubmit", {
    hook_event_name: "UserPromptSubmit",
    prompt: "检查一下这个插件的各个方面，看看还有没有改进和优化的空间。"
  });
  const reviewZhOutput = parseHookStdout(reviewZhRun, "Chinese review prompt hook simulation");
  if (!reviewZhOutput) return;
  const reviewZhContext = hookContextText(reviewZhOutput);
  record(reviewZhContext.includes(routeMarker) ? "pass" : "fail", "Chinese review prompt injects route-required marker");
  record(reviewZhContext.includes("intent=review") && reviewZhContext.includes("domain=infra") && reviewZhContext.includes("team_route=complex") ? "pass" : "fail", "Chinese review prompt routes as review/infra/complex");

  const reviewEnRun = runHook("UserPromptSubmit", {
    hook_event_name: "UserPromptSubmit",
    prompt: "review this plugin and find improvements"
  });
  const reviewEnOutput = parseHookStdout(reviewEnRun, "English review prompt hook simulation");
  if (!reviewEnOutput) return;
  const reviewEnContext = hookContextText(reviewEnOutput);
  record(reviewEnContext.includes(routeMarker) ? "pass" : "fail", "English review prompt injects route-required marker");

  const simpleRun = runHook("UserPromptSubmit", {
    hook_event_name: "UserPromptSubmit",
    prompt: "运行 git status --short，然后结束"
  });
  const simpleOutput = parseHookStdout(simpleRun, "Simple terminal prompt hook simulation");
  if (!simpleOutput) return;
  record(!hookContextText(simpleOutput).includes(routeMarker) ? "pass" : "fail", "Simple terminal prompt does not inject route-required marker");

  const standardRun = runHook("UserPromptSubmit", {
    hook_event_name: "UserPromptSubmit",
    prompt: "创建一个简单的 HTML 计数器页面。"
  });

  const standardOutput = parseHookStdout(standardRun, "Medium prompt hook simulation");
  if (!standardOutput) return;

  const standardContext = hookContextText(standardOutput);
  record(standardContext.includes("team_route=standard") ? "pass" : "fail", "Medium prompt routes to standard");
  record(standardContext.includes("suggested_execution=subagents") ? "pass" : "fail", "Medium prompt suggests subagents");

  const preToolRun = runHook("PreToolUse", {
    hook_event_name: "PreToolUse",
    tool_name: "shell_command",
    tool_input: { command: "Get-ChildItem" }
  });

  if (preToolRun.status !== 0) {
    record("fail", "PreToolUse hook simulation exited non-zero", preToolRun.stderr || preToolRun.stdout);
    return;
  }

  const preToolOutput = preToolRun.stdout.trim();
  record(preToolOutput.startsWith("{") ? "pass" : "fail", "PreToolUse emits JSON stdout");
  record(preToolOutput.includes("tool_search") ? "pass" : "warn", "PreToolUse reminder includes tool_search guidance");
  record(preToolOutput.includes("explicit user authorization") ? "pass" : "fail", "PreToolUse reminder preserves explicit subagent authorization boundary");
}

function checkModelFallback() {
  const tempDir = mkdtempSync(join(tmpdir(), "codex-team-router-doctor-"));
  const outputPath = join(tempDir, "model-profiles.generated.json");

  try {
    const run = spawnSync(process.execPath, [modelScriptPath, outputPath], {
      encoding: "utf8",
      timeout: 30000
    });

    if (run.status !== 0) {
      record("fail", "Model profile refresh exited non-zero", run.stderr || run.stdout);
      return;
    }

    const generated = readJson(outputPath);
    if (!generated) return;

    const warnings = generated.warnings || [];
    const missingTargetWarnings = warnings.filter((warning) =>
      /gpt-5\.5|gpt-5\.4|gpt-5\.4-mini/.test(warning) && /not present/.test(warning)
    );
    const profiles = generated.profiles || {};
    const expectedProfiles =
      profiles.smartest_deep?.model === "gpt-5.5" &&
      profiles.smart_code?.model === "gpt-5.4" &&
      profiles.fast_scan?.model === "gpt-5.4-mini";
    const checkedModelsCache = (generated.catalog_paths_checked || []).some((path) =>
      /models_cache\.json$/i.test(path)
    );

    record(expectedProfiles ? "pass" : "fail", "Model profile defaults are generated");
    record(checkedModelsCache ? "pass" : "fail", "Model profile refresh checks models_cache fallback");
    record(
      missingTargetWarnings.length === 0 ? "pass" : "fail",
      "Model profile fallback resolves target GPT models",
      missingTargetWarnings.join("\n")
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function checkAgentTemplates() {
  const templates = existsSync(agentTemplateDir)
    ? readdirSync(agentTemplateDir).filter((name) => name.endsWith(".toml")).sort()
    : [];

  if (templates.length === 0) {
    record("fail", "No bundled custom-agent templates found", agentTemplateDir);
    return;
  }

  for (const template of templates) {
    const templatePath = join(agentTemplateDir, template);
    const globalPath = join(globalAgentsDir, template);
    if (!existsSync(globalPath)) {
      record("warn", `Global custom agent missing: ${template}`, globalPath);
      continue;
    }
    record(
      sha256(templatePath) === sha256(globalPath) ? "pass" : "warn",
      `Global custom agent matches bundled template: ${template}`,
      globalPath
    );
  }

  const verifierTemplate = readText(join(agentTemplateDir, "verifier.toml"));
  const verifierGlobal = readText(join(globalAgentsDir, "verifier.toml"));
  record(/sandbox_mode\s*=\s*"read-only"/.test(verifierTemplate) ? "pass" : "fail", "Bundled verifier is read-only");
  record(/sandbox_mode\s*=\s*"read-only"/.test(verifierGlobal) ? "pass" : "warn", "Global verifier is read-only");
}

console.log("Codex Team Router doctor");
console.log(`Plugin root: ${pluginRoot}`);
console.log(`Codex home: ${codexHome}`);
console.log("");

checkFiles();
checkManifest();
checkHooksJson();
checkConfig();
checkPluginCli();
checkHookSimulation();
checkModelFallback();
checkAgentTemplates();

const failCount = results.filter((item) => item.level === "fail").length;
const warnCount = results.filter((item) => item.level === "warn").length;

console.log("");
console.log(`Summary: ${failCount} fail(s), ${warnCount} warning(s), ${results.length} check(s).`);

if (failCount > 0) {
  process.exit(1);
}
