---
id: monorepo-per-project-scoring
level: initiative
title: "Monorepo Per-Project Scoring"
short_code: "CIHA-I-0003"
created_at: 2026-07-31T23:32:58.034326+00:00
updated_at: 2026-08-01T00:11:03.988915+00:00
parent: CIHA-V-0001
blocked_by: []
archived: false

tags:
  - "#initiative"
  - "#phase/decompose"


exit_criteria_met: false
estimated_complexity: M
strategy_id: NULL
initiative_id: monorepo-per-project-scoring
---

# Monorepo Per-Project Scoring Initiative

## Context **[REQUIRED]**

ci-health-audit v0.1 computes one 0–10 score for one `srcDir`. That model breaks
down on monorepos: a repo with `packages/*` and `apps/*` has many independently
evolving codebases, but the tool can only point at a single directory. In
practice this means real coverage gaps — e.g. `dcassil/code-audit` is configured
with `srcDir: ./packages`, so its entire `apps/` half (`cli`, `dashboard`, `mcp`,
`runner`, `server`) is never measured, and `colab`'s three workspaces collapse
into one blended number that hides which package is unhealthy.

Users want each codebase piece **recorded and tracked independently**: its own
score, its own baseline, its own regression gate. This initiative generalizes the
single-root model into a list of projects. A non-monorepo becomes a one-project
list, so there is a single unified code path rather than a special case. The
existing scan/score/gate engine is reused unchanged per project; the new work is
a projects layer above it (config, orchestration, gate aggregation, reporting,
and setup discovery). This is a backward-incompatible config change and ships as
a MAJOR release (v0.2.0); the 8 currently-deployed consumer configs are migrated
as part of rollout.

## Goals & Non-Goals **[REQUIRED]**

**Goals:**
- Score every declared project (package/app) in a repo independently, each with its own tracked `lastScore` baseline.
- Unify the config model so a non-monorepo is simply a one-project list — one code path, no legacy branch.
- Gate that fails if **any** project regresses beyond its own floor, and names the offending project(s) and delta.
- `init` that auto-discovers workspaces, falls back to prompting during setup, and persists an explicit `projects` list.
- Preserve every existing guarantee: determinism, no-I/O `scan`, atomic write-back, and a single headline number for the GitHub Action (the arithmetic mean of project scores).

**Non-Goals:**
- Cross-project dependency analysis or a repo-wide module graph. Each project is scanned in isolation, reusing today's pipeline.
- Any language beyond JS/TS (`language: "ts"` remains the only supported plugin).
- Historical trend storage, time-series, or dashboards — only the `lastScore` baseline persists, exactly as today.
- Auto-committing advanced baselines back to the repo from CI — write-back stays a local-run side effect, as today.
- A backward-compatible dual schema — the flat single-root shape is intentionally dropped (see Alternatives).

## Requirements **[CONDITIONAL: Requirements-Heavy Initiative]**

### User Requirements
- **User Characteristics**: JS/TS developers running the CLI locally or the published GitHub Action on mono- and poly-repos. Comfortable editing a JSON config.
- **System Functionality**: report per-project health scores; gate PRs on per-project regression; scaffold config that already knows the repo's packages.
- **User Interfaces**: the `ciha`/`ci-health-audit` CLI (`init`, `scan`, `gate`, `--json`) and the `dcassil/ci-health-audit` GitHub Action.

