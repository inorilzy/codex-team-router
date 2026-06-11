---
name: codex-team-router
description: "Use as the explicit team-mode router for coding work when the user invokes `team`, `/team`, `团队模式`, or asks for this skill/plugin. Decide whether to stay in the main thread, spawn a bounded executor, or use visible Codex App planner/executor/reviewer subagents. Do not use for ordinary coding questions unless the hook injects CODEX_TEAM_ROUTER_ROUTE_REQUIRED or the user explicitly requests team/subagent routing."
---

# Codex Team Router

Use this skill as the explicit team-mode routing layer for engineering tasks.
It decides whether the main thread should handle the task directly or delegate
planning, implementation, review, research, or validation to visible native
Codex App subagents.

This skill is a coordination protocol. It does not call an external runner.
The main thread must use Codex App native `multi_agent_v1.spawn_agent`,
`multi_agent_v1.wait_agent`, `multi_agent_v1.send_input`, and
`multi_agent_v1.close_agent` tools when they are available and spawning is
authorized by the active tool policy.

If the `multi_agent_v1` namespace is not visible in the active tool list, do not
immediately fall back. First use the session's tool discovery mechanism when it
is available. In Codex App, call `tool_search` with a query like
`multi_agent_v1 spawn_agent native subagent Codex App`, then continue with
`multi_agent_v1.spawn_agent` if the namespace becomes available. Do not claim
native subagents are unavailable while `multi_agent_v1.spawn_agent` is present
or discoverable. If native tools are truly absent after discovery, still make
the routing decision and continue in the main thread or with the documented
fallback.

For `complex` or `high_risk` routes where subagent spawning is explicitly
authorized, hidden native tools are a discovery step, not a reason to set
`execution=main`. When `tool_search` is visible, run the discovery query before
finalizing any fallback route. The routing receipt should remain
`execution: subagents` only when spawning is authorized; otherwise make the
main-thread fallback explicit. If discovery makes
`multi_agent_v1.spawn_agent` available, continue with the native-tool
availability decision instead of treating discovery itself as a fallback.

If `multi_agent_v1.spawn_agent` exists but a preferred role such as `explorer`,
`planner`, `executor`, or `reviewer` returns "agent type is currently not
available", do not treat that as native subagents being unavailable. Retry once
with `agent_type: "default"` for read-only/planning/review tasks or
`agent_type: "worker"` for bounded implementation tasks, and put the intended
role and constraints in the subagent message. Only fall back to main-thread
execution if both the preferred role and the fallback role cannot be spawned.

## Core Rule

At the start of each use, make a routing decision before doing implementation
work:

```text
intent: <answer|investigate|implement|fix|review|plan|terminal>; domain: <general|visual|game|logic|writing|git|data|infra>; authorization: <auto|explicit|opt_out|blocked>
prompt_complexity: <low|medium|high|very_high>; signals: <short signals>
team_route: <trivial|small|standard|parallel_read|complex|high_risk>; execution: <main|executor|subagents>; reason: <short reason>
```

Every use of this skill must produce this visible routing receipt unless the
user explicitly forbids status text. This is the audit signal that distinguishes
"skill was not used" from "skill was used and routed to the main thread." For
user-facing exact-output tasks, keep the receipt concise or include it in the
final status instead of interrupting the requested artifact.

Native subagents are preferred inside team mode when prompt complexity shows
that delegation materially improves planning, implementation, review,
validation, or visible coordination in the Codex App subagent panel. By
default, the hook enters team mode only when the user starts with `team`,
`/team`, `团队模式`, or `使用 team`. Set `CODEX_TEAM_ROUTER_MODE=auto` to
restore automatic engineering-prompt detection. Explicit wording such as
subagents, delegation, parallel work, or planner/executor/reviewer still counts
as `authorization: explicit`; automatic hook selection is
`authorization: auto`.

