#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const hookScriptPath = join(scriptDir, "codex-team-router-hook.mjs");
const marker = "CODEX_TEAM_ROUTER_ROUTE_REQUIRED";
const jsonMode = process.argv.includes("--json");

const fixtures = [
  {
    name: "simple terminal command",
    prompt: "运行 git status --short，然后结束",
    marker: false,
    routeRequired: false
  },
  {
    name: "casual chat",
    prompt: "你好，今天状态怎么样？",
    marker: false,
    routeRequired: false
  },
  {
    name: "Chinese plugin review",
    prompt: "检查一下这个插件的各个方面，看看还有没有改进和优化的空间。",
    marker: true,
    routeRequired: true,
    includes: ["intent=review", "domain=infra", "team_route=complex"],
    status: { route: "complex", intent: "review", domain: "infra" }
  },
  {
    name: "English plugin review",
    prompt: "review this plugin and find improvements",
    marker: true,
    routeRequired: true,
    includes: ["intent=review", "domain=infra"],
    status: { intent: "review", domain: "infra" }
  },
  {
    name: "simple HTML counter",
    prompt: "创建一个简单的 HTML 计数器页面。",
    marker: true,
    routeRequired: true,
    includes: ["team_route=standard"],
    status: { route: "standard" }
  },
  {
    name: "read-heavy repository scan",
    prompt: "查找这个仓库里 hooks 和 doctor 的实现，梳理潜在问题，不要修改文件。",
    marker: true,
    routeRequired: true,
    includes: ["intent=investigate", "domain=infra", "authorization=none", "team_route=parallel_read"],
    status: { route: "parallel_read", intent: "investigate", domain: "infra", authorization: "none", execution: "subagents" }
  },
  {
    name: "single-file physics game",
    prompt: "创建一个愤怒的小鸟小游戏，单 HTML 文件。",
    marker: true,
    routeRequired: true,
    includes: ["domain=game", "team_route=complex"],
    status: { route: "complex", domain: "game" }
  },
  {
    name: "high-risk security migration",
    prompt: "规划一次数据库权限迁移，涉及安全、回滚和发布验证。",
    marker: true,
    routeRequired: true,
    includes: ["prompt_complexity=very_high", "team_route=high_risk"],
    status: { route: "high_risk", prompt_complexity: "very_high" }
  },
  {
    name: "explicit subagent authorization",
    prompt: "Use planner/executor/reviewer subagents to create a small HTML app.",
    marker: true,
    routeRequired: true,
    includes: ["authorization=explicit", "team_route=complex", "suggested_execution=subagents"],
    status: { route: "complex", authorization: "explicit", execution: "subagents" }
  }
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function runHook(cwd, event, payload) {
  const run = spawnSync(process.execPath, [hookScriptPath, event], {
    cwd,
    input: `${JSON.stringify(payload)}\n`,
    encoding: "utf8",
    timeout: 30000
  });

  if (run.status !== 0) {
    throw new Error(`${event} exited ${run.status}: ${run.stderr || run.stdout}`);
  }

  try {
    return JSON.parse(run.stdout.trim() || "{}");
  } catch (error) {
    throw new Error(`${event} emitted invalid JSON: ${error.message}\n${run.stdout}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function checkFixture(fixture) {
  const tempDir = mkdtempSync(join(tmpdir(), "codex-team-router-route-"));
  try {
    const output = runHook(tempDir, "UserPromptSubmit", {
      hook_event_name: "UserPromptSubmit",
      prompt: fixture.prompt
    });
    const context = output?.hookSpecificOutput?.additionalContext || "";
    const statusPath = join(tempDir, ".codex", "team-router", "status.json");

    assert(existsSync(statusPath), `${fixture.name}: status.json was not written`);
    const status = readJson(statusPath);

    if (fixture.marker) {
      assert(context.includes(marker), `${fixture.name}: route marker was not injected`);
    } else {
      assert(!context.includes(marker), `${fixture.name}: route marker should not be injected`);
    }

    assert(
      status.route_required === fixture.routeRequired,
      `${fixture.name}: expected route_required=${fixture.routeRequired}, got ${status.route_required}`
    );

    for (const expected of fixture.includes || []) {
      assert(context.includes(expected), `${fixture.name}: context missing ${expected}`);
    }

    if (fixture.status) {
      for (const [key, expected] of Object.entries(fixture.status)) {
        assert(status[key] === expected, `${fixture.name}: expected status.${key}=${expected}, got ${status[key]}`);
      }
    }

    assert(Array.isArray(status.task_board), `${fixture.name}: status.task_board missing`);
    assert(typeof status.next_action === "string" && status.next_action.length > 0, `${fixture.name}: status.next_action missing`);

    return {
      ok: true,
      name: fixture.name,
      prompt: fixture.prompt,
      marker_expected: fixture.marker,
      route_required_expected: fixture.routeRequired,
      route: status.route || null,
      intent: status.intent || null,
      domain: status.domain || null,
      authorization: status.authorization || null,
      prompt_complexity: status.prompt_complexity || null,
      execution: status.execution || null
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

const results = [];
try {
  for (const fixture of fixtures) {
    results.push(checkFixture(fixture));
  }
  if (jsonMode) {
    console.log(JSON.stringify({
      tool: "route-fixtures",
      summary: {
        fail_count: 0,
        fixture_count: fixtures.length
      },
      fixtures: results
    }, null, 2));
  } else {
    for (const result of results) console.log(`PASS ${result.name}`);
    console.log(`Route fixture tests passed: ${fixtures.length}`);
  }
} catch (error) {
  if (jsonMode) {
    console.log(JSON.stringify({
      tool: "route-fixtures",
      summary: {
        fail_count: 1,
        fixture_count: fixtures.length,
        completed_count: results.length
      },
      fixtures: results,
      error: error.message
    }, null, 2));
  } else {
    for (const result of results) console.log(`PASS ${result.name}`);
    console.error(`FAIL ${error.message}`);
  }
  process.exit(1);
}