### System Requirements
- **Functional Requirements**:
  - REQ-001: The config carries a `projects` array. Each entry has `name`, `srcDir`, `lastScore`, plus optional `threshold`/`weights`/`baselines` overrides that deep-merge over the shared top-level defaults.
  - REQ-002: The unified model is the only model. A config with top-level `srcDir`/`lastScore` and no `projects` is rejected by the loader with a readable migration error (no silent dual path).
  - REQ-003: `scanProjects(config)` runs the existing single-root pipeline once per project (in config order) and returns a per-project `ScanResult`.
  - REQ-004: Report output (human + JSON) shows per-project score and metric breakdown; JSON includes a top-level `score` equal to the arithmetic mean of the project scores.
  - REQ-005: The gate evaluates each project against its **own** effective baseline + threshold; the overall decision is FAIL iff any project fails; the FAIL message names each failing project with its floor and delta.
  - REQ-006: On overall PASS, write-back atomically updates every project's `lastScore` in place, preserving key order and formatting. On FAIL, nothing is written.
  - REQ-007: `init` auto-discovers workspaces (`package.json` `workspaces` and `pnpm-workspace.yaml`), expands globs to package directories, and writes one project each; when none are found it falls back to a single root project, or an interactive prompt when run in a TTY.
  - REQ-008: The GitHub Action renders a per-project summary table and sets its `score` output to the mean project score.
- **Non-Functional Requirements**:
  - NFR-001 (Determinism): projects are scored in declared config order; identical inputs always yield identical output. No Map/Set iteration affects results.
  - NFR-002 (Purity): `scanProjects` performs no writes, no `process.exit`, no network — only the injected `CommandRunner` is impure, exactly as `scan` today.
  - NFR-003 (Atomicity): multi-project write-back uses the existing temp-file + `fsync` + `rename` strategy and can never corrupt the config on partial failure.
  - NFR-004 (Versioning): the breaking config change is released as a MAJOR bump (v0.2.0), and the loader's migration error explicitly guides the user to the new shape.

## Use Cases **[CONDITIONAL: User-Facing Initiative]**

### Use Case 1: Monorepo scan (report)
- **Actor**: Developer
- **Scenario**: Runs `ciha scan` in a repo whose config lists `core`, `cli`, `dashboard`. The engine scores each project's `srcDir` in turn.
- **Expected Outcome**: A per-project table (name, score, metric breakdown) plus a mean headline score; exit 0; config untouched.

### Use Case 2: Monorepo PR gate (fail-if-any)
- **Actor**: CI (GitHub Action, `mode: gate`)
- **Scenario**: On a PR, `core` improves to 8.1 but `cli` drops from 7.0 to 4.5 with `threshold: -2` (floor 5.0). The gate scores all projects, evaluates each against its own baseline, and aggregates.
- **Expected Outcome**: Overall FAIL; stderr names `cli` (floor 5.0, actual 4.5, delta −2.5); exit 1; no `lastScore` writes for any project.

### Use Case 3: Setup / discovery
- **Actor**: Developer
- **Scenario**: Runs `ciha init` in a pnpm monorepo. `pnpm-workspace.yaml` lists `packages/*` and `apps/*`; discovery expands them to the dirs containing a `package.json`.
- **Expected Outcome**: A config is written with one project per workspace (`lastScore: 0` each) and shared default weights/baselines/threshold. The first `scan`/`gate` seeds each baseline.

## Architecture **[CONDITIONAL: Technically Complex Initiative]**

### Overview
Introduce a **projects layer** above the existing engine. The proven
`config → plugin → graph → metrics → score` pipeline becomes the internal
per-project unit (`scanOne`); a new orchestrator maps it over the resolved
project list. Nothing inside `graph`/`metrics`/`scorer` changes.

### Component Diagrams
New / changed modules:
- `config/schema.ts` — add `projects[]`, per-project optional override fields.
- `config/resolveProjects.ts` **(new)** — deep-merge each project's overrides over shared defaults → array of effective single-project configs; enforce unique `name`, required `srcDir`; emit the legacy-config migration error.
- `index.ts` — rename today's `scan` internals to `scanOne(effectiveConfig)`; add `scanProjects(config): ProjectsResult`; export `ProjectsResult`.
- `gate/evaluate.ts` — add `evaluateGateAll(perProject)` reusing pure `evaluateGate` per project; overall = fail-if-any.
- `gate/writeConfig.ts` — add `writeLastScores(configPath, Map<name, score>)`: one atomic multi-field update preserving order/formatting.
- `cli/format.ts` — per-project human table + JSON with mean `score`.
- `cli/commands/scan.ts` — iterate projects, aggregate gate decision, call multi-write on PASS.
- `cli/commands/init.ts` — workspace discovery + TTY prompt fallback.
- `action.yml` — per-project summary table; `score` output = mean.