A `UserPromptSubmit` hook injection containing
`CODEX_TEAM_ROUTER_ROUTE_REQUIRED` is routing context that requires the visible
routing receipt and prevents silent un-routed implementation. In default manual
mode, this marker is injected only for explicit team commands. In
`CODEX_TEAM_ROUTER_MODE=auto`, it may also be injected for detected engineering
prompts. For `standard`, `complex`, `high_risk`, or `parallel_read` routes, the
marker means the skill may spawn visible native Codex App subagents when that
is the chosen execution mode.

For `implement` and `fix` routes, `execution: subagents` means an executor or
worker subagent owns the primary file edits. Planner, analyst, reviewer, or
verifier sidecars may help, but they do not satisfy delegated implementation by
themselves. If the main thread performs the primary edits, use
`execution: main` in the routing receipt instead of reporting delegated
subagent execution.

Subagent routing has three gates, in this order:

1. User opt-out gate: if the user explicitly says not to use subagents,
   delegation, parallel work, or planner/executor/reviewer orchestration, set
   `authorization: opt_out` and use the main-thread fallback.
2. Risk confirmation gate: if the next step is destructive, irreversible,
   data-loss-prone, or broadly permission-changing, pause for user confirmation
   before spawning or editing. If the user confirms, continue to the native-tool
   availability gate. If the user declines or confirmation is not granted, emit
   the fallback receipt and continue with the documented main-thread fallback
   without spawning.
3. Native-tool availability gate: if `multi_agent_v1` is hidden, use
   `tool_search` before falling back, then return to the availability check. If
   discovery makes `multi_agent_v1.spawn_agent` available, spawn the bounded
   subagents required by the route. Use `execution=main` only after native
   subagent tools are confirmed unavailable after discovery or the active tool
   policy blocks spawning.

External `codex exec` workers are only a fallback when native subagent tools are
unavailable and spawning is authorized by the active tool policy.

Use the same routing bias OMO uses in its orchestrator prompts: delegate by
default for non-trivial engineering work, and work in the main thread only when
the task is demonstrably super simple. In this skill, "super simple" means a
single-step local task, a known file or command, no meaningful product/design
judgment, no cross-file dependency, and roughly less than 10 lines of obvious
change. "Single HTML file" or "one file only" limits the write scope; it does
not make a complex app or game super simple.

## Roles

- Use a project-specific `agent-registry.json` when present. If it is missing,
  use the default role table in `references/agent-registry.example.json`.
- Analyst: use before planning when the request has ambiguity, contradictions,
  missing constraints, or unclear topology.
- Planner: use `agent_type: "planner"` when spawning is authorized.
- Plan Reviewer: use after planner output when the plan itself needs a gate
  before execution.
- Executor: use `agent_type: "executor"` for bounded file edits.
- Reviewer: use `agent_type: "reviewer"` for independent review; ask for
  read-only behavior and findings-first output.
- Explorer: use `agent_type: "explorer"` for narrow codebase questions only.
- Verifier: use `agent_type: "verifier"` only for expensive, independent
  validation.

Role fallback: preferred role names are not guaranteed on every Codex App
surface. If a preferred `agent_type` is unavailable, use `default` for analyst,
planner, plan-reviewer, reviewer, explorer, or verifier style work; use `worker`
for executor style work. Preserve the role behavior in the task prompt:
"You are acting as the planner/reviewer/executor..." plus the same read/write
scope and output contract.

The built-in roles already carry their documented models and reasoning efforts.
Do not set `model` or `reasoning_effort` on `multi_agent_v1.spawn_agent` unless
the user explicitly asks for an override or there is a clear task-specific
reason.

## Agent Registry

This skill uses a lightweight Codex-native role registry inspired by
oh-my-openagent Team Mode and Codex Light ultrawork: a stable role table, a
canonical role order, eligibility rules, plan/review gates, explicit evidence,
and a runtime state file. Do not copy oh-my-openagent's full mailbox/worktree
system unless the user asks for that level of infrastructure.

