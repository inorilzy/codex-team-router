#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const event = process.argv[2] || "Unknown";
const cwd = process.cwd();
const routerDir = join(cwd, ".codex", "team-router");
const statePath = join(routerDir, "current-run.json");
const auditPath = join(routerDir, "audit.jsonl");
const healthPath = join(routerDir, "health.json");
const gatePath = join(routerDir, "completion-gate.json");
const statusPath = join(routerDir, "status.json");
const mode = process.env.CODEX_TEAM_ROUTER_HOOK_MODE || process.env.SQUAD_HOOK_MODE || "warn";
const subagentGate = process.env.CODEX_TEAM_ROUTER_SUBAGENT_GATE || process.env.SQUAD_SUBAGENT_GATE || "warn";
const routeReminderTools = /(?:shell|exec|command|apply_patch|edit|write|read|grep|rg|find|search|view|open|multi_agent|spawn)/i;
let emittedOutput = false;

function now() {
  return new Date().toISOString();
}

function ensureDir() {
  mkdirSync(routerDir, { recursive: true });
}

function readStdinJson() {
  try {
    const input = readFileSync(0, "utf8").trim();
    return input ? JSON.parse(input) : {};
  } catch {
    return {};
  }
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function appendAudit(record) {
  appendFileSync(auditPath, `${JSON.stringify(record)}\n`);
}

function emitJson(value = {}) {
  emittedOutput = true;
  console.log(JSON.stringify(value));
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function listChangedFiles() {
  const output = git(["diff", "--name-only"]);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function loadState() {
  return readJson(statePath, {
    version: 1,
    run_id: `run-${now().replace(/[:.]/g, "-")}`,
    status: "running",
    started_at: now(),
    agents: [],
    validation_evidence: [],
    hook_events: [],
    warnings: []
  });
}

function countAgents(state, status) {
  return (state.agents || []).filter((agent) => agent.status === status).length;
}

function routeClassification(state) {
  return state.route_required?.classification || {};
}

function routeLevel(state) {
  const classification = routeClassification(state);
  return classification.team_route || classification.squad_route || null;
}

function deriveNextAction(state) {
  const routeRequired = state.route_required?.required === true;
  const route = routeLevel(state);
  const runningAgents = countAgents(state, "running");
  const validationCount = (state.validation_evidence || []).length;

  if (!routeRequired) {
    return "No team-router action is required for the current prompt.";
  }
  if (runningAgents > 0) {
    return "Wait for running subagents, then integrate their results in the main thread.";
  }
  if (route === "standard" || route === "complex" || route === "high_risk") {
    if (!hasSubagentStarted(state)) {
      return "Emit the routing receipt; spawn subagents only if explicitly authorized, otherwise continue in the main thread or ask before delegation.";
    }
    if (validationCount === 0) {
      return "Collect validation evidence before claiming completion.";
    }
  }
  if (route === "parallel_read") {
    if (!hasSubagentStarted(state)) {
      return "Emit the routing receipt; use read-only exploration; spawn explorer subagents only if explicitly authorized, otherwise continue in the main thread.";
    }
    return "Synthesize read-only findings from the main thread after explorer work completes.";
  }
  return "Continue from the visible routing receipt and keep the main thread responsible for final verification.";
}

function buildTaskBoard(state) {
  const routeRequired = state.route_required?.required === true;
  const route = routeLevel(state);
  const delegatedRoute = route === "parallel_read" || route === "standard" || route === "complex" || route === "high_risk";
  const agentsStarted = hasSubagentStarted(state);
  const validationCount = (state.validation_evidence || []).length;

  return [
    {
      item: "Classify prompt",
      status: routeRequired ? "completed" : "not_required"
    },
    {
      item: "Emit routing receipt",
      status: routeRequired ? "pending_model_action" : "not_required"
    },
    {
      item: "Start authorized subagents",
      status: delegatedRoute ? (agentsStarted ? "completed" : "optional_pending_authorization") : "not_required"
    },
    {
      item: "Collect validation evidence",
      status: validationCount > 0 ? "completed" : "pending_when_files_change"
    }
  ];
}

function writeStatus(state) {
  const classification = routeClassification(state);
  const agents = state.agents || [];
  const warnings = state.warnings || [];
  const validationEvidence = state.validation_evidence || [];
  const hookEvents = state.hook_events || [];

  writeJson(statusPath, {
    version: 1,
    updated_at: now(),
    run_id: state.run_id || null,
    status: state.status || "running",
    route_required: state.route_required?.required === true,
    route: routeLevel(state),
    intent: classification.intent || null,
    domain: classification.domain || null,
    authorization: classification.authorization || null,
    prompt_complexity: classification.prompt_complexity || null,
    execution: classification.execution || null,
    prompt_preview: state.route_required?.prompt_preview || null,
    agents: {
      total: agents.length,
      running: countAgents(state, "running"),
      completed: countAgents(state, "completed")
    },
    validation_evidence_count: validationEvidence.length,
    warning_count: warnings.length,
    last_warning: warnings.at(-1)?.message || null,
    last_event: hookEvents.at(-1) || null,
    task_board: buildTaskBoard(state),
    next_action: deriveNextAction(state)
  });
}

function saveState(state) {
  writeJson(statePath, state);
  writeStatus(state);
}

function detectTool(payload) {
  return payload.toolName || payload.tool_name || payload.tool?.name || payload.matcher || payload.subagent_type || "";
}

function detectCommand(payload) {
  return payload.command || payload.input?.command || payload.tool_input?.command || payload.arguments?.command || "";
}

function detectPrompt(payload) {
  return payload.prompt || payload.user_prompt || payload.userPrompt || payload.message || payload.input?.prompt || payload.input?.message || "";
}

function hookContext(eventName, additionalContext) {
  return {
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext
    }
  };
}

function denyPreToolUse(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  };
}

function isValidationCommand(command) {
  return /\b(test|pytest|vitest|jest|mocha|pnpm test|npm test|yarn test|lint|typecheck|tsc|build)\b/i.test(command);
}

function isRiskyCommand(command) {
  return /\b(git\s+reset\s+--hard|git\s+checkout\s+--|git\s+clean\s+-|rm\s+-rf|Remove-Item\b.*\s-Recurse)\b/i.test(command);
}

function isWriteTool(tool, command) {
  if (/\b(apply_patch|edit|write)\b/i.test(tool)) return true;
  if (!command) return false;
  return /\b(Set-Content|Add-Content|Out-File|New-Item|Copy-Item|Move-Item|Remove-Item|del|erase|rm|mkdir|touch)\b|>\s*[^&|]+|>>\s*[^&|]+|\b(writeFileSync|appendFileSync|createWriteStream)\b/i.test(command);
}

function isSubagentSpawnTool(tool, command) {
  return /multi_agent_v1.*spawn|spawn_agent/i.test(`${tool} ${command}`);
}

function needsSubagentBeforeWrite(state) {
  const route = state.route_required?.classification?.team_route || state.route_required?.classification?.squad_route || "";
  const execution = state.route_required?.classification?.execution || "";
  return state.route_required?.required === true && (route === "standard" || route === "complex" || route === "high_risk" || execution === "subagents");
}

function isDelegatedRoute(state) {
  const route = state.route_required?.classification?.team_route || state.route_required?.classification?.squad_route || "";
  return state.route_required?.required === true && (route === "standard" || route === "complex" || route === "high_risk");
}

function hasSubagentStarted(state) {
  return Array.isArray(state.agents) && state.agents.length > 0;
}

function isSimpleTerminalPrompt(prompt) {
  return /^(运行|run|execute)\s+[`"']?[^`"']+[`"']?\s*(然后结束|and stop|then stop)?\s*$/i.test(prompt.trim());
}

function classifyPrompt(prompt) {
  const signals = [];
  let intent = "answer";
  let domain = "general";
  let complexity = "low";
  let routeOverride = null;
  const hasImplementationNounOnly = /的实现/.test(prompt) && /(搜索|查找|查一下|找出|梳理|调查|只读|不要修改|不修改|scan|explore|investigate|survey|read-only|no edits|without changing)/i.test(prompt);
  const hasEngineeringWriteVerb = !hasImplementationNounOnly && /(实现|修改|修复|重构|创建|生成|开发|写|build|create|implement|modify|change|fix|refactor|add|make|code)/i.test(prompt);
  const isTinyRequest = /(最小|简单|最简单|basic|tiny|quick|demo|示例|hello\s*world|只要|静态)/i.test(prompt);
  const hasFrontendSurface = /(html|css|canvas|svg|react|vue|svelte|frontend|前端|网页|页面|组件|ui|布局|动画|浏览器)/i.test(prompt);
  const hasCompleteArtifact = /(生成|创建|做一个|开发|实现|build|create|make|implement).{0,40}(html|网页|页面|app|应用|工具|dashboard|仪表盘|site|website|游戏|小游戏|版本|demo|编辑器|可视化)|(?:html|网页|页面)\s*(?:版本|版)|single[- ]?file|单文件|直接打开/i.test(prompt);
  const hasGameShape = /(游戏|小游戏|可玩|关卡|得分|计分|敌人|胜负|角色|地图|碰撞|物理|射击|跳跃|移动|键盘|鼠标|触摸|game|playable|level|score|enemy|collision|physics|shoot|jump|movement|keyboard|mouse|touch)/i.test(prompt);
  const hasInteractiveShape = /(交互|控制|输入|拖拽|点击|表单|筛选|搜索|排序|状态|开始|暂停|重启|保存|导出|上传|下载|实时|编辑|动画|canvas|键盘|鼠标|触摸|interactive|input|drag|click|filter|search|sort|state|save|export|upload|download|editor|animation|keyboard|mouse|touch)/i.test(prompt);
  const hasMultiSubsystemShape = /(认证|权限|数据库|后端|api|支付|迁移|并发|缓存|队列|多页面|路由|状态管理|图表|报表|工作流|自动化|agent|subagent|并行|planner|executor|reviewer|auth|database|backend|payment|migration|concurrency|cache|queue|routing|chart|report|workflow|automation)/i.test(prompt);
  const asksForVersionedBuild = /(v\d+|版本|版|clone|复刻|仿|完整|complete|full|proper|polish|升级|改进)/i.test(prompt);
  const hasReviewIntent = /(review|审查|检查|验证|validate|qa)/i.test(prompt);
  const hasPluginReviewShape = /(插件|plugin|hooks?|skill|agent|subagent|marketplace|manifest|doctor|配置|config|发布|publish|优化|改进|improvements?)/i.test(prompt);
  const hasBroadReviewShape = /(各个方面|整体|全局|全面|全方位|改进|优化|improvements?|all aspects|overall|comprehensive)/i.test(prompt);
  const hasReadHeavyShape = /(搜索|查找|查一下|找出|梳理|调查|只读|不要修改|不修改|scan|explore|investigate|survey|find all|trace|map|read-only|no edits|without changing)/i.test(prompt);
  const hasExplicitAuthorization = /(subagents?|sub-agents?|委派|并行|delegat|parallel work|planner\s*\/\s*executor\s*\/\s*reviewer|planner|executor|reviewer)/i.test(prompt);

  if (hasEngineeringWriteVerb) {
    intent = /(修复|fix|bug|报错|失败|regression)/i.test(prompt) ? "fix" : "implement";
    signals.push("engineering verb");
  }
  if (hasReviewIntent) {
    intent = "review";
    signals.push("review intent");
    if (hasPluginReviewShape) {
      domain = "infra";
      complexity = hasBroadReviewShape ? "high" : "medium";
      signals.push("plugin/workflow review");
    }
  }
  if (hasReadHeavyShape && !hasEngineeringWriteVerb && !(hasReviewIntent && hasPluginReviewShape && hasBroadReviewShape)) {
    intent = hasReviewIntent ? "review" : "investigate";
    if (/(仓库|代码|repo|repository|codebase|插件|plugin|hooks?|doctor|skill|agent|subagent)/i.test(prompt)) {
      domain = "infra";
    }
    complexity = complexity === "very_high" ? "very_high" : "medium";
    routeOverride = "parallel_read";
    signals.push("read-heavy scan");
  }
  if (hasFrontendSurface) {
    domain = "visual";
    complexity = "medium";
    signals.push("frontend/ui");
  }
  if (hasGameShape) {
    domain = "game";
    complexity = "high";
    signals.push("game mechanics");
  }
  if (hasCompleteArtifact) {
    complexity = isTinyRequest && !hasInteractiveShape && !hasGameShape ? "medium" : "high";
    signals.push("complete artifact");
  }
  if (hasInteractiveShape) {
    complexity = complexity === "low" ? "medium" : complexity;
    if (hasCompleteArtifact || hasGameShape || asksForVersionedBuild) complexity = "high";
    signals.push("interactive/stateful");
  }
  if (hasMultiSubsystemShape) {
    complexity = hasCompleteArtifact || hasInteractiveShape ? "high" : "medium";
    signals.push("multi-subsystem");
  }
  if (/(架构|迁移|并发|权限|安全|高风险|architecture|migration|concurrency|permission|security)/i.test(prompt)) {
    complexity = "very_high";
    signals.push("high-risk architecture");
  }
  if (/(完整|复杂|多个|拆分|subagent|agent|并行|planner|executor|reviewer|complete|complex|multi-file|parallel)/i.test(prompt)) {
    complexity = complexity === "very_high" ? "very_high" : "high";
    signals.push("decomposition signal");
  }

  const route = complexity === "very_high" ? "high_risk" : routeOverride || (complexity === "high" ? "complex" : complexity === "medium" ? "standard" : "trivial");
  const execution = route === "parallel_read" || route === "standard" || route === "complex" || route === "high_risk" ? "subagents" : "main";

  return {
    intent,
    domain,
    authorization: hasExplicitAuthorization ? "explicit" : "none",
    prompt_complexity: complexity,
    signals: signals.length ? signals.join(", ") : "none",
    team_route: route,
    execution
  };
}

function isEngineeringPrompt(prompt) {
  if (!prompt || isSimpleTerminalPrompt(prompt)) return false;
  return /(代码|实现|修改|修复|重构|创建|生成|开发|写.*(?:html|css|js|代码|脚本)|检查|审查|验证|优化|改进|插件|配置|发布|查找|梳理|调查|迁移|权限|安全|架构|build|create|implement|modify|change|fix|refactor|add|make|code|review|validate|qa|plugin|hooks?|skill|config|publish|improvements?|scan|explore|investigate|survey|migration|permission|security|architecture|html|css|javascript|typescript|react|vue|网页|页面|app|应用|工具|dashboard|仪表盘|game|小游戏|游戏|可玩|交互|canvas|bug|test|lint)/i.test(prompt);
}

function userPromptSubmit(payload) {
  const prompt = String(detectPrompt(payload) || "");
  if (!isEngineeringPrompt(prompt)) {
    const state = loadState();
    state.status = "no_route_required";
    state.route_required = { required: false, cleared_at: now(), source: "UserPromptSubmit" };
    state.pre_tool_route_reminder_sent = false;
    state.hook_events.push({ event, at: now(), route_required: false });
    saveState(state);
    return;
  }

  const classification = classifyPrompt(prompt);
  const state = loadState();
  state.status = "routing_required";
  state.route_required = {
    required: true,
    detected_at: now(),
    source: "UserPromptSubmit",
    prompt_preview: prompt.slice(0, 240),
    classification
  };
  state.pre_tool_route_reminder_sent = false;
  state.hook_events.push({ event, at: now(), route_required: true, classification });
  saveState(state);

  const context = [
    "[Codex Team Router Hook]",
    "CODEX_TEAM_ROUTER_ROUTE_REQUIRED",
    "The current user prompt looks like an engineering task. Before implementation work, use the `codex-team-router` skill as the routing layer.",
    "Emit the visible routing receipt so the user can distinguish: skill not used vs. skill used and routed to main vs. skill used and spawned subagents.",
    "Required receipt shape:",
    "intent: <answer|investigate|implement|fix|review|plan|terminal>; domain: <general|visual|game|logic|writing|git|data|infra>; authorization: <explicit|implicit|none>",
    "prompt_complexity: <low|medium|high|very_high>; signals: <short signals>",
    "team_route: <trivial|small|standard|parallel_read|complex|high_risk>; execution: <main|executor|subagents>; reason: <short reason>",
    `Hook pre-classification: intent=${classification.intent}; domain=${classification.domain}; authorization=${classification.authorization}; prompt_complexity=${classification.prompt_complexity}; team_route=${classification.team_route}; suggested_execution=${classification.execution}; signals=${classification.signals}.`,
    "For standard, complex, or high_risk engineering prompts, this marker is routing context only. It does not by itself grant user authorization to spawn subagents.",
    "Spawn visible native Codex App subagents only when the user explicitly asks for subagents, delegation, parallel work, planner/executor/reviewer, or explicitly selects a plugin prompt that asks for subagents.",
    "Routing gates apply in this order: explicit authorization -> high-risk confirmation -> native-tool availability.",
    "If high-risk confirmation is granted, continue to the native-tool availability check; if confirmation is declined or not granted, emit the fallback receipt and continue with the documented main-thread fallback without spawning.",
    "If subagent spawning is explicitly authorized and `multi_agent_v1` is not visible, use tool discovery first. In Codex App, call `tool_search` with query `multi_agent_v1 spawn_agent native subagent Codex App`, then return to the native-tool availability check instead of falling back immediately.",
    "Treat suggested_execution as the hook's preferred route, not final authorization. Use `execution=subagents` only when spawning is authorized and available; otherwise make the main-thread fallback or ask-for-delegation step explicit in the routing receipt.",
    "If native subagent tools are unavailable after discovery, say so in the routing receipt and continue with the documented fallback. Treat this hook output as routing context, not as final judgment."
  ].join("\n");

  emitJson(hookContext("UserPromptSubmit", context));
}

function sessionStart(payload) {
  const agentsDir = join(cwd, ".codex", "agents");
  const expectedAgents = ["analyst", "planner", "plan-reviewer", "executor", "reviewer", "explorer", "verifier"];
  const missingAgents = expectedAgents.filter((name) => !existsSync(join(agentsDir, `${name}.toml`)));
  const health = {
    checked_at: now(),
    source: payload.matcher || payload.source || null,
    cwd,
    registry_present: existsSync(join(cwd, "agent-registry.json")),
    project_agents_dir_present: existsSync(agentsDir),
    missing_project_agents: missingAgents,
    project_hooks_present: existsSync(join(cwd, ".codex", "hooks.json")),
    state_path: statePath
  };

  writeJson(healthPath, health);

  const state = loadState();
  state.status = "session_started";
  state.hook_events.push({ event, at: now(), source: health.source });
  state.last_health = health;
  saveState(state);
}

function subagentStart(payload) {
  const state = loadState();
  const agentType = detectTool(payload) || "unknown";
  state.status = "agents_running";
  state.hook_events.push({ event, at: now(), agent_type: agentType });
  state.agents.push({
    role_id: payload.role_id || agentType,
    custom_agent: payload.custom_agent || null,
    nickname: payload.nickname || null,
    agent_id: payload.agent_id || null,
    native_agent_type: agentType,
    status: "running",
    write_scope: payload.write_scope || [],
    started_at: now(),
    completed_at: null,
    last_result_summary: null
  });
  saveState(state);
}

function subagentStop(payload) {
  const state = loadState();
  const agentType = detectTool(payload) || "unknown";
  const agentId = payload.agent_id || null;
  const agent = [...state.agents].reverse().find((item) => {
    if (agentId && item.agent_id === agentId) return true;
    return item.status === "running" && item.native_agent_type === agentType;
  });

  if (agent) {
    agent.status = "completed";
    agent.completed_at = now();
    agent.last_result_summary = payload.summary || payload.result || null;
  }
  state.status = state.agents.some((item) => item.status === "running") ? "agents_running" : "agents_completed";

  state.hook_events.push({ event, at: now(), agent_type: agentType, agent_id: agentId });
  saveState(state);
}

function preToolUse(payload) {
  const tool = detectTool(payload);
  const command = detectCommand(payload);
  const state = loadState();
  if (!state.status || state.status === "running") state.status = "tool_use_observed";
  const routeRequired = state.route_required?.required === true;
  const shouldGateSubagent = subagentGate !== "off" && needsSubagentBeforeWrite(state);

  if (command && isRiskyCommand(command)) {
    const warning = {
      event,
      at: now(),
      tool,
      message: "Risky command detected. Review before allowing executor work to continue.",
      command
    };
    state.warnings.push(warning);
    saveState(state);
    appendAudit(warning);
    if (mode === "enforce") {
      console.error(warning.message);
      process.exit(2);
    }
  }

  if (shouldGateSubagent && isWriteTool(tool, command) && !isSubagentSpawnTool(tool, command) && !hasSubagentStarted(state)) {
    const opening = subagentGate === "warn"
      ? "Codex Team Router route reminder for this delegated engineering task."
      : "Codex Team Router strict gate blocked direct file editing for this delegated engineering task.";
    const reason = [
      opening,
      "This prompt was routed as standard/complex/high_risk and requires a visible routing receipt before implementation edits.",
      "The hook marker does not override Codex's documented explicit-subagent-authorization rule.",
      "Apply the routing gates in order: explicit authorization, then high-risk confirmation, then native-tool availability.",
      "If high-risk confirmation is granted, continue to native-tool availability; if it is declined or not granted, emit the fallback receipt and do not spawn.",
      "If the user explicitly asked for subagents/delegation/parallel work, discover `multi_agent_v1` if needed, return to the availability check, and spawn a bounded subagent. Otherwise continue in the main thread after the routing receipt, or ask the user whether to delegate.",
      "Set CODEX_TEAM_ROUTER_SUBAGENT_GATE=enforce only when you intentionally want this reminder to deny direct writes; set CODEX_TEAM_ROUTER_SUBAGENT_GATE=off to disable it."
    ].join(" ");
    const record = { event, at: now(), tool, command: command || null, message: reason };
    state.warnings.push(record);
    state.hook_events.push(record);
    saveState(state);
    appendAudit(record);
    if (subagentGate === "warn") {
      emitJson(hookContext("PreToolUse", reason));
    } else {
      emitJson(denyPreToolUse(reason));
    }
    return;
  }

  if (routeRequired && !hasSubagentStarted(state) && !state.pre_tool_route_reminder_sent && routeReminderTools.test(tool || command)) {
    const warning = isDelegatedRoute(state) ? [
      "[Codex Team Router Hook]",
      "CODEX_TEAM_ROUTER_ROUTE_REMINDER",
      "This prompt was pre-classified as standard/complex/high_risk engineering work.",
      "Do not route to main-thread implementation merely because `multi_agent_v1` is not currently visible.",
      "The hook marker is not a substitute for explicit user authorization to spawn subagents.",
      "Apply the routing gates in order: explicit authorization, then high-risk confirmation, then native-tool availability.",
      "If high-risk confirmation is granted, continue to native-tool availability; if it is declined or not granted, emit the fallback receipt and do not spawn.",
      "If the user explicitly asked for subagents/delegation/parallel work and `multi_agent_v1` is hidden, call `tool_search` for `multi_agent_v1 spawn_agent native subagent Codex App`, then return to the availability check and spawn a planner/executor/reviewer or the closest available fallback role.",
      "If spawning is not explicitly authorized, blocked by confirmation, unavailable after discovery, or blocked by active policy, emit the routing receipt and continue in the main thread or ask the user whether to delegate."
    ].join("\n") : [
      "[Codex Team Router Hook]",
      "CODEX_TEAM_ROUTER_ROUTE_REMINDER",
      "This session was marked as an engineering task by UserPromptSubmit.",
      "Before continuing tool-heavy implementation, make sure the visible codex-team-router routing receipt has been emitted. If the receipt already exists, continue normally."
    ].join("\n");
    const record = { event, at: now(), tool, message: "Route reminder emitted before first implementation-like tool use." };
    state.pre_tool_route_reminder_sent = true;
    state.warnings.push(record);
    state.hook_events.push(record);
    saveState(state);
    appendAudit(record);
    emitJson(hookContext("PreToolUse", warning));
  }
}

function postToolUse(payload) {
  const command = detectCommand(payload);
  const state = loadState();
  const record = {
    event,
    at: now(),
    tool: detectTool(payload),
    command: command || null,
    exit_code: payload.exit_code ?? payload.exitCode ?? null,
    changed_files: listChangedFiles()
  };

  if (command && isValidationCommand(command)) {
    state.validation_evidence.push(record);
  }

  state.hook_events.push(record);
  saveState(state);
}

function stop(payload) {
  const state = loadState();
  const runningAgents = state.agents.filter((agent) => agent.status === "running");
  const changedFiles = listChangedFiles();
  const warnings = [];

  if (runningAgents.length > 0) {
    warnings.push(`${runningAgents.length} subagent(s) still marked running.`);
  }

  if (changedFiles.length > 0 && state.validation_evidence.length === 0) {
    warnings.push("Workspace has changed files but no validation evidence was recorded.");
  }

  const gate = {
    checked_at: now(),
    mode,
    warnings,
    running_agents: runningAgents.map((agent) => ({
      role_id: agent.role_id,
      agent_id: agent.agent_id,
      native_agent_type: agent.native_agent_type,
      started_at: agent.started_at
    })),
    changed_files: changedFiles,
    validation_evidence_count: state.validation_evidence.length
  };

  writeJson(gatePath, gate);
  state.status = warnings.length > 0 ? "completed_with_warnings" : "completed";
  state.hook_events.push({ event, at: now(), warnings });
  state.last_completion_gate = gate;
  saveState(state);

  if (warnings.length > 0) {
    console.error(`Codex Team Router gate warnings: ${warnings.join(" ")}`);
    if (mode === "enforce") {
      process.exit(2);
    }
  }
}

ensureDir();
const payload = readStdinJson();
appendAudit({ event, at: now(), cwd: resolve(cwd), payload_keys: Object.keys(payload) });

switch (event) {
  case "UserPromptSubmit":
    userPromptSubmit(payload);
    break;
  case "SessionStart":
    sessionStart(payload);
    break;
  case "SubagentStart":
    subagentStart(payload);
    break;
  case "SubagentStop":
    subagentStop(payload);
    break;
  case "PreToolUse":
  case "PermissionRequest":
    preToolUse(payload);
    break;
  case "PostToolUse":
    postToolUse(payload);
    break;
  case "Stop":
    stop(payload);
    break;
  default:
    break;
}

if (!emittedOutput) {
  emitJson({});
}