### Class Diagrams
Not an OOP-heavy design. Key types (fields described, not brace-literal to keep this doc lint-clean):
- `ProjectConfig` — fields `name`, `srcDir`, `lastScore`, plus optional `threshold`/`weights`/`baselines`.
- `EffectiveProjectConfig` — defaults merged; identical in shape to today's single-root `Config`, so the engine consumes it unchanged.
- `ProjectsResult` — a `projects` array (each element: `name`, `srcDir`, `result: ScanResult`) plus a numeric `score` (the mean).
- `GateAllResult` — an overall `decision` plus a `projects` array (each element: `name`, `gate: GateResult`).

### Sequence Diagrams
Gate flow: `loadConfig → resolveProjects → for each project (in order): scanOne → evaluateGate → collect → evaluateGateAll aggregates (FAIL if any) → PASS: writeLastScores(all) + exit 0 | FAIL: print failing projects to stderr + exit 0-skip-write + exit 1`. Scan flow is identical minus the gate/write steps, printing the per-project report instead.

### Deployment Diagrams
No infrastructure. Distribution is unchanged: an npm package (`npx ci-health-audit`) and a composite GitHub Action pinned by tag. This initiative cuts a new tag (v0.2.0) that consumer workflows reference.

## Detailed Design **[REQUIRED]**

**Config shape (v0.2.0):**
```jsonc
{
  "language": "ts",
  "threshold": -2,                     // shared default
  "weights":  { "ts": { "locPerModule": 0.2, "depDepth": 0.2, "circularDeps": 0.2, "complexity": 0.2, "fanInOut": 0.2 } },
  "baselines": { /* five metric baselines */ },   // shared default
  "projects": [
    { "name": "core", "srcDir": "./packages/core", "lastScore": 7.4 },
    { "name": "cli",  "srcDir": "./apps/cli", "lastScore": 6.1, "threshold": -3,
      "baselines": { "complexity": { "good": 8, "bad": 25, "direction": "lower-better" } } }
  ]
}
```

**Merge semantics (`resolveProjects`):** for each project, start from the shared
top-level `threshold`, `weights`, and `baselines`, then apply the project's optional
overrides. `threshold` is a scalar replace. `weights.ts` and `baselines` deep-merge
**per field** (a project may override a single metric baseline without restating
the other four). The result is an `EffectiveProjectConfig` byte-identical in shape
to today's single-root `Config`, so `scanOne` needs no awareness of projects.
Validation: `projects` non-empty; `name` unique and non-empty; `srcDir` required;
`lastScore` in [0,10]; reject unknown keys.

**Migration error:** if the parsed config has a top-level `srcDir` or `lastScore`
and no `projects`, `loadConfig` throws a readable error instructing the user to
provide a `projects` array — each entry carrying `name`, `srcDir`, and
`lastScore` — or to run `ciha init`, and pointing at the v0.2.0 migration notes.

**Engine:** `scanOne(effective)` is today's `scan` body verbatim. `scanProjects(config)`
resolves projects, maps `scanOne` in declared order, and returns a `projects`
array (each element carrying `name`, `srcDir`, and its `result`) plus a numeric
`score` equal to `round(Σ projectScore / n, 2)` — the arithmetic mean.

**Gate:** `evaluateGateAll` calls the existing pure `evaluateGate` once per project
(each against its own effective `lastScore`/`threshold`; the `lastScore === 0`
seeding rule applies per project). Overall `decision = 'fail'` iff any project fails.