Suggested files:

- `references/agent-registry.example.json`: default role table and template for
  project-specific `agent-registry.json` customization.
- `assets/codex-agents/*.toml`: bundled custom-agent templates for portable
  distribution with this skill.
- `assets/hooks/codex-team-router-hook.mjs`: optional hook helper for
  team-router health checks, audit logging, validation evidence, and completion
  gates.
- `assets/scripts/refresh-model-profiles.mjs`: optional model-profile checker
  that reads the local Codex model catalog and writes a generated profile report.
- Plugin `scripts/doctor.mjs`: installed-plugin health check for manifest hook
  discovery, Windows-safe hook commands, Codex config hints, and hook output
  smoke tests.
- `.codex/agents/*.toml`: project-scoped installed custom agents. These hold
  durable prompts, `model`, `model_reasoning_effort`, sandbox defaults, and
  nickname candidates for each role.
- `~/.codex/agents/*.toml`: global installed custom agents when the user wants
  the roles available outside one project.
- `references/run-state.example.json`: template for recording live native
  subagent runs.
- `references/hooks.example.json`: optional project-local hooks template.
- `references/model-profiles.example.json`: documented default profile mapping.

## Official Subagent Controls

Codex also has global subagent controls under `[agents]` in `config.toml`.
Check or recommend these settings when a workflow uses many agents:

- `agents.max_threads`: concurrent open agent thread cap. Codex defaults to `6`.
- `agents.max_depth`: nesting depth. Codex defaults to `1`; keep this unless the
  user explicitly wants recursive delegation.
- `agents.job_max_runtime_seconds`: default timeout for `spawn_agents_on_csv`
  worker jobs. Codex uses `1800` seconds when unset.

When the task is a large uniform batch, use CSV fan-out instead of hand-spawning
many role agents. Good CSV fan-out inputs include review points, file groups,
issue lists, log chunks, document sections, or test failures. Each row should
have a narrow task, owned scope or read scope, and expected summary format.
After CSV fan-out completes, the main thread still owns synthesis and final
verification.

Subagents inherit the current sandbox and approval policy. Runtime overrides set
in the parent session, including permission changes, can override defaults in a
custom agent file. Treat custom-agent `sandbox_mode` as a desired default, not
as proof of the effective runtime permissions.

## Model Profiles

Prefer role-to-profile mapping over scattering raw model names through the
registry. Native `multi_agent_v1` built-in roles already have fixed models, so
omit model overrides when spawning those roles. Use these profile names for the
registry, documentation, and custom-agent template installation, where TOML
files still need official literal fields:

- `smartest_deep`: `gpt-5.5` with `xhigh` reasoning for analyst, planner, and
  plan-reviewer work.
- `smartest_review`: `gpt-5.5` with `high` reasoning for reviewer work.
- `smart_code`: `gpt-5.4` with `high` reasoning for executor work.
- `smart_verify`: `gpt-5.4` with `medium` reasoning for verifier work.
- `fast_scan`: `gpt-5.4-mini` with `low` reasoning for explorer and lightweight
  fan-out work.

Codex custom agent TOML does not document variable interpolation, so do not put
profile names or environment variables in `model`. Resolve profiles before
installing or updating `.codex/agents/*.toml`, and write literal `model` and
`model_reasoning_effort` values there.

To check the current local Codex model catalog, run:

```bash
node assets/scripts/refresh-model-profiles.mjs
```

The script reads `~/.codex/cc-switch-model-catalog.json` by default, or
`CODEX_MODEL_CATALOG` when set, and falls back to
`~/.codex/models_cache.json` when the cc-switch catalog does not expose the
documented model defaults. It writes `references/model-profiles.generated.json`.
Treat the local catalogs as environment-specific visibility, not universal
account entitlement. If a documented default is missing after all local catalog
sources are checked, the script keeps the default and emits a warning for manual
review.

