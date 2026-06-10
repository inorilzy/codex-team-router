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

- Add a `scripts/smoke-install.mjs` helper for temporary `CODEX_HOME`
  marketplace install tests.
- Add richer route fixtures for hook classification regression tests.
- Add optional project-local agent template sync commands instead of only doctor
  warnings.
- Add a short comparison section to README once the public API and install path
  stabilize.