**Write-back:** `writeLastScores(configPath, Map<name, newScore>)` reads the config,
matches each `projects[i]` by `name`, updates its `lastScore` (rounded to one
decimal, as today), re-serializes with `JSON.stringify(obj, null, 2)` (array +
key order preserved), and does the atomic temp+fsync+rename. Called only on overall
PASS; on FAIL nothing is written.

**Reporting:** human output prints one block per project (name, score, the existing
metric breakdown table) followed by the mean. `--json` emits a `projects` array
(each element carrying `name`, `score`, `breakdown`, and, in gate mode, `gate`)
plus a top-level `score` equal to the mean.

**`init` discovery:** read `package.json` `workspaces` (either an array, or an
object with a `packages` array) and `pnpm-workspace.yaml` `packages:`; union the
globs; expand to directories that contain a `package.json`; `name` = that package's
`name` (fallback: dir basename), `srcDir` = the package directory (scc/depcruise
walk the whole package). If none are found: a single project named `.` with
`srcDir` `./src` and `lastScore` `0`, or an interactive prompt to confirm/add
projects when `stdout.isTTY`. Shared defaults are
the current `DEFAULT_CONFIG` weights/baselines/threshold. `--force` overwrites.

## UI/UX Design

**Not applicable — this is a CLI/CI tool with no graphical interface.** The only
"UI" surfaces are the terminal report and the GitHub Action job summary, both
covered under Detailed Design → Reporting. The sole human-interaction change is
the per-project table and the mean headline line; no mockups, user flows, or
design-system integration apply.

## Testing Strategy **[CONDITIONAL: Separate Testing Initiative]**

