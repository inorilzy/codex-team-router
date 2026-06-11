# Changelog

All notable changes to Codex Team Router are documented here.

This project is currently pre-release. Entries are grouped under `Unreleased`
until the first tagged release is cut.

The format follows the human-readable changelog style described by
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- Codex plugin packaging for `codex-team-router@codex-team-router`.
- `codex-team-router` skill for engineering task routing before implementation.
- Plugin hooks for prompt routing, session health, pre-tool reminders,
  subagent lifecycle evidence, and completion gate state.
- Custom-agent templates for analyst, planner, plan-reviewer, executor,
  reviewer, explorer, and verifier roles.
- Route fixtures for terminal-only prompts, casual chat, plugin review,
  standard UI work, `parallel_read`, complex games, `high_risk`, and explicit
  subagent authorization.
- `doctor.mjs`, `repo-hygiene.mjs`, `route-fixtures.mjs`, `sync-agents.mjs`,
  and `check-source.mjs` health and release validation helpers.
- Machine-readable JSON reports with top-level `schema_version: 1`.
- Cross-platform GitHub Actions source checks on Ubuntu and Windows.
- English README, Chinese README, JSON report contract, release checklist, and
  research notes.

### Changed

- Aligned hook and skill language with Codex's explicit subagent authorization
  boundary.
- Added model catalog fallback from `cc-switch-model-catalog.json` to
  `models_cache.json`.
- Kept verifier custom-agent templates explicitly read-only.
- Added source-only checks so CI can validate the repository without a local
  Codex profile, trusted hooks, global custom agents, or model catalog.
