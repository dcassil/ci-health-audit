---
id: runtimes-integrations-cli-github
level: initiative
title: "Runtimes & Integrations (CLI, GitHub Action, Pre-commit Gate)"
short_code: "CIHA-I-0002"
created_at: 2026-07-31T18:20:35.529708+00:00
updated_at: 2026-07-31T20:05:28.049690+00:00
parent: CIHA-V-0001
blocked_by: []
archived: false

tags:
  - "#initiative"
  - "#phase/completed"


exit_criteria_met: false
estimated_complexity: M
strategy_id: NULL
initiative_id: runtimes-integrations-cli-github
---

# Runtimes & Integrations (CLI, GitHub Action, Pre-commit Gate) Initiative

## Context **[REQUIRED]**

The `ci-health-audit` vision (CIHA-V-0001) calls for a single, portable command-line tool that computes one code health score (0–10) for a JS/TS codebase and drops into three contexts without change: a manual CLI invocation, a GitHub Action, and a local pre-commit/pre-push hook. The scoring engine that produces the number — the plugin-based scanner, the graph/metrics computation, the p75 reduction, the 0–10 normalization, and the config zod schema — is the subject of the sibling initiative **CIHA-I-0001 (Core Engine)**. That engine exposes a single stable entry point:

```ts
async function scan(config: CihaConfig): Promise<{ score: number /* 0–10, one decimal */; breakdown: PerMetricScores }>
```

where `PerMetricScores` maps each of the five structural metrics (LOC/module, dependency depth, circular deps, cyclomatic complexity, fan-in/fan-out) to its normalized 0–10 sub-score, and `CihaConfig` is the type/loader the core defines from the config zod schema.

**This initiative is the delivery layer.** It takes that engine and wraps it in everything a user actually touches: the `ciha` binary and its `init` / `scan` / `gate` commands, the gate regression semantics (score comparison + config write-back), the `action.yml` GitHub Action plus an example workflow, a documented pre-commit/pre-push hook, and the README that ties install, prerequisites, config, the three usage modes, and the exit-code contract together. Without this initiative the engine is a library nobody can run; with it, the vision's "one number, one config file, three runtimes" promise is realized.

It is explicitly **blocked by CIHA-I-0001**: this initiative *consumes* `scan()` and the `CihaConfig` type but does not define the scanner, the metrics, or the schema. The seam between the two is the `scan(config)` signature above and the config file shape (`{ language, srcDir, lastScore, threshold, weights, baselines }`).

## Goals & Non-Goals **[REQUIRED]**

**Goals:**
- Ship the `ci-health-audit` / `ciha` binary, runnable via `npx`, with three commands: `init` (scaffold config), `scan` (report mode), and `gate` (regression gate with write-back).
- Implement a **gate semantics module** — the score-comparison formula and atomic config write-back — as pure, independently unit-tested logic decoupled from CLI argument parsing and from the engine.
- Provide a **GitHub Action** (`action.yml`) plus an example workflow that installs prerequisites (`scc`, `dependency-cruiser`), runs the scan, and surfaces the score to the job summary and as a step output.
- Provide a **documented pre-commit/pre-push hook** that runs `ciha gate`, blocking a commit/push on a regression beyond threshold and persisting the new score on a pass.
- Publish a **README** covering install, the `scc` / `dependency-cruiser` prerequisites, the full config reference, the three usage modes (CLI report, CI report, local gate), and the exit-code contract.
- Guarantee **first-run seeding**: with `lastScore` at its default of `0`, the first gate run always passes and records the true score, so gates only ever compare against a previously-measured baseline.

**Non-Goals:**
- The scanner plugin architecture, the JS/TS scanner, graph/metric computation, the p75 reduction, the 0–10 normalization/scoring math, and the config **zod schema definition** — all owned by CIHA-I-0001. This initiative consumes the resulting `scan()` function and `CihaConfig` type; it does not implement or redefine them.
- Support for languages other than JS/TS (the engine leaves the plugin seam open; this layer passes `config.language` through unchanged).
- Any server, database, dashboard, or network persistence. The only mutable state this initiative writes is `lastScore` in the config file.
- A published GitHub Marketplace listing, semantic-release automation, or npm publish pipeline (packaging/release is out of scope here; the deliverables are the runnable sources and docs).
- GUI/TUI: the tool is CLI-only. Terminal output formatting is described under Detailed Design; there is no graphical interface.

