---
id: phase-4-cli-report-json-scan-gate
level: task
title: "Phase 4: CLI report/JSON + scan/gate wiring"
short_code: "CIHA-T-0018"
created_at: 2026-08-01T00:13:06.540498+00:00
updated_at: 2026-08-01T00:51:14.540516+00:00
parent: CIHA-I-0003
blocked_by: []
archived: false

tags:
  - "#task"
  - "#phase/completed"


exit_criteria_met: false
strategy_id: NULL
initiative_id: CIHA-I-0003
---

# Phase 4: CLI report/JSON + scan/gate wiring

*This template includes sections for various types of tasks. Delete sections that don't apply to your specific use case.*

## Parent Initiative **[CONDITIONAL: Assigned Task]**

[[CIHA-I-0003]]

## Objective **[REQUIRED]**

Wire the projects layer into the CLI's `scan` and `gate` commands and reporting. Update `cli/format.ts` to print one block per project (name, score, existing metric breakdown table) plus the mean headline, and to emit `--json` with a `projects` array and a top-level mean `score`. Update `cli/commands/scan.ts` to iterate projects, aggregate the gate decision via `evaluateGateAll`, and call `writeLastScores` on overall PASS. This is the user-facing surface that turns the engine and gate work into the actual `ciha scan`/`ciha gate` experience.

## Acceptance Criteria

## Acceptance Criteria

## Acceptance Criteria **[REQUIRED]**

- [ ] `cli/format.ts` prints one block per project — name, score, and the existing metric breakdown table — followed by the mean headline line (REQ-004).
- [ ] `--json` output emits a `projects` array (each element carrying `name`, `score`, `breakdown`, and, in gate mode, `gate`) plus a top-level `score` equal to the mean (REQ-004).
- [ ] `cli/commands/scan.ts` iterates projects via `scanProjects`, and in gate mode aggregates the decision via `evaluateGateAll` (REQ-005).
- [ ] On overall PASS in gate mode, the command calls `writeLastScores` for all projects; on FAIL it writes nothing and prints each failing project (name, floor, actual, delta) to stderr and exits non-zero (REQ-005, REQ-006).
- [ ] Exit codes match today's contract: scan/report success exits 0; gate PASS exits 0; gate FAIL exits 1.
- [ ] Unit tests cover human formatting (multi-project + mean line), JSON shape (projects array + mean `score`), gate PASS triggering write, and gate FAIL suppressing write with the correct stderr message and exit code.

## Implementation Notes **[CONDITIONAL: Technical Task]**

### Execution profile
Recommended Agent: opus + medium

### Technical Approach
In `cli/format.ts`, wrap the existing single-project breakdown renderer in a loop over `ProjectsResult.projects`, prefixing each block with the project name and score, and append a mean headline line using the `score` field. For `--json`, serialize the `projects` array with per-project `name`/`score`/`breakdown` (and `gate` when in gate mode) plus the top-level mean `score`. In `cli/commands/scan.ts`, call `scanProjects` (Phase 2), and in gate mode feed per-project scores plus effective baselines into `evaluateGateAll` (Phase 3); on overall PASS call `writeLastScores` with a name→score map, on FAIL print the failing projects to stderr and exit 1. Keep the command thin — formatting stays in `format.ts`, decision logic stays in the gate module. See the initiative's Detailed Design (Reporting) and the Gate sequence flow.

### Dependencies
Depends on Phase 2 (CIHA-T-0016) for `scanProjects`/`ProjectsResult` and Phase 3 (CIHA-T-0017) for `evaluateGateAll` and `writeLastScores`. Feeds Phase 7 (CIHA-T-0021) integration tests and Phase 6 (CIHA-T-0020), which mirrors this reporting in the action.

### Verification steps
- Run the CLI format and command unit tests; confirm all pass.
- Run `ciha scan` against a local multi-project config and eyeball the per-project blocks and mean line.
- Run `ciha scan --json` and validate the JSON has a `projects` array and a top-level mean `score`.
- Run `ciha gate` in a PASS scenario and confirm `lastScore` values are written; run a FAIL scenario and confirm no writes, the stderr names the failing project, and exit code is 1.
- Run repo lint and typecheck with zero errors.

### Risk Considerations
- Decision or write logic leaking into the CLI command makes it hard to test; mitigate by delegating to the pure gate/write modules and keeping the command a thin orchestrator.
- Mean displayed in the report diverging from the action's `score` output; mitigate by consuming the same `ProjectsResult.score` computed in Phase 2.
- Regressing the existing single-project report format; mitigate by reusing the existing breakdown renderer unchanged inside the per-project loop.

## Status Updates **[REQUIRED]**

- **Completed** (opus + medium agent): Rewired the CLI onto the multi-project engine. `scan.ts` report mode calls `scanProjects` → per-project human/JSON output; gate mode builds per-project gate inputs (effective baselines/thresholds via `resolveProjects`, name-aligned), calls `evaluateGateAll`, and on overall PASS calls `writeLastScores(Map<name,score>)` then prints PASS; on FAIL prints report + failing projects to stderr, writes nothing, exit 1. `format.ts` renders one block per project + mean headline; JSON = top-level `score` (mean) + `projects[]` (name/score/breakdown/optional gate). `messages.ts` gained `passAllMessage`/`failAllMessage`. Cleared the CLI `loadConfigFile` first-project shim and CLI use of single `writeLastScore`/`scan` alias.
- **Gates:** lint + typecheck clean; `npm test` 179 passed / 16 files; `npm run build` + built-CLI smoke run green. Observed `scan --json`: `{"score":9.11,"projects":[{"name":".","score":9.11,"breakdown":{...}}]}`. No rule weakening; no `any`/ts-ignore.
- **Retained** (live non-CLI callers): engine `scan` alias + single `writeLastScore` remain public API with their own tests.