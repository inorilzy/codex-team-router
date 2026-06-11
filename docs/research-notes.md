# Research Notes

This file records external orchestration ideas that are useful for Codex Team
Router without turning the plugin into a separate runtime.

## Sources reviewed

- [Codex subagents](https://developers.openai.com/codex/subagents): Codex can
  spawn specialized agents in parallel for complex work, but only when the user
  explicitly asks for subagents.
- [Codex hooks](https://developers.openai.com/codex/hooks): hooks can add
  model-visible context and can deny supported tool calls, but `PreToolUse`
  remains a guardrail rather than a complete enforcement boundary.
- [Oh My OpenAgent orchestration guide](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/guide/orchestration.md):
  useful ideas include intent gates, planning/execution separation, plan review
  gates, and a lightweight decision flow before delegation.
- [Oh My OpenAgent docs](https://omo.dev/docs): useful ideas include routing by
  semantic task categories instead of raw model names, model fallback chains,
  and explicit specialist roles.
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents): useful
  ideas include separate context windows, clear subagent descriptions, restricted
  tool access, user/project/plugin scope, and persistent agent memory as an
  optional advanced feature.
- [OpenCode agents](https://opencode.ai/docs/agents/): useful ideas include
  common role shapes such as build, plan, review, debug, and docs agents, each
  with different permissions.
- [OpenAI Agents SDK orchestration](https://developers.openai.com/api/docs/guides/agents/orchestration):
  useful framing is choosing between handoffs and manager-owned agents-as-tools.
- [AWS Labs CLI Agent Orchestrator](https://github.com/awslabs/cli-agent-orchestrator):
  useful ideas include supervisor-worker coordination and isolated CLI agent
  sessions.
- [Warp multi-agent coding guide](https://docs.warp.dev/guides/agent-workflows/how-to-run-multiple-ai-coding-agents/):
  useful framing includes worktree/tab/cloud isolation and clear task ownership.
- [Ask149/orchestrator](https://github.com/Ask149/orchestrator): useful testing
  ideas include cross-platform config path resolution, temporary file handling,
  and secure permission defaults.
- [ccswarm](https://github.com/nwiizo/ccswarm): useful ideas include
  specialized agent pools, template-based scaffolding, and git worktree
  isolation for parallel development.
- [Squad](https://github.com/bradygaster/squad): useful ideas include
  repository-native agents represented as files, persistent decisions, and
  human-directed oversight.
- [Claude Swarm](https://github.com/affaan-m/claude-swarm): useful ideas
  include task decomposition, real-time coordination, and a visible terminal UI
  for multi-agent work.
- [awesome-codex-plugins](https://github.com/hashgraph-online/awesome-codex-plugins):
  useful ecosystem signal that Codex plugins are increasingly packaged around
  skills, hooks, and repo context.

## Adopted now

- Keep the main thread as coordinator, matching Codex's native subagent
  boundary.
- Route by intent, domain, and complexity before implementation.
- Use role profiles instead of scattering raw model names through prompts.
- Keep reviewer/verifier roles read-only.
- Add a compact `.codex/team-router/status.json` runtime summary so the user can
  inspect current route, agent counts, validation evidence, warnings, and next
  action without reading the full audit log.
- Add doctor checks for the runtime status summary and print actionable next
  steps for install/trust/template warnings.
- Add hook route fixtures so classifier changes can be regression tested without
  starting Codex App.
- Add local marketplace smoke install so packaging changes can be tested in a
  temporary `CODEX_HOME`.
- Add a source-only doctor mode and GitHub Actions workflow so pull requests can
  validate repository structure and hook behavior without local Codex config,
  trusted hooks, global agents, or model catalogs.
- Add a single source-check command and release checklist so source checks,
  install smoke tests, and environment-specific doctor runs are separated.
- Add a dry-run-first custom-agent template sync helper for project-local,
  global, or explicit target installs.
- Run doctor hook simulations in a temporary workspace so source checks do not
  leave `.codex/` state files in the repository.
- Add a repo hygiene check to keep README language split, marketplace identity,
  plugin identity, skill identity, and runtime artifact boundaries under CI.
- Add machine-readable JSON health reports for repo hygiene and doctor checks,
  then exercise those report modes from the single source-check command.
- Expand route fixtures to cover read-heavy `parallel_read`, `high_risk`, and
  explicit subagent authorization paths, not only common standard/complex
  prompts.
- Add machine-readable JSON output for route fixtures so routing regressions can
  be consumed by CI, dashboards, or external orchestrator adapters.
- Add an aggregate `check-source.mjs --json` report and run it in CI, following
  the same machine-readable status pattern used by CLI orchestrators.
- Version machine-readable report schemas with top-level `schema_version: 1`
  and have the aggregate source check reject child reports without it.
- Add a machine-readable `sync-agents.mjs --json` dry-run report so custom-agent
  template sync plans can be inspected by CI or external dashboards.
- Exercise `sync-agents.mjs --target <temp> --write --json` from the aggregate
  source check so the write path is continuously tested without touching user
  agent directories.

## Not adopted yet

- Detached worktree execution pools: useful for large parallel edits, but too
  heavy for this plugin's Codex-native scope.
- Mailbox/message-bus coordination: useful for autonomous teams, but unnecessary
  while Codex App already owns subagent spawning and result collection.
- Hash-anchored editing and AST/LSP rewriting: promising, but outside this
  plugin's current routing/hook responsibility.
- Persistent cross-session memory: useful later, but should stay opt-in because
  it changes privacy and state expectations.

## Candidate backlog

- Add a separate optional CI job that runs full install smoke tests when a Codex
  CLI binary is available.
- Add richer route fixtures for more edge-case prompt categories.
- Add a short comparison section to README once the public API and install path
  stabilize.