## Intent, Domain, And Task Routing

Before spawning agents, classify the task by difficulty and shape. This mirrors
OMO-style category routing while keeping Codex's documented subagent behavior:
the main thread decides whether delegation is worth it, then chooses bounded
roles and model profiles.

First analyze the user's current prompt content, not just the expected file
count. Do not carry implementation mode from a prior turn. Single-file output is
a scope constraint, not proof that the task is small.

Intent gate:

- `answer`: explanation or design opinion only. Explore if needed, then answer.
- `investigate`: look into, check, compare, or diagnose without an explicit fix.
  Use read-only exploration first and report findings.
- `implement`: build, create, add, write, modify, or change code/artifacts.
  Plan, decompose if non-trivial, then delegate or execute.
- `fix`: broken behavior, error message, failing test, or regression. Diagnose
  root cause, fix minimally, and verify.
- `review`: code review, plan review, QA review, or validation request. Use a
  reviewer/verifier when risk justifies it.
- `plan`: planning or breakdown request. Use planner for non-trivial work.
- `terminal`: simple shell command only. Main thread can run it directly.

Domain guess, finalized after minimal exploration:

- `visual`: UI, CSS, layout, animation, frontend components, visual polish.
- `game`: gameplay, physics, collision, scoring, levels, input loops.
- `logic`: algorithms, architecture, state machines, business logic.
- `writing`: docs, prose, README, technical writing.
- `git`: commits, branches, diffs, merge/rebase/release notes.
- `data`: SQL, spreadsheets, data transforms, schemas, reports.
- `infra`: CI, deployment, scripts, auth, permissions, services.
- `general`: none of the above or not yet clear.

Prompt complexity signals:

- `low`: simple question, tiny command, copy edit, style tweak, or a very small
  isolated bug fix.
- `medium`: bounded single feature, straightforward single-file UI, simple
  game mechanics such as clicker, tic-tac-toe, memory, basic snake, or a small
  CRUD flow.
- `high`: new complete user-facing app or game, multiple interacting states,
  physics, collision, drag interactions, timers, scoring, levels, generated
  assets, nontrivial validation, or more than one meaningful subsystem.
- `very_high`: ambiguous architecture, security-sensitive changes, destructive
  operations, large refactors, migrations, cross-service work, or complex
  concurrency/data-loss risk.

The hook layer must use generic complexity signals rather than a growing list of
project names. Treat a request as likely `high` when it asks to create a
complete user-facing artifact such as an HTML page, browser app, dashboard,
editor, visualization, game, tool, or demo and also implies interaction, state,
input handling, rendering, validation, or multiple visible subsystems. Proper
nouns such as a game title or product name are hints only; they must not be the
main routing mechanism.

For game prompts, classify by mechanics rather than file count:

- Simple arcade clones such as basic snake, pong, clicker, memory, or
  tic-tac-toe can remain `small` when the user asks for a quick version.
- New playable games with several mechanics are at least `complex`.
- Physics or collision games are `complex` by default. Angry Birds-style tasks
  are `complex` because they imply slingshot aiming, projectile motion,
  collision response, destructible or moving targets, scoring, level state, and
  restart/win/lose flow, even when delivered as one HTML file.

After this analysis, route by difficulty into a stable role lineup:

- `low`: main thread.
- `medium`: `planner` -> `executor` -> `reviewer`.
- `high`: `analyst` -> `planner` -> `plan-reviewer` -> `executor` -> `reviewer`.
- `very_high`: `analyst` -> `planner` -> `plan-reviewer` -> one or more
  `executor` agents -> `reviewer` -> `verifier`.

For `standard`, `complex`, and `high_risk` prompts, decompose the prompt into
role-sized work before implementation. `standard` uses the medium lineup.
`complex` uses the high lineup. `high_risk` uses the very-high lineup and may
split implementation across multiple executors with disjoint owned scopes.