### Unit Testing
- **Strategy**: Pure-function tests for each new unit with an injected fake so nothing shells out to `scc`/`depcruise`: `resolveProjects` (merge precedence, per-field baseline override, unique-name + missing-srcDir rejection, legacy-config migration error); `scanProjects` (order preserved, mean computed, one-project == today's single score) with an injected fake `scanOne`; `evaluateGateAll` (all-pass, one-fail-fails-overall, per-project seeding at `lastScore 0`); `writeLastScores` (multi-project update, key/array order + formatting preserved, atomic temp cleanup on failure); `init` discovery (npm array workspaces, npm object workspaces, pnpm-workspace.yaml, none→single root).
- **Coverage Target**: Match the repo's existing bar — effectively 100% of the new modules' lines/branches, consistent with the current engine's tests.
- **Tools**: The repo's existing test runner and assertion style (mirror `src/**` test conventions already in place for gate/scorer).

### Integration Testing
- **Strategy**: End-to-end CLI runs against a committed fixture monorepo (`packages/a`, `apps/b`) asserting the per-project table, the mean headline, `--json` shape, and gate exit codes (all-pass → 0 + writes; one-regressed → 1 + no writes).
- **Test Environment**: Local + CI, using real `scc`/`depcruise` over the fixture (the existing integration test already installs these).
- **Data Management**: Small deterministic fixture packages checked into the test tree; no external data.

### System Testing
- **Strategy**: After releasing v0.2.0, run the action against the real `code-audit` and `colab` repos and confirm per-project scores appear and gates behave.
- **User Acceptance**: Daniel reviews the per-project summary on a `code-audit` PR (now covering `apps/` too) and confirms it matches expectations.
- **Performance Testing**: Not a focus; scanning N projects is N sequential existing-pipeline runs. Acceptable for repo sizes in scope; note if a large monorepo makes runtime objectionable (possible future parallelism, out of scope here).

### Test Selection
Every new/changed pure module gets direct unit tests; the multi-project happy path and the fail-if-any path get integration coverage; the migration error and seeding edge cases are explicitly tested because they are the behaviors most likely to regress silently.

### Bug Tracking
Defects found during implementation are tracked as Metis backlog items or follow-up tasks under this initiative; regressions caught by the gate on consumer repos are triaged against this initiative until v0.2.0 is stable.

## Alternatives Considered **[REQUIRED]**

- **Dual schema (keep flat single-root + add `projects`)**: Rejected. Two code
  paths and two validation branches to maintain forever, and every downstream
  consumer (format, gate, action) would special-case both. Daniel chose to unify.
  Cost of unify: the 8 live configs must migrate — acceptable, and automated in
  Phase 8.
- **Auto-migrate legacy configs at load time (read flat as one-project)**: Rejected
  in favor of an explicit migration error. Silent coercion hides the breaking
  change and leaves stale flat configs in the wild; an error that names the fix is
  clearer for a MAJOR bump.
- **Repo-wide single module graph with per-package sub-scores**: Rejected.
  Cross-package edges and monorepo path aliasing make a unified graph
  non-deterministic and heavy, and would require changes deep in the graph/metrics
  layer. Isolated per-project scans reuse the proven pipeline untouched.
- **Gate on overall/average score only**: Rejected. Averaging lets a big
  improvement in one package mask a real regression in another — the exact failure
  we want to catch. Daniel chose fail-if-any; the mean is report-only.
- **Headline `score` = weakest-link minimum**: Considered and offered. Daniel chose
  the arithmetic **mean** as the more intuitive single repo-health number. The gate
  remains strictly per-project, so the headline being an average does not weaken
  regression protection.
- **Auto-discover workspaces on every scan**: Rejected. Non-deterministic across
  environments and adds per-run cost. Discovery runs once at `init`; the resolved
  list is persisted and is the sole runtime source of truth.
- **Per-project `srcDir` = `<pkg>/src` when present**: Rejected as implicit magic.
  `srcDir` is the package directory; users can point it at a subdir explicitly if
  they want. Predictable over clever.

## Implementation Plan **[REQUIRED]**

Decomposed into tasks under this initiative (each task carries its own
`Recommended Agent: <model> + <effort>` line per repo policy). Phases are ordered
by dependency; 1→5 are engine/CLI and can largely land before the release phases.

- **Phase 1 — Config schema + `resolveProjects`** (`opus + high`): add `projects[]`
  and override fields to the Zod schema; implement deep-merge, validation, and the
  legacy-config migration error. Load-bearing substrate every later phase consumes.
- **Phase 2 — Engine `scanProjects` + `ProjectsResult`** (`opus + high`): extract
  today's `scan` body as `scanOne`; add the orchestrator + mean; keep purity.
  Downstream gate/format depend on this contract.
- **Phase 3 — Gate `evaluateGateAll` + multi-project `writeLastScores`**
  (`opus + medium`): per-project evaluation with fail-if-any; atomic multi-field
  write-back preserving order/format.
- **Phase 4 — CLI report/JSON + `scan`/`gate` wiring** (`opus + medium`): per-project
  human table, JSON with mean, aggregated gate decision + PASS write.
- **Phase 5 — `init` auto-discovery + prompt fallback** (`opus + medium`): npm +
  pnpm workspace parsing, glob expansion, single-root/TTY fallback.
- **Phase 6 — `action.yml` per-project summary + mean output** (`sonnet + medium`):
  update the summary step and `score` output; refresh the example workflow.
- **Phase 7 — Integration tests + monorepo fixture** (`opus + medium`): end-to-end
  CLI over a fixture repo; exit-code and JSON assertions.
- **Phase 8 — Release v0.2.0 + migrate consumers** (`sonnet + medium`): tag v0.2.0;
  rewrite the 8 deployed configs to the `projects` shape (`colab`/`code-audit`
  multi-project and re-baselined; the other 6 single-project); bump workflows to
  `@v0.2.0`.
- **Docs — README update** (`sonnet + low`): document the `projects` config, the
  gate semantics, and the migration from v0.1.

Sequencing note: the initiative moves to `decompose` to create these as task
documents, then to `active` for execution.