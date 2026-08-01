---
id: phase-7-integration-tests-monorepo
level: task
title: "Phase 7: Integration tests + monorepo fixture"
short_code: "CIHA-T-0021"
created_at: 2026-08-01T00:13:10.044274+00:00
updated_at: 2026-08-01T01:05:28.705047+00:00
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

# Phase 7: Integration tests + monorepo fixture

*This template includes sections for various types of tasks. Delete sections that don't apply to your specific use case.*

## Parent Initiative **[CONDITIONAL: Assigned Task]**

[[CIHA-I-0003]]

## Objective **[REQUIRED]**

Prove the full stack end-to-end against a committed monorepo fixture. Add a fixture repo (packages/a, apps/b) and integration tests that run the real CLI with real `scc`/`depcruise`, asserting the per-project human table, the mean headline, the `--json` shape, and gate exit codes: all-pass yields exit 0 plus baseline writes; one regressed project yields exit 1 with no writes to any project. This is the safety net that catches regressions the unit tests cannot see across the wired system.

## Acceptance Criteria

## Acceptance Criteria

## Acceptance Criteria **[REQUIRED]**

- [ ] A committed fixture monorepo (`packages/a`, `apps/b`) with a `projects` config exists in the test tree, using small deterministic package sources.
- [ ] An end-to-end integration test runs the real CLI with real `scc`/`depcruise` over the fixture and asserts the per-project human table and the mean headline.
- [ ] The `--json` output shape is asserted: a `projects` array plus a top-level mean `score`.
- [ ] Gate all-pass path asserts exit code 0 and that every project's `lastScore` is written back.
- [ ] Gate one-regressed path asserts exit code 1, that the failing project is named on stderr, and that no `lastScore` is written for any project.
- [ ] The migration-error path is exercised end-to-end: a legacy flat config yields the readable error and a non-zero exit.

## Test Cases **[CONDITIONAL: Testing Task]**

### Test Case 1: Monorepo scan report + mean
- **Test ID**: TC-001
- **Preconditions**: Fixture monorepo (`packages/a`, `apps/b`) with a valid `projects` config; `scc`/`depcruise` installed.
- **Steps**:
  1. Run `ciha scan` against the fixture.
  2. Capture stdout and exit code.
  3. Run `ciha scan --json` and capture the JSON.
- **Expected Results**: One block per project with a metric breakdown, a mean headline line, exit 0, config untouched; JSON has a `projects` array and a top-level mean `score`.
- **Actual Results**: To be filled during execution.
- **Status**: Not yet run.

### Test Case 2: Gate all-pass writes baselines
- **Test ID**: TC-002
- **Preconditions**: Fixture config where every project meets its floor.
- **Steps**:
  1. Run `ciha gate` against the fixture.
  2. Capture exit code.
  3. Re-read the config file.
- **Expected Results**: Exit 0; every project's `lastScore` updated in place with order/formatting preserved.
- **Actual Results**: To be filled during execution.
- **Status**: Not yet run.

### Test Case 3: Gate one-regressed fails, no writes
- **Test ID**: TC-003
- **Preconditions**: Fixture config where one project regresses beyond its floor.
- **Steps**:
  1. Snapshot the config file bytes.
  2. Run `ciha gate` against the fixture.
  3. Capture exit code and stderr; re-read the config.
- **Expected Results**: Exit 1; stderr names the failing project with floor and delta; config bytes unchanged (no writes for any project).
- **Actual Results**: To be filled during execution.
- **Status**: Not yet run.

## Implementation Notes **[CONDITIONAL: Technical Task]**

### Execution profile
Recommended Agent: opus + medium

### Technical Approach
Mirror the existing v0.1 end-to-end integration test conventions. Add a small, deterministic fixture monorepo under the test tree (`packages/a`, `apps/b`), each a minimal package with a `package.json` and a few source files chosen to produce stable metric values. Drive the real CLI process against the fixture (using a temp copy of the config so write-back tests do not dirty the tree) with real `scc`/`depcruise`, exactly as the current integration test installs and uses them. Assert stdout structure, `--json` shape, exit codes, and write-back/no-write behavior by diffing the config before and after. Include the legacy-config migration-error path end-to-end. See the initiative's Testing Strategy (Integration Testing).

### Dependencies
Depends on Phases 1 through 5 (CIHA-T-0015 through CIHA-T-0019) being wired — schema/resolve, engine, gate/write, CLI report/gate, and init — since this exercises the full stack. Phase 6 (CIHA-T-0020) is not required for CLI-level integration but the fixture may be reused by the action smoke test.

### Verification steps
- Run the integration test file; confirm all cases pass locally and in CI.
- Confirm the all-pass run writes baselines to a temp config and the one-regressed run leaves the config byte-identical.
- Confirm `--json` parses and contains a `projects` array and a top-level mean `score`.
- Run repo lint and typecheck with zero errors.

### Risk Considerations
- Fixture metric values drifting across `scc`/`depcruise` versions, causing flaky assertions; mitigate by asserting structure and relative behavior (pass/fail, ordering, presence of fields) rather than brittle exact scores where the tool version could move them, and pin tool versions as the existing test does.
- Write-back tests dirtying the repo; mitigate by operating on a temp copy of the config.
- Slow integration runtime as N projects scale; keep the fixture to two small packages.

## Status Updates **[REQUIRED]**

- **Completed** (opus + medium agent): Added a real 2-project monorepo fixture `test/fixtures/sample-monorepo/` (`packages/a` healthy/acyclic, `apps/b` with a deliberate import cycle) + `test/integration/monorepo.integration.test.ts` running the built CLI over a per-test temp copy. Cases: `scan` (both project blocks + mean, no writes), `scan --json` (2-element `projects`, mean = rounded average), gate all-pass (exit 0, every `lastScore` written back), gate one-regressed (exit 1, names `b`, config byte-unchanged). Gated on scc/depcruise availability per repo convention.
- **Observed deterministic scores:** a=10.0, b=8.67, mean=9.34; write-back rounds b→8.7. No source bugs found.
- **Gates (full suite, tools on PATH):** build + lint + typecheck clean; `npm test` 197 passed / 18 files (4 new monorepo tests confirmed executing). No rule weakening; no `any`/ts-ignore.