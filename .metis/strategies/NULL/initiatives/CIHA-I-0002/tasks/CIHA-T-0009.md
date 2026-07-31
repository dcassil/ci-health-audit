---
id: gate-semantics-module-pure
level: task
title: "Gate semantics module (pure evaluator + atomic config writer)"
short_code: "CIHA-T-0009"
created_at: 2026-07-31T18:26:23.656112+00:00
updated_at: 2026-07-31T19:41:19.655193+00:00
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

# Gate semantics module (pure evaluator + atomic config writer)

## Parent Initiative **[CONDITIONAL: Assigned Task]**

[[CIHA-I-0002]]

## Objective **[REQUIRED]**

Implement the two engine-independent, side-effect-controlled building blocks that the gate rests on: (1) a **pure gate evaluator** that decides PASS/FAIL from `{ newScore, lastScore, threshold }` using the exact formula and first-run seeding rule, and (2) an **atomic config write-back** module that persists only `lastScore` without corrupting the config. Both must be fully unit-tested before any CLI wiring (CIHA-T-0010) consumes them. This is Phase 1 of the initiative and is load-bearing: every runtime (CLI, Action, hook) branches on the decision this module produces.

## Acceptance Criteria

## Acceptance Criteria

## Acceptance Criteria **[REQUIRED]**

