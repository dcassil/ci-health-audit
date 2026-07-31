---
id: cli-scaffolding-commands-init-scan
level: task
title: "CLI scaffolding & commands (init, scan, gate)"
short_code: "CIHA-T-0010"
created_at: 2026-07-31T18:26:25.249757+00:00
updated_at: 2026-07-31T19:48:55.880277+00:00
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

# CLI scaffolding & commands (init, scan, gate)

## Parent Initiative **[CONDITIONAL: Assigned Task]**

[[CIHA-I-0002]]

## Objective **[REQUIRED]**

Build the `ci-health-audit` / `ciha` binary: wire `commander`, the dual `bin` entries, the config loader (delegating to the engine's `loadConfig`), and the three command handlers — `init`, `scan [--gate]`, and `gate` — plus the report formatter and its `--json` variant. This is the layer that composes the engine's `scan(config)` with the Phase-1 gate evaluator and config writer, and it owns the public exit-code contract (0/1/2). This is Phase 2; it consumes CIHA-T-0009 and the CIHA-I-0001 engine.

## Acceptance Criteria

## Acceptance Criteria

## Acceptance Criteria **[REQUIRED]**

- [ ] `package.json` `bin` maps both `ci-health-audit` and `ciha` to `dist/cli.js`, which starts with shebang `#!/usr/bin/env node`; `npx ci-health-audit …` and a local `ciha …` are interchangeable (Detailed Design "Package & binary"; NFR-005 portability under `npx` on Node LTS, macOS/Linux).
- [ ] `ciha init [--config <path>] [--force]` writes the default config (below) to `./ci-health-audit.config.json`; refuses to overwrite an existing file without `--force`, exiting `2` with a message naming the file; with `--force` it overwrites (REQ-001).
- [ ] `ciha scan [--config <path>] [--gate] [--json]` loads config, calls `scan(config)`, prints score + per-metric breakdown to stdout, exits `0`, and never mutates the config (REQ-002). `--gate` makes it behave identically to `gate`.
- [ ] `ciha gate [--config <path>] [--json]` loads config, calls `scan(config)`, runs the Phase-1 evaluator; on PASS writes `lastScore` atomically (via CIHA-T-0009's writer) and exits `0`; on FAIL leaves config untouched and exits `1` (REQ-003).
- [ ] `--config` defaults to `./ci-health-audit.config.json` for all commands.
- [ ] Config errors (missing/unreadable/schema-invalid) exit `2` with a message naming the file and problem — distinct from a gate FAIL (`1`); unknown commands also exit `2` (REQ-006, NFR-004).
- [ ] Human report matches the specified format; `--json` emits `{ score, breakdown, gate? }` (the `gate` key present only in gate mode) (Detailed Design "Terminal output formatting").
- [ ] CLI/gate overhead excluding the engine scan is < 100 ms (NFR-001).
- [ ] Handler code covered ~90% by `vitest` with the engine's `scan` mocked so unit tests never shell out to `scc`/`depcruise` (Testing Strategy).

## Implementation Notes **[CONDITIONAL: Technical Task]**

### Execution profile
Recommended Agent: opus + medium

### Dependencies
- **Initiative is BLOCKED BY CIHA-I-0001**: this task calls the engine's `scan(config)` and uses its `CihaConfig`/`loadConfig` and default `weights`/`baselines`. It treats `scan()` as a black box returning `{ score, breakdown }`.
- **Intra-initiative ordering:** depends on **CIHA-T-0009** (gate evaluator + atomic config writer). Must land before CIHA-T-0011 (integration tests exercise this binary), CIHA-T-0012 (Action invokes `npx ci-health-audit`), and CIHA-T-0013 (hook invokes `ciha gate`).

### Technical Approach
Files:
- `src/cli.ts` — commander program, `bin` entry (shebang), dispatch to handlers, top-level try/catch mapping errors to exit codes.
- `src/commands/init.ts`, `src/commands/scan.ts`, `src/commands/gate.ts` (gate = `scan --gate` shared implementation).
- `src/config/loadConfigFile.ts` — resolve path, read + JSON.parse, delegate validation to engine `loadConfig`; throw a typed `ConfigError` → exit 2.
- `src/report/format.ts` — human table + `--json` object; reused by the Action.

**Command shapes (Detailed Design "Command definitions"):**
```
ci-health-audit init   [--config <path>] [--force]
ci-health-audit scan   [--config <path>] [--gate] [--json]
ci-health-audit gate   [--config <path>] [--json]     # alias for `scan --gate`
```

**Default config written by `init`:**
```json
{
  "language": "ts",
  "srcDir": "./src",
  "lastScore": 0,
  "threshold": -2,
  "weights": {
    "ts": {
      "locPerModule": 0.2,
      "depDepth": 0.2,
      "circularDeps": 0.2,
      "complexity": 0.2,
      "fanInOut": 0.2
    }
  }
}
```
Baselines are omitted so the engine applies its ported defaults; `init` writes values the engine's `loadConfig` accepts (a user may add a `baselines` block to override). Reuse the Phase-1 writer's formatting helper (2-space indent + trailing newline).

**Gate wiring:** load config → `const { score, breakdown } = await scan(config)` → `evaluateGate({ newScore: score, lastScore: config.lastScore, threshold: config.threshold })`. PASS → `writeLastScore(configPath, score)` then print PASS message + breakdown → exit 0. FAIL → print FAIL message to stderr, **no write** → exit 1.

**Exit-code contract (public, stable — NFR-004):**

| Code | Meaning |
|---|---|
| `0` | Report printed, OR gate PASS (held/seeded/within threshold). |
| `1` | Gate FAIL: `newScore < lastScore + threshold`. |
| `2` | Config or usage error: missing/unreadable/invalid config, unknown command, `init` refusing overwrite without `--force`. |

Only exit `1` is a quality regression. Implement a single top-level handler that catches `ConfigError`/commander usage errors → exit 2, lets the gate handler return 1 explicitly, and defaults to 0.

**Report format (default):**
```
ci-health-audit — health score: 7.4 / 10

  LOC / module        8.1
  Dependency depth    6.9
  Circular deps      10.0
  Complexity          6.2
  Fan-in / fan-out    5.9
```
`--json`: `{ "score": 7.4, "breakdown": {…}, "gate": { "decision": "pass", "floor": 5.4, "lastScore": 7.4, "threshold": -2 } }` (gate key only in gate mode).

### Risk Considerations
- Do not duplicate gate logic — `gate` and `scan --gate` must share one implementation (Alternatives Considered: "both, one implementation").
- Ensure `scan` report mode NEVER touches the config (assert in tests).
- Keep commander thin: no business logic in arg parsing.

## Test Cases **[CONDITIONAL: Testing Task]**

### Test Case 1: Exit-code contract (mocked engine)
- **Test ID**: TC-001
- **Preconditions**: `scan` mocked to return a fixed `{ score, breakdown }`; temp-dir configs.
- **Steps**:
  1. `scan` on a valid config → stdout has score+breakdown, exit 0, config unchanged.
  2. `gate` with mocked score below floor → stderr FAIL message, exit 1, config unchanged.
  3. `gate` with score at/above floor (or seeding) → exit 0, `lastScore` updated.
  4. Missing/invalid config → exit 2 with file named. Unknown command → exit 2.
- **Expected Results**: exit codes and side-effects exactly as contract.
- **Status**: Pass/Fail/Blocked

### Test Case 2: init defaults / force / refusal + --json
- **Test ID**: TC-002
- **Preconditions**: empty temp dir.
- **Steps**:
  1. `init` writes default config (2-space indent, trailing newline); exit 0.
  2. `init` again without `--force` → exit 2, existing file untouched.
  3. `init --force` overwrites → exit 0.
  4. `scan --json` and `gate --json` emit the specified object; `gate` key present only for gate.
- **Expected Results**: as above.
- **Status**: Pass/Fail/Blocked

## Status Updates **[REQUIRED]**

*To be added during implementation*