---
id: integration-tests-fixtures-end-to
level: task
title: "Integration tests + fixtures (end-to-end CLI)"
short_code: "CIHA-T-0011"
created_at: 2026-07-31T18:26:26.726824+00:00
updated_at: 2026-07-31T20:01:01.824231+00:00
parent: CIHA-I-0002
blocked_by: []
archived: false

tags:
  - "#task"
  - "#phase/completed"


exit_criteria_met: false
strategy_id: NULL
initiative_id: CIHA-I-0002
---

# Integration tests + fixtures (end-to-end CLI)

## Parent Initiative **[CONDITIONAL: Assigned Task]**

[[CIHA-I-0002]]

## Objective **[REQUIRED]**

Add committed fixture source trees and end-to-end tests that invoke the **built CLI as a child process** against the real engine and real external tools (`scc`, `dependency-cruiser`). This is the only tier that exercises the whole pipeline: it validates that `scan` reports without mutating config, that `gate` passes-and-seeds on first run, and that `gate` FAILs with exit 1 on a deliberately-worsened fixture while leaving the config untouched. Tests skip gracefully (not fail) when the external tools are absent. This is Phase 3; it depends on the CLI from CIHA-T-0010.

## Acceptance Criteria

## Acceptance Criteria

## Acceptance Criteria **[REQUIRED]**

- [ ] A committed fixture repo `test/fixtures/sample-src` with a known-good structure, and a "worsened" variant (e.g. one with an added dependency cycle) `test/fixtures/sample-src-worse` (Testing Strategy: Integration Testing).
- [ ] Each test copies the fixture + its `ci-health-audit.config.json` into a temp dir so write-back mutations never dirty the repo (Data Management).
- [ ] Test: `scan` on the fixture prints a numeric score and exits `0` **without touching the config** (REQ-002).
- [ ] Test: `gate` on the unchanged fixture PASSES (first-run seeding, `lastScore` starts `0`), exits `0`, and writes the measured `lastScore` (REQ-003, REQ-004).
- [ ] Test: after seeding, a second `gate` against the worsened fixture FAILs with exit `1` and leaves the (already-seeded) config unchanged (REQ-003, Use Case 3).
- [ ] Test asserts the exit-code contract values `0`/`1` exactly (NFR-004).
- [ ] Tests are `skip`ped with a clear message when `which scc` / `depcruise --version` fail, so the unit suite still runs everywhere (Test Environment).
- [ ] Tests invoke the built `dist/cli.js` (or the `bin`) as a real child process, not the in-process handlers.

## Implementation Notes **[CONDITIONAL: Technical Task]**

### Execution profile
Recommended Agent: sonnet + medium

### Dependencies
- **Initiative is BLOCKED BY CIHA-I-0001** (real engine runs here end-to-end).
- **Intra-initiative ordering:** depends on **CIHA-T-0010** (the built CLI and its exit-code contract) and transitively on **CIHA-T-0009**. Mechanical once the CLI and fixtures exist — follow the stated test matrix.

### Technical Approach
Files:
- `test/fixtures/sample-src/**` — ~5–8 small TS modules, healthy structure; committed `ci-health-audit.config.json` with `lastScore: 0`.
- `test/fixtures/sample-src-worse/**` — same but with a deliberate 2-module import cycle (and/or a deep chain) to force a regression.
- `test/integration/cli.integration.test.ts` — `vitest`; uses `node:child_process` `execFileSync`/`spawnSync` to run the CLI; `os.tmpdir()` + `fs.cpSync` to copy fixtures per test.

**Skip guard:** at file top, probe `scc` and `depcruise` via `spawnSync(...).status === 0`; if either is missing, `describe.skip` with a message like `"skipping integration: scc/depcruise not on PATH"`. This preserves the unit suite everywhere while CI (which installs both, reusing the Action's install steps — CIHA-T-0012) runs them for real.

**Matrix (Test Selection priority order):**
1. `scan` report: exit 0, score printed, config byte-identical after run.
2. `gate` pass+seed: exit 0, `lastScore` in temp config updated from `0` to the measured score.
3. `gate` fail on worsened fixture: seed against good fixture first (writes baseline), then run gate against the worse copy pointing at the seeded config; expect exit 1 and config unchanged from the seeded value.

Assert child-process `status` (exit code) directly. Parse `--json` output where a numeric score assertion is needed.

### Risk Considerations
- Determinism (NFR-002): pin `dependency-cruiser` version in `package.json`; the worsened fixture must drop the score by more than `|threshold|` (default −2) so the FAIL is unambiguous even across tool-version noise. If the natural drop is small, make the regression severe (multiple cycles) rather than tuning the threshold.
- Ensure the "worse" run compares against the seeded baseline, not `lastScore: 0` (which would spuriously seed-pass).

## Test Cases **[CONDITIONAL: Testing Task]**

### Test Case 1: Report leaves config untouched
- **Test ID**: TC-001
- **Preconditions**: `scc` + `depcruise` on PATH; fixture copied to temp.
- **Steps**: run `ciha scan --config <temp>/ci-health-audit.config.json`.
- **Expected Results**: exit 0; stdout contains a `x.y / 10` score; config file bytes unchanged.
- **Status**: Pass/Fail/Blocked

### Test Case 2: Seed then fail cycle
- **Test ID**: TC-002
- **Preconditions**: as above; good fixture and worse fixture both available.
- **Steps**:
  1. `ciha gate` on good fixture → exit 0, `lastScore` updated from 0 to measured value.
  2. `ciha gate` on worsened fixture using the seeded config → exit 1, config unchanged.
- **Expected Results**: exit codes 0 then 1; write-back only on the pass.
- **Status**: Pass/Fail/Blocked

## Status Updates **[REQUIRED]**

*To be added during implementation*