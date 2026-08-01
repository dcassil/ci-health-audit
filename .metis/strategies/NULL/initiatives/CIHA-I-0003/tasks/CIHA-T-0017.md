---
id: phase-3-gate-evaluategateall-multi
level: task
title: "Phase 3: Gate evaluateGateAll + multi-project writeLastScores"
short_code: "CIHA-T-0017"
created_at: 2026-08-01T00:13:02.887709+00:00
updated_at: 2026-08-01T00:44:43.963008+00:00
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

# Phase 3: Gate evaluateGateAll + multi-project writeLastScores

*This template includes sections for various types of tasks. Delete sections that don't apply to your specific use case.*

## Parent Initiative **[CONDITIONAL: Assigned Task]**

[[CIHA-I-0003]]

## Objective **[REQUIRED]**

Implement the multi-project gate aggregation and atomic multi-field write-back. Add `evaluateGateAll(perProject)`, which reuses the existing pure `evaluateGate` once per project (each against its own effective baseline and threshold, with the `lastScore === 0` seeding rule applied per project) and aggregates to an overall FAIL if any project fails. Add `writeLastScores(configPath, scoresByName)` that atomically updates every project's `lastScore` in one pass, preserving array and key order and formatting. Together these deliver fail-if-any gating and safe baseline advancement.

## Acceptance Criteria

## Acceptance Criteria

## Acceptance Criteria **[REQUIRED]**

- [ ] `gate/evaluate.ts` adds `evaluateGateAll(perProject)` that calls the existing pure `evaluateGate` once per project, each against its own effective `lastScore` and `threshold` (REQ-005).
- [ ] The per-project `lastScore === 0` seeding rule is applied independently per project (NFR-001).
- [ ] Overall `decision` is FAIL if and only if any project fails; the result is a `GateAllResult` with an overall `decision` plus a `projects` array (each element carrying `name` and its per-project `gate` result) (REQ-005).
- [ ] The FAIL data names each failing project with its floor and delta so the CLI can print them to stderr (REQ-005).
- [ ] `gate/writeConfig.ts` adds `writeLastScores(configPath, scoresByName)` that reads the config, matches each `projects[i]` by `name`, updates its `lastScore` rounded to one decimal, re-serializes with two-space indentation preserving array and key order, and writes atomically via temp file plus fsync plus rename (REQ-006, NFR-003).
- [ ] On partial failure the config is never corrupted and the temp file is cleaned up (NFR-003).
- [ ] Unit tests cover: all-pass, one-fail-fails-overall, per-project seeding at `lastScore` 0, multi-project write update, key/array order and formatting preserved, and atomic temp cleanup on simulated failure. New module lines/branches at the repo's ~100% bar.

## Implementation Notes **[CONDITIONAL: Technical Task]**

### Execution profile
Recommended Agent: opus + medium

### Technical Approach
Keep the existing pure `evaluateGate` untouched and build `evaluateGateAll` as a thin aggregator over an ordered array of per-project inputs (name plus that project's `ScanResult` score plus its effective `lastScore`/`threshold` from Phase 1). Aggregate with fail-if-any and carry each project's `GateResult` (including floor and delta) so the CLI layer can render the FAIL message. For `writeLastScores`, extend the current atomic writer: parse the config, locate each project by `name`, set `lastScore` rounded to one decimal (matching today's single-root rounding), and re-serialize with `JSON.stringify(obj, null, 2)` so array order and key order survive. Reuse the existing temp-file + fsync + rename strategy verbatim to preserve NFR-003. Call `writeLastScores` only on overall PASS; on FAIL write nothing. See the initiative's Detailed Design (Gate, Write-back).

### Dependencies
Depends on Phase 1 (CIHA-T-0015) for effective baselines/thresholds and the `projects` schema, and on Phase 2 (CIHA-T-0016) for the per-project `ScanResult` scores the gate consumes. Must land before Phase 4 (CIHA-T-0018), which calls both functions from the CLI.

### Verification steps
- Run the new `evaluateGateAll` and `writeLastScores` unit test files; confirm all pass.
- Assert a two-project case where one regresses returns overall FAIL and names that project with floor and delta.
- Assert a multi-project write updates every `lastScore`, rounds to one decimal, and leaves array/key order and two-space formatting byte-identical except the changed numbers.
- Simulate a rename/fsync failure and assert the original config is intact and the temp file is removed.
- Run repo lint and typecheck with zero errors.

### Risk Considerations
- Serialization drift (reordered keys, changed indentation) would create noisy diffs in consumer configs. Mitigate with a formatting-preservation test asserting only the numbers change.
- Name-matching mismatch between scored projects and config entries could write the wrong `lastScore`. Mitigate by matching strictly on unique `name` (guaranteed by Phase 1) and failing loudly on an unmatched name.
- Atomicity regression if the writer is re-implemented rather than reused. Mitigate by extending the existing atomic writer rather than writing a new path.

## Status Updates **[REQUIRED]**

- **Completed** (opus + medium agent): Added pure `evaluateGateAll(perProject)` reusing `evaluateGate` per project (independent `lastScore===0` seeding), returning a `GateAllResult` (overall `decision` = fail iff any project fails + ordered per-project `GateResult`s carrying name/floor/seeded). Added atomic `writeLastScores(configPath, Map<name,score>)` — matches each project by name, rounds to one decimal, preserves array+key order + 2-space indent + trailing newline, via a shared extracted `atomicWrite` (temp+fsync+rename); throws on unmatched name / non-object / missing projects. New exports from `src/index.ts`.
- **Gates:** lint + typecheck clean; `npm test` 175 passed / 16 files; both gate modules 100% covered. No rule weakening; explicit `unknown` narrowing (no `any`/ts-ignore).
- **Flag for Phase 4 (CIHA-T-0018):** old single `writeLastScore` retained (shares `atomicWrite`); `src/cli/commands/scan.ts` still calls it — rewire onto `writeLastScores` + `evaluateGateAll` in Phase 4.