## Requirements **[CONDITIONAL: Requirements-Heavy Initiative]**

### User Requirements
- **User Characteristics**: JS/TS engineers and platform/DevX engineers comfortable with a terminal, `package.json` scripts, git hooks, and GitHub Actions YAML. They want a zero-infrastructure health gate and are willing to install two external tools (`scc`, `dependency-cruiser`) once.
- **System Functionality**: Users expect to scaffold a config, get a reproducible 0–10 score on demand, wire that score into CI as a reported number, and gate local commits/pushes so architectural regressions beyond a chosen threshold are blocked while passing runs quietly update the saved baseline.
- **User Interfaces**: A single CLI binary (`ci-health-audit`, alias `ciha`) with subcommands; a JSON config file (`ci-health-audit.config.json`); a GitHub Action (`action.yml`); and a git hook script. All interaction is text: stdout for the score/breakdown, stderr for gate-failure messaging, and process exit codes as the machine-readable contract.

### System Requirements
- **Functional Requirements**:
  - REQ-001: `ciha init` writes `ci-health-audit.config.json` in the current directory with defaults `{ language: "ts", srcDir: "./src", lastScore: 0, threshold: -2, weights: <equal>, baselines: <engine defaults> }`. It must not overwrite an existing config unless `--force` is passed; without `--force` on an existing file it exits non-zero with a clear message.
  - REQ-002: `ciha scan` loads the config, calls `scan(config)`, prints the 0–10 score and the per-metric breakdown to stdout, and exits `0`. It never mutates the config (report mode).
  - REQ-003: `ciha gate` (equivalently `ciha scan --gate`) loads the config, calls `scan(config)`, and applies the gate formula against `config.lastScore`. On PASS it writes the new score back to `lastScore` and exits `0`; on FAIL it leaves the config untouched and exits `1`.
  - REQ-004: The gate comparison uses `newScore < lastScore + threshold ⇒ FAIL` (threshold negative). A first run where `lastScore === 0` and the config has never been written by a passing gate always PASSES and seeds the score (see Detailed Design for the exact first-run rule).
  - REQ-005: Config write-back is atomic and preserves all other fields and JSON formatting (2-space indent, trailing newline); only the numeric `lastScore` value changes.
  - REQ-006: A missing config, an unreadable config, or a config that fails the engine's schema validation causes any command to exit non-zero (`2`, config error) with a message naming the file and the problem — distinct from a gate FAIL (`1`).
  - REQ-007: The GitHub Action installs `scc` and `dependency-cruiser`, runs `ciha scan`, writes the score to `$GITHUB_STEP_SUMMARY`, and exposes it as a step output `score`. The action supports a `mode` input (`report` default, or `gate`) selecting `scan` vs `gate`.
  - REQ-008: A documented hook script runs `ciha gate` on `pre-commit` (and an equivalent `pre-push` variant) so a regression beyond threshold aborts the git operation with a non-zero exit, and a pass updates `lastScore`.
