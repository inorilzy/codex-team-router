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
const routeFixturesScriptPath = join(pluginRoot, "scripts", "route-fixtures.mjs");
const smokeInstallScriptPath = join(pluginRoot, "scripts", "smoke-install.mjs");
const syncAgentsScriptPath = join(pluginRoot, "scripts", "sync-agents.mjs");
const skillRoot = join(pluginRoot, "skills", "codex-team-router");
const assetHookScriptPath = join(skillRoot, "assets", "hooks", "codex-team-router-hook.mjs");
const assetModelScriptPath = join(skillRoot, "assets", "scripts", "refresh-model-profiles.mjs");
const agentTemplateDir = join(skillRoot, "assets", "codex-agents");
const globalAgentsDir = join(codexHome, "agents");
const pluginName = "codex-team-router";
const routeMarker = "CODEX_TEAM_ROUTER_ROUTE_REQUIRED";
const hookWorkspaceDir = mkdtempSync(join(tmpdir(), "codex-team-router-doctor-work-"));
const runtimeStatusPath = join(hookWorkspaceDir, ".codex", "team-router", "status.json");
const sourceOnly = process.argv.includes("--source-only");
const jsonMode = process.argv.includes("--json");

const results = [];

function record(level, message, detail = "") {
  results.push({ level, message, detail });
  if (jsonMode) return;
  const suffix = detail ? `\n    ${detail}` : "";
  console.log(`${level.toUpperCase()}: ${message}${suffix}`);
}

function nextStepsForWarnings(warnCount) {
  if (warnCount === 0) return [];
  if (sourceOnly) {
    return ["Source-only mode should normally be warning-free. Inspect the warning details before publishing."];
  }
  return [
    "If the plugin is not installed, add this marketplace and run `codex plugin add codex-team-router@codex-team-router`.",
    "If trusted hook entries are missing, restart Codex App or open a new thread, then review and trust the plugin hooks.",
    "If global custom agents drift from bundled templates, run `node scripts/sync-agents.mjs --global --write` from the plugin root, adding `--force` only when overwriting is intentional."
  ];
}

function printJsonReport(error = null) {
  const failCount = results.filter((item) => item.level === "fail").length + (error ? 1 : 0);
  const warnCount = results.filter((item) => item.level === "warn").length;
  const report = {
    tool: "doctor",
    schema_version: 1,
    plugin_root: pluginRoot,
    codex_home: codexHome,
    mode: sourceOnly ? "source-only" : "full",
    summary: {
      fail_count: failCount,
      warn_count: warnCount,
      check_count: results.length
    },
    results,
    next_steps: nextStepsForWarnings(warnCount)
  };

  if (error) {
    report.error = error.message;
  }

  console.log(JSON.stringify(report, null, 2));
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

function runHook(event, payload, env = {}) {
  return spawnSync(process.execPath, [hookScriptPath, event], {
    cwd: hookWorkspaceDir,
    input: `${JSON.stringify(payload)}\n`,
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, ...env }
  });
}