For `medium`, `high`, or `very_high` implementation prompts, write a brief
decomposition before any edit:

```text
decomposition:
- surfaces: <files/features/systems likely affected>
- subtasks: <planner/executor/reviewer-sized units>
- dependencies: <what must happen before what>
- parallelism: <what can run independently>
- validation: <tests, build, browser/manual checks, review evidence>
```

Use the project registry's `task_routes` when present. If it is missing, use this
default route table:

- `trivial`: answer directly in the main thread. Use for simple questions, tiny
  terminal commands, explanations, or super-simple local changes where subagent
  overhead would not pay for itself.
- `small`: use only when prompt complexity is `low` and the self gate passes.
  Main thread may plan and implement directly for tiny local work.
- `standard`: use when prompt complexity is `medium`: bounded single features,
  straightforward single-file UI, simple arcade mechanics, or small CRUD flows.
  When the skill chooses subagent execution, spawn `planner`, `executor`, and
  `reviewer` in canonical order. Treat `CODEX_TEAM_ROUTER_ROUTE_REQUIRED` as
  team/auto routing authorization. Apply the subagent execution gates before
  spawning.
- `parallel_read`: when the skill chooses subagent execution, spawn one or more
  `explorer` agents or use CSV fan-out for read-heavy scans.
- `complex`: use when prompt complexity is `high`, even if output is a single
  file, or when an implementation prompt has two or more meaningful subtasks,
  product/design judgment, game mechanics, nontrivial validation, or likely
  >50 lines of coherent new work. When the skill chooses subagent execution,
  spawn `analyst`, `planner`, `plan-reviewer`, `executor`, and `reviewer` in
  canonical order. Treat `CODEX_TEAM_ROUTER_ROUTE_REQUIRED` as team/auto routing
  authorization. Apply the subagent execution gates before spawning.
- `high_risk`: spawn `analyst`, `planner`, `plan-reviewer`, one or more
  `executor` agents, `reviewer`, and `verifier` when subagent tools are
  available, but pause for user confirmation before destructive operations,
  irreversible migrations, broad permission changes, or data-loss risks. Use
  plan/review gates and require validation evidence before completion.

Route conservatively for casual or tiny tasks, but do not let "single file" hide
real prompt complexity. If the user explicitly invokes `Codex Team Router`,
selects the plugin for a coding task, or the hook injects
`CODEX_TEAM_ROUTER_ROUTE_REQUIRED`, always emit the routing receipt and apply
the complexity-based delegation policy. A `team`, `/team`, `团队模式`, or
`使用 team` command marks the receipt as `authorization: explicit`; auto-mode
hook selection marks it as `authorization: auto`. Do not use "no explicit
subagent wording" as a reason to stay in the main thread after the marker
exists for `standard`, `complex`, `high_risk`, or `parallel_read` prompts.
Instead, apply the three subagent execution gates:
respect user opt-out, pause for high-risk confirmation, then discover/check
`multi_agent_v1`. If a high-risk confirmation is granted, continue to the
native-tool availability check; if confirmation is declined or not granted,
emit the fallback receipt and use the documented main-thread fallback. If
`multi_agent_v1` is hidden, run `tool_search`, then return to the same
availability decision instead of treating discovery itself as a fallback. If
native subagent tools are unavailable after discovery, or the active policy
still blocks spawning, state that fallback explicitly in the routing receipt and
continue in the main thread.

This skill may be combined with domain-specific skills such as frontend,
documents, GitHub, or spreadsheet skills. Route first, then let the domain skill
guide the implementation details.

## Custom Agent Templates

The `.toml` files in `assets/codex-agents/` are templates bundled with the
skill for portability. They are not assumed to be automatically discoverable by
Codex App while they remain inside the skill folder.

When a matching custom agent is not already installed, copy the needed template
from `assets/codex-agents/` to one of these locations:

- Project-local: `.codex/agents/`
- Global: `~/.codex/agents/`

Prefer project-local installation when the workflow should stay tied to one
repository. Prefer global installation when the user wants these team roles
available everywhere. Do not overwrite existing custom agents unless the user
explicitly asks for that.

When this skill is installed as a plugin, prefer the bundled sync helper instead
of manual copying:

```bash
node scripts/sync-agents.mjs
node scripts/sync-agents.mjs --write
node scripts/sync-agents.mjs --global --write
```

The sync helper is dry-run by default. It copies missing files with `--write`
and overwrites changed files only with `--force --write`.

If a custom agent name matches a built-in agent such as `explorer`, the custom
agent takes precedence. Call this out before installing templates that shadow
built-in names.

Custom agent files can also include normal Codex config keys such as
`mcp_servers` and `skills.config`. Use that sparingly to make roles narrower:
for example, give `explorer` read-heavy search tools, keep `reviewer` read-only,
and avoid broad external tool access for `executor` unless the task needs it.

Registry rules:

- The role table is stable and maintained by the user or project.
- Codex App generates `nickname` and `agent_id` only after
  `multi_agent_v1.spawn_agent`.
- The main thread records the mapping from `role_id` to `nickname` and
  `agent_id` in the run state.
- Prefer role categories over model names. Let the native agent type express the
  execution surface: `default`, `worker`, or `explorer`.
- Prefer spawning the `custom_agent` named in the registry when available. Use
  `native_agent_type` as the fallback.
- If `native_agent_type` is unavailable at spawn time, retry once with
  `default` for read-only roles or `worker` for implementation roles.
- Respect each role's `eligibility`, `write_scope_policy`, `reuse_policy`, and
  `close_policy`.
- Do not spawn roles marked `hard_reject`.

## Optional Hooks Layer

The skill works without hooks. Add hooks when the user wants explicit team
commands, optional automatic team routing, health checks, audit logging,
lifecycle tracking, policy checks, or completion gates.

When this skill is installed from the `codex-team-router` plugin, Codex can
load the bundled plugin hooks from `hooks/hooks.json` after the user reviews and
trusts them with `/hooks`. The bundled plugin hooks are intentionally minimal:
they track session and subagent lifecycle without running before and after every
tool call. They call the bundled script through `PLUGIN_ROOT`, so they do not
require copying files into each project.

To install the bundled hook helper in a project:

1. Copy `assets/hooks/codex-team-router-hook.mjs` to
   `.codex/hooks/codex-team-router-hook.mjs`.
2. Copy or merge `references/hooks.example.json` into `.codex/hooks.json`.
3. Review and trust the hook definitions with `/hooks` when Codex asks.

The hooks are mostly warn-only by default, with one deliberate gate:
`UserPromptSubmit` adds routing context only when the prompt explicitly enters
team mode, unless `CODEX_TEAM_ROUTER_MODE=auto` restores engineering-prompt
detection. The visible routing receipt remains the proof that the skill was
used. `PreToolUse` is warn-only by default for
`standard`, `complex`, and `high_risk` routed prompts: it reminds the model to
emit the receipt and apply the automatic routing gates before direct writes.
Set `CODEX_TEAM_ROUTER_SUBAGENT_GATE=enforce` only when you intentionally want
this reminder to use Codex's documented `permissionDecision: "deny"` output for
direct file writes until the route-required subagent has started. For
`implement` and `fix` routes, that means an executor or worker, not only a
planner or reviewer. Set
`CODEX_TEAM_ROUTER_SUBAGENT_GATE=off` to disable the gate. Set
`CODEX_TEAM_ROUTER_HOOK_MODE=enforce` only when the project has tested the hook
behavior and wants risky-command warnings to fail the hook command. The legacy
`SQUAD_SUBAGENT_GATE` and `SQUAD_HOOK_MODE` environment variable names remain
accepted as compatibility aliases.

