# JSON Reports

Codex Team Router scripts that support `--json` emit machine-readable reports
for CI, local dashboards, and external orchestrator adapters.

## Contract

Every JSON report uses a top-level `schema_version` field. The current schema is:

```json
{
  "schema_version": 1
}
```

Consumers should reject reports without `schema_version: 1`. The aggregate
`check-source.mjs --json` command already enforces this for child reports.

Common top-level fields:

- `tool`: report producer name.
- `schema_version`: report schema version. Current value is `1`.
- `summary.fail_count`: number of failing checks or operations.
- `summary.warn_count`: number of warnings, when the producer has warnings.
- `error`: failure message, only when the producer cannot complete normally.

Exit behavior:

- Exit code `0` means the report was produced and `summary.fail_count` is `0`.
- Non-zero exit code means the command failed or the report contains failures.
- JSON mode should write only JSON to stdout.

## Report Producers

| Command | Purpose | Notable summary fields |
| --- | --- | --- |
| `node plugins/codex-team-router/scripts/check-source.mjs --json` | Aggregate source-tree report | `check_count`, `text_check_count`, `json_check_count` |
| `node plugins/codex-team-router/scripts/route-fixtures.mjs --json` | Hook route regression report | `fixture_count` |
| `node plugins/codex-team-router/scripts/repo-hygiene.mjs --json` | Repository packaging and documentation hygiene | `check_count` |
| `node plugins/codex-team-router/scripts/doctor.mjs --source-only --json` | Source-only plugin health report | `check_count`, `warn_count` |
| `node plugins/codex-team-router/scripts/doctor.mjs --json` | Local profile health report | `check_count`, `warn_count` |
| `node plugins/codex-team-router/scripts/sync-agents.mjs --json` | Agent template sync dry-run report | `template_count`, `write_candidate_count`, `skipped_different_count` |
| `node plugins/codex-team-router/scripts/sync-agents.mjs --target <dir> --write --json` | Agent template sync write report | `template_count`, `write_candidate_count`, `skipped_different_count` |

## Aggregate Example

```powershell
$report = node plugins\codex-team-router\scripts\check-source.mjs --json | ConvertFrom-Json
$report.summary
```

Expected shape:

```json
{
  "tool": "check-source",
  "schema_version": 1,
  "summary": {
    "fail_count": 0,
    "warn_count": 0,
    "check_count": 8,
    "text_check_count": 3,
    "json_check_count": 5
  },
  "checks": []
}
```

## Compatibility

Schema `1` is additive by default: consumers should tolerate unknown fields and
focus on `tool`, `schema_version`, `summary.fail_count`, and the producer-specific
summary fields they need.

If a future report needs incompatible changes, bump `schema_version` and update:

- this document,
- `scripts/check-source.mjs`,
- `docs/release-checklist.md`,
- source checks that validate JSON reports.