function resetHookState() {
  rmSync(join(hookWorkspaceDir, ".codex", "team-router"), { recursive: true, force: true });
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
  record(existsSync(routeFixturesScriptPath) ? "pass" : "fail", "Route fixture script exists", routeFixturesScriptPath);
  record(existsSync(smokeInstallScriptPath) ? "pass" : "fail", "Smoke install script exists", smokeInstallScriptPath);
  record(existsSync(syncAgentsScriptPath) ? "pass" : "fail", "Agent template sync script exists", syncAgentsScriptPath);
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
  const plainPromptRun = runHook("UserPromptSubmit", {
    hook_event_name: "UserPromptSubmit",
    prompt: "生成一个html 版本的飞机大战。"
  });

  const plainOutput = parseHookStdout(plainPromptRun, "Plain engineering prompt hook simulation");
  if (!plainOutput) return;
  record(!hookContextText(plainOutput).includes(routeMarker) ? "pass" : "fail", "Manual mode does not inject route marker for plain engineering prompts");

  const promptRun = runHook("UserPromptSubmit", {
    hook_event_name: "UserPromptSubmit",
    prompt: "team 生成一个html 版本的飞机大战。"
  });

  const output = parseHookStdout(promptRun, "Team command hook simulation");
  if (!output) return;

  const context = hookContextText(output);
  record(context.includes(routeMarker) ? "pass" : "fail", "Team command injects route-required marker");
  record(context.includes("tool_search") ? "pass" : "fail", "UserPromptSubmit tells the model to discover multi_agent_v1 with tool_search");
  record(context.includes("suggested_execution=subagents") ? "pass" : "fail", "Complex prompt suggests subagents");
  record(context.includes("source=team_command") ? "pass" : "fail", "Team command records source=team_command");
  record(context.includes("authorization=explicit") ? "pass" : "fail", "Team command records explicit authorization");
  record(context.includes("explicit team-mode routing context") ? "pass" : "fail", "UserPromptSubmit states team command can authorize routing");
  record(context.includes("user opt-out -> high-risk confirmation -> native-tool availability") ? "pass" : "fail", "UserPromptSubmit states automatic routing gates");

  const reviewZhRun = runHook("UserPromptSubmit", {
    hook_event_name: "UserPromptSubmit",
    prompt: "team 检查一下这个插件的各个方面，看看还有没有改进和优化的空间。"
  });
  const reviewZhOutput = parseHookStdout(reviewZhRun, "Chinese review prompt hook simulation");
  if (!reviewZhOutput) return;
  const reviewZhContext = hookContextText(reviewZhOutput);
  record(reviewZhContext.includes(routeMarker) ? "pass" : "fail", "Chinese review prompt injects route-required marker");
  record(reviewZhContext.includes("intent=review") && reviewZhContext.includes("domain=infra") && reviewZhContext.includes("team_route=complex") ? "pass" : "fail", "Chinese review prompt routes as review/infra/complex");

  const reviewEnRun = runHook("UserPromptSubmit", {
    hook_event_name: "UserPromptSubmit",
    prompt: "/team review this plugin and find improvements"
  });
  const reviewEnOutput = parseHookStdout(reviewEnRun, "English review prompt hook simulation");
  if (!reviewEnOutput) return;
  const reviewEnContext = hookContextText(reviewEnOutput);
  record(reviewEnContext.includes(routeMarker) ? "pass" : "fail", "English review prompt injects route-required marker");

  const parallelReadRun = runHook("UserPromptSubmit", {
    hook_event_name: "UserPromptSubmit",
    prompt: "使用 team 查找这个仓库里 hooks 和 doctor 的实现，梳理潜在问题，不要修改文件。"
  });
  const parallelReadOutput = parseHookStdout(parallelReadRun, "Read-heavy scan prompt hook simulation");
  if (!parallelReadOutput) return;
  const parallelReadContext = hookContextText(parallelReadOutput);
  record(parallelReadContext.includes("team_route=parallel_read") ? "pass" : "fail", "Read-heavy scan routes to parallel_read");
  record(parallelReadContext.includes("authorization=explicit") ? "pass" : "fail", "Read-heavy scan uses explicit team authorization");

  const highRiskRun = runHook("UserPromptSubmit", {
    hook_event_name: "UserPromptSubmit",
    prompt: "team 规划一次数据库权限迁移，涉及安全、回滚和发布验证。"
  });
  const highRiskOutput = parseHookStdout(highRiskRun, "High-risk prompt hook simulation");
  if (!highRiskOutput) return;
  const highRiskContext = hookContextText(highRiskOutput);
  record(highRiskContext.includes("team_route=high_risk") ? "pass" : "fail", "High-risk prompt routes to high_risk");

  const explicitRun = runHook("UserPromptSubmit", {
    hook_event_name: "UserPromptSubmit",
    prompt: "Use planner/executor/reviewer subagents to create a small HTML app."
  }, {
    CODEX_TEAM_ROUTER_MODE: "auto"
  });
  const explicitOutput = parseHookStdout(explicitRun, "Explicit subagent prompt hook simulation");
  if (!explicitOutput) return;
  const explicitContext = hookContextText(explicitOutput);
  record(explicitContext.includes("authorization=explicit") ? "pass" : "fail", "Explicit subagent wording records authorization=explicit");

  const simpleRun = runHook("UserPromptSubmit", {
    hook_event_name: "UserPromptSubmit",
    prompt: "运行 git status --short，然后结束"
  });
  const simpleOutput = parseHookStdout(simpleRun, "Simple terminal prompt hook simulation");
  if (!simpleOutput) return;
  record(!hookContextText(simpleOutput).includes(routeMarker) ? "pass" : "fail", "Simple terminal prompt does not inject route-required marker");

  const standardRun = runHook("UserPromptSubmit", {
    hook_event_name: "UserPromptSubmit",
    prompt: "团队模式 创建一个简单的 HTML 计数器页面。"
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
  record(preToolOutput.includes("authorization") ? "pass" : "fail", "PreToolUse reminder preserves routing authorization guidance");

  resetHookState();

  runHook("UserPromptSubmit", {
    hook_event_name: "UserPromptSubmit",
    prompt: "team 修复这个插件的路由问题。"
  });
  runHook("SubagentStart", {
    hook_event_name: "SubagentStart",
    subagent_type: "planner",
    role_id: "planner"
  });

  const plannerOnlyWriteRun = runHook("PreToolUse", {
    hook_event_name: "PreToolUse",
    tool_name: "shell_command",
    tool_input: { command: "Set-Content -Path app.html -Value test" }
  });

  if (plannerOnlyWriteRun.status !== 0) {
    record("fail", "Planner-only write gate simulation exited non-zero", plannerOnlyWriteRun.stderr || plannerOnlyWriteRun.stdout);
    return;
  }

  const plannerOnlyWriteOutput = plannerOnlyWriteRun.stdout.trim();
  record(plannerOnlyWriteOutput.startsWith("{") ? "pass" : "fail", "Planner-only implementation write still emits JSON stdout");
  record(plannerOnlyWriteOutput.includes("executor/worker") ? "pass" : "fail", "Planner-only implementation write still requires executor/worker");

  runHook("SubagentStart", {
    hook_event_name: "SubagentStart",
    subagent_type: "worker",
    role_id: "worker"
  });

  const workerWriteRun = runHook("PreToolUse", {
    hook_event_name: "PreToolUse",
    tool_name: "shell_command",
    tool_input: { command: "Set-Content -Path app.html -Value test" }
  });

  if (workerWriteRun.status !== 0) {
    record("fail", "Worker write gate simulation exited non-zero", workerWriteRun.stderr || workerWriteRun.stdout);
    return;
  }

  const workerWriteOutput = workerWriteRun.stdout.trim();
  record(!workerWriteOutput.includes("executor/worker") ? "pass" : "fail", "Executor/worker start satisfies implementation write gate", workerWriteOutput);
}

function checkRuntimeStatusSummary() {
  if (!existsSync(runtimeStatusPath)) {
    record("fail", "Hook writes runtime status summary", runtimeStatusPath);
    return;
  }

  const status = readJson(runtimeStatusPath);
  if (!status) return;

  record(status.route === "standard" ? "pass" : "fail", "Runtime status summary records the latest route", `route=${status.route}`);
  record(Array.isArray(status.task_board) && status.task_board.length > 0 ? "pass" : "fail", "Runtime status summary includes task_board");
  record(typeof status.next_action === "string" && status.next_action.length > 0 ? "pass" : "fail", "Runtime status summary includes next_action", status.next_action || "");
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

function checkBundledAgentTemplates() {
  const expected = ["analyst", "planner", "plan-reviewer", "executor", "reviewer", "explorer", "verifier"];
  const templates = existsSync(agentTemplateDir)
    ? readdirSync(agentTemplateDir).filter((name) => name.endsWith(".toml")).sort()
    : [];

  record(templates.length === expected.length ? "pass" : "fail", "Bundled custom-agent template count", `${templates.length}/${expected.length}`);

  for (const name of expected) {
    record(
      existsSync(join(agentTemplateDir, `${name}.toml`)) ? "pass" : "fail",
      `Bundled custom-agent template exists: ${name}.toml`
    );
  }

  const verifierTemplate = readText(join(agentTemplateDir, "verifier.toml"));
  record(/sandbox_mode\s*=\s*"read-only"/.test(verifierTemplate) ? "pass" : "fail", "Bundled verifier is read-only");
}

try {
  if (!jsonMode) {
    console.log("Codex Team Router doctor");
    console.log(`Plugin root: ${pluginRoot}`);
    console.log(`Codex home: ${codexHome}`);
    if (sourceOnly) {
      console.log("Mode: source-only");
    }
    console.log("");
  }

  checkFiles();
  checkManifest();
  checkHooksJson();
  checkHookSimulation();
  checkRuntimeStatusSummary();
  if (sourceOnly) {
    checkBundledAgentTemplates();
  } else {
    checkConfig();
    checkPluginCli();
    checkModelFallback();
    checkAgentTemplates();
  }

  const failCount = results.filter((item) => item.level === "fail").length;
  const warnCount = results.filter((item) => item.level === "warn").length;

  if (jsonMode) {
    printJsonReport();
  } else {
    console.log("");
    console.log(`Summary: ${failCount} fail(s), ${warnCount} warning(s), ${results.length} check(s).`);

    const nextSteps = nextStepsForWarnings(warnCount);
    if (nextSteps.length > 0) {
      console.log("");
      console.log("Next steps for warnings:");
      for (const step of nextSteps) {
        console.log(`- ${step}`);
      }
    }
  }

  if (failCount > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  if (jsonMode) {
    printJsonReport(error);
  } else {
    console.error(`FAIL: ${error.message}`);
  }
  process.exitCode = 1;
} finally {
  rmSync(hookWorkspaceDir, { recursive: true, force: true });
}