Default plugin hook responsibilities:

- `UserPromptSubmit`: in default manual mode, detect explicit `team`, `/team`,
  `团队模式`, or `使用 team` commands, write
  `.codex/team-router/current-run.json` with `route_required`, and inject
  `CODEX_TEAM_ROUTER_ROUTE_REQUIRED` through
  `hookSpecificOutput.additionalContext`. With `CODEX_TEAM_ROUTER_MODE=auto`,
  the hook also detects likely engineering prompts. For standard, complex,
  high_risk, or parallel_read routes, that marker is routing context for the
  skill's subagent policy, subject to opt-out, high-risk confirmation, and
  native-tool availability gates.
- `SessionStart`: write `.codex/team-router/health.json`, initialize or
  resume `.codex/team-router/current-run.json`, and report missing project
  custom-agent templates.
- `PreToolUse`: warn once when implementation-like tool use starts after a
  prompt was marked for team routing. For standard/complex/high-risk routed
  prompts, warn by default before direct writes until the receipt/subagent
  decision is visible. In strict opt-in mode, block direct writes until the
  route-required subagent has started. For implementation and fix routes,
  planner/reviewer-only sidecars do not satisfy `execution: subagents`;
  primary edits require an executor/worker or an explicit `execution: main`
  fallback.
- `SubagentStart`: append lifecycle evidence when a child agent starts.
- `SubagentStop`: mark the matching running agent complete when possible.
- `Stop`: write `.codex/team-router/completion-gate.json` and warn when
  agents are still running or changed files lack validation evidence.
Every state write also refreshes `.codex/team-router/status.json`, a compact
human-readable summary containing the current route, prompt preview, agent
counts, validation evidence count, warning count, task board, and next action.

Optional project-local audit hooks can add `PermissionRequest` and `PostToolUse`
for stricter risky-command checks and
validation evidence capture. Keep extra tool hooks minimal because they fire on
every matching tool call and make the Codex App hooks panel noisy.

The hook helper is intentionally conservative because Codex hook payloads may
vary by surface and version. Keep the main thread responsible for final judgment
and do not claim completion until current files and evidence have been inspected.

When debugging a plugin install, run the plugin doctor from the plugin source or
cache root:

```bash
node scripts/doctor.mjs
```

The doctor checks the explicit manifest hook path, Windows-safe direct Node hook
commands, config hints, trusted hook entries, and simulated
`UserPromptSubmit`/`PreToolUse` JSON output. It does not replace `/hooks`
review/trust in Codex App, and it cannot spawn a native subagent by itself.

Default canonical order:

1. `analyst` when ambiguity or missing constraints would weaken the plan
2. `planner`
3. `plan-reviewer` when the plan is large enough to gate
4. `executor`
5. `reviewer`
6. `verifier`

Fast mode for low-complexity tasks:

1. Classify intent, domain, and prompt complexity from the current prompt.
2. Route as `small` only when the self gate passes.
3. Main thread plans directly only for super-simple local work.
4. Main thread verifies and reports.

Standard mode for medium-complexity tasks:

1. Classify intent, domain, and prompt complexity as `medium`, then route as
   `standard`.
2. Write a brief decomposition block before implementation.
3. Spawn `planner`.
4. Spawn `executor` with explicit owned files or directories.
5. Spawn `reviewer` after implementation.
6. Main thread integrates, verifies, reports, and closes agents.

Full mode for high-complexity tasks:

1. Classify intent, domain, and prompt complexity as `high` or `very_high`, then
   route as `complex` or `high_risk`.
2. Write the decomposition block before implementation.
3. Spawn `analyst`.
4. Spawn `planner`.
5. Spawn `plan-reviewer`; iterate the plan at most twice before asking the user
   or simplifying.
6. Spawn one `executor` for `complex`, or one or more disjoint `executor` agents
   for `high_risk`, only after explicit delegation/subagent authorization.