- **Non-Functional Requirements**:
  - NFR-001 (Performance): CLI/gate overhead **excluding** the engine scan itself must be negligible (< 100 ms): arg parsing, config load, formatting, and write-back are all trivial I/O. Total runtime is dominated by the engine and the external tools it shells to; the hook must be fast enough not to discourage committing (scan time is the engine's concern).
  - NFR-002 (Determinism): Given identical source and identical config, `scan` prints an identical score and breakdown across runs and machines (inherited from the engine's determinism guarantee). The gate decision is therefore also deterministic.
  - NFR-003 (Safety / data integrity): Config write-back must never leave a corrupt or partially-written config even if the process is interrupted; use write-to-temp-then-rename. A FAILed gate must never write the config.
  - NFR-004 (Exit-code contract stability): The exit-code mapping (`0` pass/report, `1` gate fail, `2` config/usage error) is a public contract that CI and hooks depend on; it must be stable and documented.
  - NFR-005 (Portability): The binary must run under `npx` on Node LTS on macOS and Linux (the platforms GitHub-hosted runners and typical dev machines use), with no assumption of a global install.

## Use Cases **[CONDITIONAL: User-Facing Initiative]**

### Use Case 1: Manual CLI report
- **Actor**: A developer inspecting the health of a repo locally.
- **Scenario**: In a repo with `scc` and `dependency-cruiser` available, the developer runs `npx ci-health-audit init`, then `npx ci-health-audit scan`. The CLI loads `ci-health-audit.config.json`, calls the engine on `./src`, and prints the score plus the five per-metric sub-scores.
- **Expected Outcome**: A 0–10 score and per-metric breakdown are printed to stdout; exit code `0`; the config file is unchanged.

### Use Case 2: CI reports the score on every PR
- **Actor**: A platform engineer configuring CI.
- **Scenario**: They add the `ci-health-audit` Action to a workflow triggered on `pull_request`. The Action installs `scc` and `dependency-cruiser`, checks out the code, and runs in `report` mode. The score is written to the job summary and exposed as an output another step can consume.
- **Expected Outcome**: Every PR shows the current health score in its checks/summary; the job succeeds regardless of the score (report mode never fails the build); the `score` output is available downstream.

### Use Case 3: Local pre-commit/pre-push gate blocks a regression
- **Actor**: A developer committing a change that meaningfully worsens architecture (e.g. introduces a dependency cycle).
- **Scenario**: The repo has the documented hook installed running `ciha gate`. On `git commit` (or `git push`), the hook runs the engine, the new score is more than `threshold` (default −2) below the saved `lastScore`, so the gate FAILs.
- **Expected Outcome**: The gate prints a clear message showing old score, new score, threshold, and the allowed floor; exits `1`; git aborts the commit/push; the config's `lastScore` is left unchanged so the baseline is not corrupted by a rejected change.

### Use Case 4: First-run seeding, then a passing gate updates the baseline
- **Actor**: A developer adopting the gate for the first time, and later committing an acceptable change.
- **Scenario**: Right after `ciha init`, `lastScore` is `0` and no passing gate has run. The developer's first `ciha gate` run measures the real score (say `7.4`); because it is the seeding run it PASSES and writes `7.4` to `lastScore`. On a later commit the score is `7.1` (a −0.3 drop, within the −2 threshold): the gate PASSES and writes `7.1`.
- **Expected Outcome**: The first run never spuriously fails against the placeholder `0`; the saved baseline tracks the real score forward on every pass, so subsequent gates compare against a genuine measurement.

## Architecture **[CONDITIONAL: Technically Complex Initiative]**

### Overview
The same binary serves all three runtimes by routing through one shared pipeline and branching only at the final step (report vs gate). The composition is:

```
                         ┌──────────────────────────────────────────────┐
argv ──▶ arg parser ──▶  │ config loader ──▶ engine.scan(config) ──▶ …  │
(commander)              └──────────────────────────────────────────────┘
                                                          │
                              report mode ────────────────┤
                              (scan)                       ▼
                                                   report formatter ──▶ stdout, exit 0
                              gate mode  ────────────────┐
                              (gate / scan --gate)       ▼
                                              gate evaluator (pure) ──▶ PASS / FAIL
                                                  │                 │
                                             PASS │            FAIL │
                                                  ▼                 ▼
                                          config writer      stderr message,
                                          (atomic) ──▶ exit 0     exit 1
```

- **Arg parser** (`commander`): maps `init`, `scan [--gate]`, and `gate` to handlers; owns `--config`, `--force`, and flag parsing. Thin — no business logic.
- **Config loader**: resolves the config path, reads and parses JSON, and validates it via the **engine-provided** `CihaConfig` loader/schema (defined in CIHA-I-0001). Raises a distinct config error (exit `2`) on failure.
- **Engine call**: `await scan(config)` from CIHA-I-0001. This layer treats it as a black box returning `{ score, breakdown }`.
- **Report formatter**: renders score + breakdown for humans (and a `--json` variant for machines). Used by `scan` and by the Action to build the summary.
- **Gate evaluator** (pure module): given `{ newScore, lastScore, threshold }` returns a decision (`PASS`/`FAIL`) with the computed floor and a human message. No I/O — this is the unit-tested heart of the gate.
- **Config writer** (atomic): on PASS, updates only `lastScore` and rewrites the config preserving all other fields and formatting, via temp-file + rename.

`init` is a separate short path (scaffold-and-write) that shares only the config writer's formatting helper. The GitHub Action and the git hook are **not** code — they are thin wrappers that invoke the same binary in `report` or `gate` mode; this is precisely how "three runtimes from one binary" is achieved without duplicating logic.

### Component Diagrams
Runtime-to-binary mapping (all three invoke the same `ciha` process; they differ only in mode and environment):

| Runtime | Invocation | Mode | On regression |
|---|---|---|---|
| Manual CLI | `npx ci-health-audit scan` | report | n/a (always exit 0) |
| GitHub Action | `ciha scan` (or `gate` when `mode: gate`) | report / gate | job fails only in gate mode |
| Git hook | `ciha gate` in `pre-commit`/`pre-push` | gate | git operation aborts (exit 1) |

### Sequence Diagrams
**Gate flow (`ciha gate`):**
1. Parser dispatches to the gate handler.
2. Loader reads + validates config → `CihaConfig` (else exit 2).
3. `scan(config)` → `{ score: newScore, breakdown }`.
4. Gate evaluator computes `floor = lastScore + threshold`; decides `PASS` iff `newScore >= floor` (with the first-run seeding override).
5. PASS → config writer sets `lastScore = newScore` atomically → print pass message + breakdown → exit `0`.
6. FAIL → print fail message (old, new, floor, threshold) to stderr → **no write** → exit `1`.

## Detailed Design **[REQUIRED]**

### Package & binary
- Package name `ci-health-audit`; `package.json` `bin` maps both `ci-health-audit` and `ciha` to `dist/cli.js` (shebang `#!/usr/bin/env node`). This makes `npx ci-health-audit …` and a locally-installed `ciha …` interchangeable.
- Depends on CIHA-I-0001's engine package (in a monorepo, a workspace dependency; the engine exports `scan`, `CihaConfig`, `loadConfig`, and default weights/baselines).
- Arg parsing via `commander`.

### Command definitions
```
ci-health-audit init   [--config <path>] [--force]
ci-health-audit scan   [--config <path>] [--gate] [--json]
ci-health-audit gate   [--config <path>] [--json]     # alias for `scan --gate`
```
- `--config` defaults to `./ci-health-audit.config.json`.
- `init`: writes the default config (below). Refuses to overwrite unless `--force`.
- `scan`: report mode. Prints score + breakdown, exit 0. With `--gate`, behaves identically to `gate`.
- `gate`: gate mode (see formula). `--json` (on either) emits a machine-readable object instead of the human table.

### Default config produced by `init`
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
(Baselines are omitted so the engine applies its ported defaults; a user may add a `baselines` block to override. The exact `weights`/`baselines` shape is owned by the engine's schema — `init` writes values the engine's loader accepts.)

### Gate comparison formula and exit-code contract
Let `newScore` be the engine result and `lastScore`, `threshold` come from config (`threshold` is negative; default `-2`). Define:

```
floor = lastScore + threshold          // e.g. 7.4 + (-2) = 5.4
PASS  ⟺  newScore >= floor             // equivalently: NOT (newScore < lastScore + threshold)
FAIL  ⟺  newScore <  floor
```

**First-run seeding rule.** The gate must distinguish "never measured" from "measured a real 0". The evaluator treats the run as a **seeding run** (always PASS, always write) when `lastScore === 0`. Rationale: `0` is the `init` placeholder and also a functionally impossible steady-state health score for any real codebase; treating `lastScore === 0` as unseeded is the simplest correct rule and matches the vision ("first run always passes and seeds the score"). After the first PASS writes the true score, `lastScore` is non-zero and normal comparison applies. (If a real repo genuinely scored `0.0`, the next run simply re-seeds — harmless.)

**Exit-code contract (public, stable — NFR-004):**

| Code | Meaning |
|---|---|
| `0` | Report printed, OR gate PASS (score held/seeded/within threshold). |
| `1` | Gate FAIL: `newScore < lastScore + threshold`. |
| `2` | Config or usage error: missing/unreadable/invalid config, unknown command, `init` refusing to overwrite without `--force`. |

Only exit `1` represents a real quality regression; CI and hooks branch on it. Exit `2` is an operator error, not a quality signal.

### Config write-back approach
On PASS the writer must change **only** `lastScore` and preserve everything else (comments are not possible in strict JSON, but field order, other keys, indentation, and the trailing newline are preserved). Approach:
1. Read the current file text and `JSON.parse` it into an object.
2. Set `obj.lastScore = newScore` (rounded to the engine's one-decimal precision).
3. `JSON.stringify(obj, null, 2) + "\n"`.
4. Write to `<config>.tmp` in the same directory, `fsync`, then `fs.rename(tmp, config)` (atomic on POSIX). This satisfies NFR-003: a crash mid-write leaves the original intact.

Because `JSON.stringify` re-emits keys in insertion order and `JSON.parse` preserves order, all sibling fields (`language`, `srcDir`, `threshold`, `weights`, `baselines`) survive unchanged.

### Terminal output formatting
Human report (default):
```
ci-health-audit — health score: 7.4 / 10

  LOC / module        8.1
  Dependency depth    6.9
  Circular deps      10.0
  Complexity          6.2
  Fan-in / fan-out    5.9
```
Gate PASS adds: `PASS — score 7.1 ≥ floor 5.4 (last 7.4, threshold -2). Saved 7.1.`
Gate FAIL (stderr): `FAIL — score 3.0 < floor 5.4 (last 7.4, threshold -2). Config not updated.`
`--json` emits `{ "score": 7.4, "breakdown": {…}, "gate": { "decision": "pass", "floor": 5.4, "lastScore": 7.4, "threshold": -2 } }` (the `gate` key present only in gate mode).

### `action.yml` shape
A **composite** action (no build/publish step, minimal maintenance):
```yaml
name: "CI Health Audit"
description: "Compute and (optionally) gate a 0–10 code health score."
inputs:
  config:
    description: "Path to ci-health-audit.config.json"
    default: "ci-health-audit.config.json"
  mode:
    description: "report | gate"
    default: "report"
outputs:
  score:
    description: "The computed 0–10 health score"
    value: ${{ steps.run.outputs.score }}
runs:
  using: "composite"
  steps:
    - name: Install scc
      shell: bash
      run: go install github.com/boyter/scc/v3@latest && echo "$(go env GOPATH)/bin" >> "$GITHUB_PATH"
    - name: Install dependency-cruiser
      shell: bash
      run: npm i -g dependency-cruiser
    - name: Run ci-health-audit
      id: run
      shell: bash
      run: |
        if [ "${{ inputs.mode }}" = "gate" ]; then CMD=gate; else CMD=scan; fi
        SCORE=$(npx --yes ci-health-audit "$CMD" --config "${{ inputs.config }}" --json | node -e 'process.stdin.on("data",d=>{const j=JSON.parse(d);process.stdout.write(String(j.score))})')
        echo "score=$SCORE" >> "$GITHUB_OUTPUT"
        echo "### CI Health Audit: $SCORE / 10" >> "$GITHUB_STEP_SUMMARY"
```
Example workflow (`.github/workflows/health.yml`):
```yaml
on: [pull_request]
jobs:
  health:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: actions/setup-go@v5
        with: { go-version: "1.22" }
      - uses: your-org/ci-health-audit@v1   # mode: report by default
```
Report vs gate in CI: use `mode: report` on PRs to surface the number without blocking; use `mode: gate` on a branch where you want CI itself to fail on regression (note gate mode writes `lastScore` back, so it fits a push-to-main workflow that commits the updated config, not ephemeral PR checkouts).

### Hook script
Native `core.hooksPath` script (no husky dependency), documented for both events. `.githooks/pre-commit`:
```sh
#!/bin/sh
# Block commits that regress code health beyond the configured threshold.
npx --no-install ci-health-audit gate || {
  echo "ci-health-audit gate failed — commit blocked. Fix regressions or adjust threshold." >&2
  exit 1
}
```
Enable with `git config core.hooksPath .githooks && chmod +x .githooks/pre-commit`. A `pre-push` variant is identical but placed at `.githooks/pre-push` (recommended when scan time makes per-commit gating too slow). On PASS the gate updates `lastScore`; the README notes the user should commit that config change (or, for pre-commit, `git add` it within the hook if they want the baseline update in the same commit — documented as an optional advanced step).

## Testing Strategy **[CONDITIONAL: Separate Testing Initiative]**

### Unit Testing
- **Strategy**: The **gate evaluator** is pure (`{ newScore, lastScore, threshold } → decision`) and gets exhaustive table-driven tests:
  - Threshold boundary: `newScore === floor` PASSES; `newScore === floor - 0.1` FAILS (exact `>=` vs `<`).
  - Regression: drop greater than `|threshold|` FAILS; drop equal to threshold PASSES; improvement PASSES.
  - First-run seeding: `lastScore === 0` always PASSES and is flagged as a seeding write, regardless of `newScore`.
  - Negative-threshold semantics with non-default thresholds (e.g. `-1`, `-3`).
  The **config write-back** module is tested against a temp-dir fixture: asserts only `lastScore` changed; other fields, key order, 2-space indent, and trailing newline preserved; a `weights`/`baselines` block survives byte-for-byte except the score; atomicity verified by asserting no `.tmp` remains and the original is intact if the write throws (inject a failing rename). `init` tested for defaults, `--force` overwrite, and refusal (exit 2) without `--force`.
- **Coverage Target**: 100% of the gate evaluator and config writer branches (they are small, pure, and load-bearing); ~90% of CLI handler code.
- **Tools**: `vitest` (fast, TS-native), with the engine's `scan` mocked so unit tests never shell out to `scc`/`dependency-cruiser`.

### Integration Testing
- **Strategy**: Invoke the built CLI end-to-end as a child process against a small committed fixture repo under `test/fixtures/sample-src` with a known config. Assert: `scan` prints a score and exits 0 without touching the config; `gate` on an unchanged fixture PASSES and writes `lastScore`; a second `gate` after swapping in a deliberately-worse fixture (e.g. one with an added cycle) FAILS with exit 1 and leaves the (already-seeded) config unchanged. This is the only tier that actually runs the real engine + external tools.
- **Test Environment**: CI job with `scc` and `dependency-cruiser` installed (reusing the Action's install steps); also runnable locally when both tools are present. Tests that require the external tools are skipped with a clear message when `which scc` / `depcruise --version` fail, so the unit suite still runs everywhere.
- **Data Management**: Fixtures are committed source trees; each integration test copies the fixture and its config into a temp dir so write-back mutations never dirty the repo.

### Test Selection
Prioritize: (1) the gate boundary and first-run seeding (the correctness core), (2) config write-back integrity and atomicity (data-safety, NFR-003), (3) the exit-code contract (`0`/`1`/`2`) since CI and hooks depend on it, (4) one full end-to-end pass/fail cycle. The engine's scoring math is out of scope (covered by CIHA-I-0001).

### Bug Tracking
Defects are logged as Metis backlog items (bug category) linked to this initiative; regressions in the exit-code contract or write-back integrity are treated as release-blockers given the NFRs; UX-only formatting issues are non-blocking.

**Note on testing the Action:** The composite Action is validated by the integration workflow itself (it *is* the Action's steps), plus a smoke workflow on a tiny sample repo asserting the job summary contains a score line and the `score` output is a parseable number in both `report` and `gate` modes. Because a composite action is just shell + the same binary, unit-level testing of the Action is unnecessary — its logic lives in the tested CLI.

## Alternatives Considered **[REQUIRED]**

- **Husky vs native `core.hooksPath` git hooks.** Husky is popular but adds a dependency, an install step, and lifecycle magic. A native `core.hooksPath` script is dependency-free, transparent, and portable, and the tool is CLI-first so we do not want to couple health gating to a specific hook manager. **Chosen: native hooks**, with a one-line note that husky users can call `ciha gate` from their existing hook — we document the mechanism, not a lock-in.
- **Composite vs JS (Node) GitHub Action.** A JS action needs a bundled/committed `dist` (ncc), a build step, and node-version pinning inside the action. A composite action is plain YAML that runs the already-published `npx ci-health-audit`, installs the two external prerequisites explicitly, and needs no build/publish of action internals. Since the real logic already lives in the tested binary, the action should be the thinnest possible wrapper. **Chosen: composite action.**
- **`scan --gate` flag vs a separate `gate` command.** A single `scan` with a `--gate` flag is fewer entry points but overloads one command with two exit-code contracts. A distinct `gate` command reads better in hooks and CI and makes the mode obvious. **Chosen: both** — `gate` is the primary, documented command; `scan --gate` is a supported alias so users who think in terms of "scan" are not surprised. They share one implementation, so there is no duplication cost.
- **Storing `lastScore` in the config file vs a separate state file (e.g. `.ciha-state.json`).** A separate state file keeps "settings" and "measured state" apart and avoids diff noise in the config on every pass. However, the vision explicitly mandates "one config file" with `lastScore` as the single piece of mutable state, and a second file complicates `init`, gitignore decisions, and the mental model. Keeping `lastScore` in the config means the baseline is versioned alongside the settings and travels with the repo. **Chosen: `lastScore` in the config file**, written atomically so only that field changes.

## Implementation Plan **[REQUIRED]**

Ordered phases; each maps to one or more future tasks created at decomposition. All depend on CIHA-I-0001 exposing `scan(config)` and `CihaConfig`/`loadConfig`.

- **Phase 1 — Gate semantics module (pure).** Implement the gate evaluator (formula + first-run seeding) and the atomic config writer as standalone, engine-independent modules with full unit tests. This is load-bearing and must be correct before anything wires to it.
  - *Recommended Agent: opus + medium* (small surface but correctness-critical: boundary math, seeding rule, atomic write-back invariants).
- **Phase 2 — CLI scaffolding & commands.** Wire `commander`, the `bin` entries, the config loader (delegating to the engine's `loadConfig`), and the three handlers (`init`, `scan`, `gate`/`scan --gate`), including the report formatter and `--json`. Implement the exit-code contract.
  - *Recommended Agent: opus + medium* (multi-file integration across parser, loader, engine call, formatter, and Phase-1 modules; must honor the exit-code contract exactly).
- **Phase 3 — Integration tests + fixtures.** Add the committed fixture repo(s) and end-to-end child-process tests (scan report, gate pass+seed, gate fail on a worsened fixture), with graceful skips when `scc`/`depcruise` are absent.
  - *Recommended Agent: sonnet + medium* (mechanical once the CLI and fixtures exist; follows the stated test matrix).
- **Phase 4 — GitHub Action + example workflow.** Author `action.yml` (composite) with the `scc`/`dependency-cruiser` install steps, `mode` input, `score` output, and job-summary write; add the example workflow and a smoke workflow.
  - *Recommended Agent: sonnet + medium* (YAML wiring to an already-tested binary; shape is fully specified in Detailed Design).
- **Phase 5 — Pre-commit/pre-push hook.** Ship the `.githooks/pre-commit` and `.githooks/pre-push` scripts and the `core.hooksPath` enablement instructions.
  - *Recommended Agent: haiku + low* (copy the specified script; no cross-file invariants).
- **Phase 6 — README & docs.** Write install steps, `scc`/`dependency-cruiser` prerequisites, full config reference, the three usage modes, and the exit-code contract table.
  - *Recommended Agent: sonnet + medium* (documentation synthesis of the finished behavior; single deliverable, defined content).