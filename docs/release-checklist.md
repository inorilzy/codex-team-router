# Release Checklist

Use this checklist before publishing a Codex Team Router change.

## Source checks

These checks do not require a local Codex install, trusted hooks, global custom
agents, or a model catalog:

```powershell
node plugins\codex-team-router\scripts\check-source.mjs
```

The command runs:

- `scripts/route-fixtures.mjs`
- `scripts/repo-hygiene.mjs`
- `scripts/doctor.mjs --source-only`
- `scripts/repo-hygiene.mjs --json`
- `scripts/doctor.mjs --source-only --json`

## Plugin validation

When Codex's local validation helpers are available, run:

```powershell
python $env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\quick_validate.py plugins\codex-team-router\skills\codex-team-router
python $env:USERPROFILE\.codex\skills\.system\plugin-creator\scripts\validate_plugin.py plugins\codex-team-router
```

## Local install smoke test

Run this before publishing packaging or marketplace changes:

```powershell
node plugins\codex-team-router\scripts\smoke-install.mjs
```

This creates a temporary `CODEX_HOME`, adds the local marketplace, installs
`codex-team-router@codex-team-router`, and checks that Codex reports it as
installed and enabled.

## Agent template sync check

Preview project-local template sync:

```powershell
node plugins\codex-team-router\scripts\sync-agents.mjs
```

The command should be a dry-run unless you are intentionally installing or
updating templates. Use `--write` to copy missing files, and use
`--force --write` only when overwriting changed files is intended.

## Local environment doctor

Run the full doctor when testing your own Codex profile:

```powershell
node plugins\codex-team-router\scripts\doctor.mjs
```

Warnings about plugin install state, hook trust, or global custom-agent drift
are environment-specific. They should be fixed before relying on that local
profile, but they are not source-tree failures.

## Publish

Commit the changes, then push:

```powershell
git status --short --branch
git add .
git commit -m "<change summary>"
git push
```

After push, confirm the `Source Check` workflow passed on both Ubuntu and
Windows on GitHub.