7. Spawn `reviewer` after implementation.
8. Spawn `verifier` for `high_risk`; use it for `complex` only when independent
   validation is worth the extra latency.
9. Main thread applies/requests fixes, verifies, reports, and closes agents.

Gate rules:

- Analyst verdict `needs user decision`: stop and ask the user.
- Plan Reviewer verdict `REJECT`: stop and surface the blocker.
- Plan Reviewer verdict `ITERATE`: ask planner or main thread to patch the plan,
  then review again. Do not loop more than twice.
- Reviewer verdict `rework`: send a bounded fix request to the executor.
- Verifier verdict `rejection`: report the missing or failing evidence before
  claiming completion.

## Workflow

1. Classify current-turn intent and domain.
2. Analyze prompt complexity: `low`, `medium`, `high`, or `very_high`.
3. Apply the self gate: direct main-thread execution is allowed only for
   super-simple local work, explanation-only work, or simple terminal commands.
4. Classify the task route: `trivial`, `small`, `standard`, `parallel_read`,
   `complex`, or `high_risk`.
5. Decompose `standard`, `complex`, and `high_risk` prompts into role-sized
   work before implementation.
6. State a short plan before spawning agents.
7. Apply the subagent execution gates in order:
   user opt-out -> high-risk confirmation -> native-tool availability.
   When high-risk confirmation is granted, continue to the native-tool
   availability check; when confirmation is declined or not granted, use the
   documented main-thread fallback. When `multi_agent_v1` is hidden, run
   `tool_search` and then repeat the native-tool availability decision before
   falling back.
8. Spawn only concrete, bounded subagents that materially advance the task and
   are authorized by the user's explicit request or plugin-selected prompt.
9. For coding workers, assign explicit owned files or directories.
10. Tell workers they are not alone in the workspace and must not revert unrelated
   changes.
11. Prefer disjoint write scopes for parallel executors.
12. Keep the main thread responsible for integration, final review, and user
    communication.
13. Wait only when the next main-thread step genuinely needs the subagent result.
14. After every `multi_agent_v1.spawn_agent`, record the role, nickname, agent
    id, responsibility, write scope, start time, and status in run state when
    the user wants traceability.
15. Close agents when they are no longer needed.

## Prompt Templates

Prefer installed custom agents from `.codex/agents/*.toml` or
`~/.codex/agents/*.toml`. If they are unavailable, install the bundled templates
from `assets/codex-agents/*.toml`, or use these lightweight prompts only for a
one-off fallback.

### Analyst

```text
You are the analyst subagent. Do not edit files.
Find contradictions, ambiguity, missing constraints, execution risks, topology
gaps, and safe assumptions. Return a verdict: clear, gaps found, or needs user
decision.
```

### Planner

```text
You are the planner subagent. Do not edit files.
Task:
...
Return:
- task boundaries
- proposed worker split
- owned files
- dependency graph
- parallel execution waves
- validation plan
- risks
```

### Plan Reviewer

```text
You are the plan reviewer subagent. Do not edit files.
Check whether the plan is executable: references, owned scopes, dependency
sanity, and QA executability. Return OKAY, ITERATE, or REJECT with at most three
issues.
```

### Executor

```text
You are an executor subagent. Edit files directly.
You are not alone in the workspace; do not revert unrelated edits.
Owned files:
- ...
Task:
...
Return:
- changed paths
- behavior changes
- commands run
- validation results
- open issues
```

### Reviewer

```text
You are an independent reviewer subagent. Do not edit files.
Review against the task contract and changed files.
Return findings first:
- severity
- blocking status
- required fixes
- missing validation
- missing evidence
```

## Reporting

In the main thread, report:

- spawned subagent nicknames and ids
- each agent's role
- run id when a run-state record was maintained
- final status
- changed files
- review findings
- main-thread verification

Do not claim completion until the main thread has inspected current files and
run appropriate verification.