- [ ] A pure function `evaluateGate({ newScore, lastScore, threshold })` returns a decision object `{ decision: "pass" | "fail", floor: number, lastScore: number, threshold: number, newScore: number, seeded: boolean }` with **no I/O** (REQ-003, REQ-004, Architecture "Gate evaluator (pure)").
- [ ] Formula is exactly `floor = lastScore + threshold; PASS ⟺ newScore >= floor` (equivalently FAIL ⟺ `newScore < lastScore + threshold`). Boundary `newScore === floor` is PASS; `newScore === floor - 0.1` is FAIL (REQ-004).
- [ ] First-run seeding: when `lastScore === 0`, decision is always `pass` with `seeded: true`, regardless of `newScore` (REQ-004, Detailed Design "First-run seeding rule").
- [ ] Non-default negative thresholds (`-1`, `-3`) produce correct floors and decisions.
- [ ] `writeLastScore(configPath, newScore)` updates only the numeric `lastScore`, preserving every other field, insertion/key order, 2-space indent, and the trailing newline (REQ-005, NFR-003).
- [ ] Write-back is atomic: writes to `<config>.tmp` in the same directory, `fsync`s, then `fs.rename(tmp, config)`; a thrown/interrupted write leaves the original file intact and no `.tmp` remains (NFR-003).
- [ ] `newScore` is rounded to one-decimal precision before write (matches the engine's precision, Detailed Design "Config write-back approach" step 2).
- [ ] A human-readable message builder produces the PASS / FAIL strings specified in Detailed Design "Terminal output formatting".
- [ ] 100% branch coverage on both modules via `vitest` (Testing Strategy: gate evaluator + config writer are the 100%-coverage targets).

## Implementation Notes **[CONDITIONAL: Technical Task]**

### Execution profile
Recommended Agent: opus + medium

### Dependencies
- **Initiative is BLOCKED BY CIHA-I-0001** (engine must expose `scan(config)`, `CihaConfig`, `loadConfig`). This particular task only needs the config file *shape* (`{ language, srcDir, lastScore, threshold, weights, baselines }`) and the one-decimal score precision — it does not call `scan()` — so it is the safest first task to start once the engine's config type is stable.
- **Intra-initiative ordering:** this is Phase 1; CIHA-T-0010 (CLI) depends on it. Nothing here depends on later tasks.

### Technical Approach
Files (single ESM package, TS strict, per CIHA-I-0001 conventions):
- `src/gate/evaluate.ts` — pure evaluator.
- `src/gate/writeConfig.ts` — atomic write-back.
- `src/gate/messages.ts` — PASS/FAIL/JSON message builders (or co-locate in evaluate.ts).
- `test/gate/evaluate.test.ts`, `test/gate/writeConfig.test.ts`.

**Gate formula (exact):**
```
floor = lastScore + threshold        // e.g. 7.4 + (-2) = 5.4
PASS  ⟺  newScore >= floor
FAIL  ⟺  newScore <  floor
```
**First-run seeding override:** if `lastScore === 0`, return `{ decision: "pass", seeded: true, floor }` unconditionally. `0` is the `init` placeholder and a functionally impossible real steady-state score; treating it as "unseeded" is the correct rule. After the first PASS writes a non-zero score, normal comparison applies. A real `0.0` simply re-seeds harmlessly.

**Atomic write-back approach:**
1. Read current file text; `JSON.parse` into an object (preserves key insertion order).
2. `obj.lastScore = Math.round(newScore * 10) / 10`.
3. `const text = JSON.stringify(obj, null, 2) + "\n"`.
4. Write `text` to `<config>.tmp` in the same directory, `fs.fsyncSync` the fd, then `fs.renameSync(tmp, config)` (atomic on POSIX). On any throw, ensure the tmp file is removed and the original untouched.
Because `JSON.stringify` re-emits keys in insertion order, `language`/`srcDir`/`threshold`/`weights`/`baselines` survive unchanged.

**Exit-code contract note:** this module does NOT call `process.exit`. It returns data; the CLI (CIHA-T-0010) maps `decision: "fail"` → exit 1, PASS → write + exit 0, and config errors → exit 2. Keeping exit codes out of this pure module is what makes it unit-testable.

**Messages (Detailed Design "Terminal output formatting"):**
- PASS: `PASS — score 7.1 ≥ floor 5.4 (last 7.4, threshold -2). Saved 7.1.`
- FAIL (stderr): `FAIL — score 3.0 < floor 5.4 (last 7.4, threshold -2). Config not updated.`
- JSON `gate` object: `{ "decision": "pass", "floor": 5.4, "lastScore": 7.4, "threshold": -2 }`.

### Risk Considerations
- Floating-point: compute `floor` and compare directly; round only for display and for the persisted score. Do not round before comparing, or a `floor` like `5.4` may mis-compare.
- Atomicity: the injected-failing-rename test is the guard for NFR-003 — verify the original file bytes are unchanged and no `.tmp` lingers after a simulated failure.

## Test Cases **[CONDITIONAL: Testing Task]**

### Test Case 1: Boundary and regression table
- **Test ID**: TC-001
- **Preconditions**: evaluator implemented; `lastScore = 7.4`, `threshold = -2` → `floor = 5.4`.
- **Steps**:
  1. `evaluateGate({ newScore: 5.4, lastScore: 7.4, threshold: -2 })` → PASS (equal to floor).
  2. `evaluateGate({ newScore: 5.3, lastScore: 7.4, threshold: -2 })` → FAIL.
  3. `evaluateGate({ newScore: 8.0, lastScore: 7.4, threshold: -2 })` → PASS (improvement).
  4. With `threshold: -1` → floor 6.4; `newScore 6.4` PASS, `6.3` FAIL. With `threshold: -3` → floor 4.4.
- **Expected Results**: decisions and floors exactly as above.
- **Status**: Pass/Fail/Blocked

### Test Case 2: First-run seeding + atomic write-back integrity
- **Test ID**: TC-002
- **Preconditions**: temp-dir fixture config with `lastScore: 0` plus populated `weights`/`baselines`.
- **Steps**:
  1. `evaluateGate({ newScore: 7.4, lastScore: 0, threshold: -2 })` → `{ decision: "pass", seeded: true }`.
  2. `writeLastScore(cfgPath, 7.4)`; re-read file; assert only `lastScore` changed to `7.4`, key order/indent/trailing newline preserved, `weights`/`baselines` byte-identical except score.
  3. Inject a failing `rename`; assert original file bytes unchanged and no `.tmp` remains.
- **Expected Results**: all assertions hold; 100% branch coverage reported.
- **Status**: Pass/Fail/Blocked

## Status Updates **[REQUIRED]**

*To be added during implementation*