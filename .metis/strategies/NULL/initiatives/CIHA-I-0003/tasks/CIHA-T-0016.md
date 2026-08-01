---
id: phase-2-engine-scanprojects
level: task
title: "Phase 2: Engine scanProjects + ProjectsResult"
short_code: "CIHA-T-0016"
created_at: 2026-08-01T00:13:01.444942+00:00
updated_at: 2026-08-01T00:40:12.154194+00:00
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

# Phase 2: Engine scanProjects + ProjectsResult

*This template includes sections for various types of tasks. Delete sections that don't apply to your specific use case.*

## Parent Initiative **[CONDITIONAL: Assigned Task]**

[[CIHA-I-0003]]

## Objective **[REQUIRED]**

Add the projects orchestration layer above the proven single-root engine. Extract today's `scan` body verbatim as `scanOne(effectiveConfig)`, then add `scanProjects(config)` that resolves projects and maps `scanOne` over them in declared order, returning a `ProjectsResult` (per-project name/srcDir/result plus a numeric headline `score` equal to the arithmetic mean of project scores). This preserves purity — no writes, no exit, no network — and gives downstream gate/format phases a stable contract.

## Acceptance Criteria

## Acceptance Criteria

## Acceptance Criteria **[REQUIRED]**

- [ ] `index.ts` renames today's `scan` internals to `scanOne(effectiveConfig)` with behavior byte-identical to the current single-root scan (REQ-003, NFR-002).
- [ ] `scanProjects(config)` resolves projects via `resolveProjects` and runs `scanOne` once per project in declared config order (REQ-003, NFR-001).
- [ ] `scanProjects` returns a `ProjectsResult`: a `projects` array where each element carries `name`, `srcDir`, and its `result` (a `ScanResult`), plus a numeric `score` equal to `round(sum of project scores / n, 2)` — the arithmetic mean (REQ-004).
- [ ] `ProjectsResult` type is exported from `index.ts` for downstream phases.
- [ ] Purity preserved: `scanProjects` performs no writes, no `process.exit`, and no network; only the injected `CommandRunner` is impure, exactly as `scan` today (NFR-002).
- [ ] Unit tests with an injected fake `scanOne` cover: declared order preserved, mean computed correctly, and a one-project config yielding the same single score as today. New module lines/branches at the repo's ~100% bar.

## Implementation Notes **[CONDITIONAL: Technical Task]**

### Execution profile
Recommended Agent: opus + high

### Technical Approach
In `index.ts`, lift the existing `scan` function body into `scanOne(effective: EffectiveProjectConfig): ScanResult` with no behavioral change — it stays unaware of projects. Add `scanProjects(config)` that calls `resolveProjects(config)` (Phase 1) to get effective configs in order, maps `scanOne` over them sequentially, and assembles the `ProjectsResult`. Compute the headline `score` as the arithmetic mean of the per-project scores rounded to two decimals, matching the initiative's Detailed Design (Engine). Keep the `CommandRunner` injection seam so tests inject a fake and nothing shells out. Do not introduce Map/Set iteration in the result path; iterate the ordered array to satisfy NFR-001.

### Dependencies
Depends on Phase 1 (CIHA-T-0015) for `resolveProjects`, `EffectiveProjectConfig`, and the `projects` schema. Must land before Phase 3 (CIHA-T-0017) and Phase 4 (CIHA-T-0018), which consume `ProjectsResult` and the per-project results.

### Verification steps
- Run the new `scanProjects` unit test file with an injected fake `scanOne`; confirm all pass.
- Assert a three-project fixture scores in declared order and the mean equals the expected rounded value.
- Assert a one-project config produces a `ProjectsResult` whose single project score equals the v0.1 single-root score for the same input.
- Grep the new code path to confirm no `writeFile`, `process.exit`, or network calls exist in `scanProjects`.
- Run repo lint and typecheck with zero errors.

### Risk Considerations
- Accidental behavior drift when extracting `scanOne`: mitigate by moving the body verbatim and relying on the existing engine tests plus a one-project equivalence test.
- Mean rounding mismatch with reporting/action expectations: fix the rounding contract here (two decimals) and reference it from Phases 4 and 6.
- Hidden impurity creeping in via a helper: keep the `CommandRunner` seam and assert purity in tests.

## Status Updates **[REQUIRED]**

- **Completed** (opus + high agent): Extracted the single-project scan body verbatim as `scanOne(config, opts)` and added `scanProjects(config, opts): Promise<ProjectsResult>` — resolves projects, runs `scanOne` per project in declared order, returns per-project results (`name`/`srcDir`/`result`) plus a headline `score` = arithmetic mean rounded to 2 decimals (single rounding step). Replaced the Phase-1 `scanWithRawConfig` shim so the engine no longer drops to `projects[0]`. New exports: `scanOne`, `scanProjects`, `ProjectsResult`, `ProjectResult`, `ScanOneFn`, `ScanProjectsOptions`; `scan` kept as alias of `scanOne` for the not-yet-rewired CLI seam.
- **Gates:** lint + typecheck clean; `npm test` 165 passed / 16 files. No rule weakening; no `any`/ts-ignore. Fake-`scanOne` unit tests cover order, carry-through, mean rounding, one-project identity, and no-mutation.
- **Flag for Phase 4 (CIHA-T-0018):** `src/cli/loadConfigFile.ts` and `src/cli/commands/scan.ts` still use the single-project path via the `scan` alias — CLI rewire onto `scanProjects` is Phase 4 scope.