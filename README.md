# ci-health-audit

Deterministic 0–10 code health score for JS/TS codebases.

One number — computed the same way on every machine, on every run — tells you whether your codebase got healthier or sicker since the last baseline. No opinion drift, no hidden randomness, no vendor lock-in: just five well-understood structural metrics, each measured at the p75 percentile across your modules, normalized against a calibrated baseline table, and averaged into a single 0–10 score.

**v0.2.0** extends the model to monorepos: a single config can score every package or app in a repo independently, each with its own baseline and regression gate. A non-monorepo is simply a one-project list — there is one unified code path, no special case.

Use it in three ways: as a CLI report tool, as a blocking GitHub Actions gate, or as a pre-commit / pre-push hook.

---

## Prerequisites

| Tool | Version | Why |
|------|---------|-----|
| [Node.js](https://nodejs.org/) | ≥ 20 | Runtime |
| [scc](https://github.com/boyter/scc) | ≥ 3.5.0 | Lines-of-code and cyclomatic complexity per file |
| [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) | ≥ 16 | Module graph (edges, fan-in/fan-out, depth, cycles) |

Install `scc` (Go binary, no Node required):

```bash
# macOS
brew install scc

# Linux (replace ARCH with amd64 or arm64)
curl -fsSL https://github.com/boyter/scc/releases/download/v3.5.0/scc_Linux_amd64.tar.gz \
  | tar -xz -C /usr/local/bin scc
```

Install `dependency-cruiser` in the project being scanned:

```bash
npm install --save-dev dependency-cruiser
# or without saving:
npm install --no-save dependency-cruiser
```

### Install

Run it on demand with `npx` (no install needed):

```bash
npx ci-health-audit --help
```

…or add it to a project as a dev dependency (exposes the `ci-health-audit` and `ciha` bins):

```bash
npm install --save-dev ci-health-audit
```

`dependency-cruiser` ships as a dependency of the package, so `npx`/local installs make it available automatically; you only need `scc` on your `PATH` (see Prerequisites above).

> Building from source instead? Clone the repo, `npm ci && npm run build`, then run `node dist/cli/main.js`.

---

## Quick start

```bash
# 1. Scaffold a config in the root of the repo you want to audit
#    ciha init auto-discovers npm/pnpm workspaces and writes one project per package
npx ci-health-audit init

# 2. (Optional) Edit ci-health-audit.config.json — adjust srcDir, threshold, weights
#    All defaults work out-of-the-box for a standard TypeScript project

# 3. Run a scan and see the per-project score table
npx ci-health-audit scan
```

`npx ciha …` is a shorter alias for the same binary.

---

## Config reference

`ci-health-audit init` writes a `ci-health-audit.config.json`. As of **v0.2.0** the config uses a unified per-project model: shared top-level defaults plus a `projects` array. Every field is optional except `language` and the `projects` array.

### Top-level fields (shared defaults)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `language` | `"ts"` | — (required) | Language to scan. Only `"ts"` is supported. |
| `threshold` | `number` (negative) | `-2` | Shared default: maximum allowed score drop before the gate fails. Each project inherits this unless it overrides it. |
| `weights.ts.<metric>` | `number` | `1` each | Shared default: per-metric weight used in the weighted mean. Equal weights produce a plain average of the five sub-scores. |
| `baselines.<metric>.good` | `number` | see table | Shared default: raw metric value at which a module scores 10/10. |
| `baselines.<metric>.bad` | `number` | see table | Shared default: raw metric value at which a module scores 0/10. |
| `baselines.<metric>.direction` | `"lower-better"` \| `"higher-better"` | see table | Whether lower raw values are healthier. |
| `projects` | array | — (required) | Non-empty list of projects to score. See per-project fields below. |

### Per-project fields (`projects[*]`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | yes | Unique, non-empty identifier for the project shown in reports and gate output. |
| `srcDir` | `string` | yes | Relative path to the source directory to scan for this project. |
| `lastScore` | `number` (0–10) | yes | Score from the last gate pass. `0` means unseeded — first gate run always passes and seeds the baseline. Updated automatically on gate PASS. |
| `threshold` | `number` (negative) | no | Per-project override: replaces (not merges) the shared `threshold`. |
| `weights` | `{ ts: { ... } }` | no | Per-project override: any subset of the five metric weights — deep-merged per field over the shared default (only specified fields are replaced). |
| `baselines` | `{ <metric>: { ... } }` | no | Per-project override: any subset of the five metric baselines — deep-merged per metric over the shared default (only specified metrics are replaced). |

### Override merge semantics

When a project specifies optional overrides:

- **`threshold`** — scalar replace: the project's value fully replaces the shared default.
- **`weights.ts`** — deep-merge per field: only the fields you list are overridden; unspecified metric weights inherit the shared value.
- **`baselines`** — deep-merge per metric: only the metrics you list are overridden; unspecified metrics inherit the shared baseline.

The resolved per-project config (after merging) is called an `EffectiveProjectConfig` internally. The scan engine operates on these resolved configs with no awareness of the projects layer.

### Config examples

#### Monorepo — multiple projects with one per-project override

```json
{
  "language": "ts",
  "threshold": -2,
  "weights": {
    "ts": {
      "locPerModule": 1,
      "depDepth": 1,
      "circularDeps": 1,
      "complexity": 1,
      "fanInOut": 1
    }
  },
  "baselines": {
    "locPerModule": { "good": 50, "bad": 150, "direction": "lower-better" },
    "depDepth":     { "good": 5,  "bad": 20,  "direction": "lower-better" },
    "circularDeps": { "good": 0,  "bad": 3,   "direction": "lower-better" },
    "complexity":   { "good": 5,  "bad": 20,  "direction": "lower-better" },
    "fanInOut":     { "good": 6,  "bad": 30,  "direction": "lower-better" }
  },
  "projects": [
    {
      "name": "core",
      "srcDir": "./packages/core",
      "lastScore": 7.4
    },
    {
      "name": "cli",
      "srcDir": "./apps/cli",
      "lastScore": 6.1,
      "threshold": -3,
      "baselines": {
        "complexity": { "good": 8, "bad": 25, "direction": "lower-better" }
      }
    }
  ]
}
```

In this example, `cli` has a looser `threshold` of `-3` (floor 3.1) and a customized `complexity` baseline; it inherits all other shared defaults unchanged. `core` inherits everything from the shared defaults.

#### Single project (non-monorepo)

A non-monorepo is simply a one-element `projects` list:

```json
{
  "language": "ts",
  "threshold": -2,
  "weights": {
    "ts": {
      "locPerModule": 1,
      "depDepth": 1,
      "circularDeps": 1,
      "complexity": 1,
      "fanInOut": 1
    }
  },
  "baselines": {
    "locPerModule": { "good": 50, "bad": 150, "direction": "lower-better" },
    "depDepth":     { "good": 5,  "bad": 20,  "direction": "lower-better" },
    "circularDeps": { "good": 0,  "bad": 3,   "direction": "lower-better" },
    "complexity":   { "good": 5,  "bad": 20,  "direction": "lower-better" },
    "fanInOut":     { "good": 6,  "bad": 30,  "direction": "lower-better" }
  },
  "projects": [
    {
      "name": ".",
      "srcDir": "./src",
      "lastScore": 0
    }
  ]
}
```

### Default baseline table

| Metric key | `good` | `bad` | `direction` | What it measures |
|------------|--------|-------|-------------|------------------|
| `locPerModule` | 50 | 150 | `lower-better` | Lines of code per module (p75) |
| `depDepth` | 5 | 20 | `lower-better` | Maximum dependency chain depth (p75) |
| `circularDeps` | 0 | 3 | `lower-better` | Number of modules involved in circular imports (p75) |
| `complexity` | 5 | 20 | `lower-better` | Cyclomatic complexity per module (p75) |
| `fanInOut` | 6 | 30 | `lower-better` | Fan-in + fan-out (total edges) per module (p75) |

### What the five metrics mean

**`locPerModule`** — the 75th percentile of raw lines-of-code counts across all modules in `srcDir`. Large modules are harder to read, test, and change safely.

**`depDepth`** — the 75th percentile of the longest import chain reachable from each module. Deep dependency stacks amplify blast radius when a low-level module changes.

**`circularDeps`** — the 75th percentile of the count of modules that participate in at least one import cycle. Circular imports cause initialization surprises and make isolation impossible.

**`complexity`** — the 75th percentile of cyclomatic complexity (as measured by `scc`) per module. Higher complexity means more branches to test and more cognitive load per function.

**`fanInOut`** — the 75th percentile of total import edges (fan-in + fan-out) per module. High coupling in either direction constrains safe refactoring.

All five use p75 rather than mean or max: the mean hides long tails; the max is sensitive to a single outlier; p75 captures the shape of your distribution without letting one pathological file dominate the score.

---

## Usage modes

### Mode 1 — CLI report and gate

```bash
# Report only (never writes config, never fails on regression)
npx ci-health-audit scan

# Report + machine-readable JSON
npx ci-health-audit scan --json

# Gate: fail exit 1 on regression; write back lastScore on pass
npx ci-health-audit gate

# Gate with custom config path
npx ci-health-audit gate --config ./infra/ci-health-audit.config.json

# scan with --gate flag is identical to the gate command
npx ci-health-audit scan --gate

# Force-overwrite an existing config during init
npx ci-health-audit init --force
```

Exit codes follow the contract in the table below.

#### Scan report output

`ciha scan` prints a per-project block (name, score, metric breakdown table) for every project in the config, followed by a **mean headline** — the arithmetic mean of all project scores, rounded to two decimal places:

```
core  7.4 / 10
  locPerModule   8.2
  depDepth       6.1
  ...

cli   6.1 / 10
  locPerModule   5.8
  ...

Overall (mean): 6.75 / 10
```

#### JSON output (`--json`)

`ciha scan --json` (or `ciha gate --json`) emits a single JSON object:

```json
{
  "score": 6.75,
  "projects": [
    {
      "name": "core",
      "score": 7.4,
      "breakdown": {
        "locPerModule": 8.2,
        "depDepth": 6.1,
        "circularDeps": 10.0,
        "complexity": 7.0,
        "fanInOut": 5.8
      }
    },
    {
      "name": "cli",
      "score": 6.1,
      "breakdown": {
        "locPerModule": 5.8,
        "depDepth": 7.0,
        "circularDeps": 10.0,
        "complexity": 4.0,
        "fanInOut": 3.8
      },
      "gate": {
        "decision": "pass",
        "floor": 3.1,
        "delta": 3.0
      }
    }
  ]
}
```

The top-level `score` is the arithmetic mean of all project scores. The `gate` key appears on each project element when running in gate mode.

---

### Mode 2 — GitHub Actions

The action is composite: it installs `scc`, builds the tool from its own source, installs `dependency-cruiser` in the consumer repo, runs the audit, and writes a per-project job summary table.

**Inputs**

| Input | Default | Description |
|-------|---------|-------------|
| `config` | `./ci-health-audit.config.json` | Path to config file |
| `mode` | `scan` | `scan` (report only) or `gate` (fail on regression) |
| `working-directory` | `.` | Directory of the repo being scanned |
| `node-version` | `20` | Node.js version |
| `scc-version` | `3.5.0` | scc release to download |
| `fail-on-regression` | `true` | When `mode=gate`, whether to propagate exit 1 |

**Outputs**

| Output | Description |
|--------|-------------|
| `score` | Mean health score across all projects (0–10) |

The action renders a per-project summary table in the GitHub job summary. The `score` output is the arithmetic mean of all project scores (matching the CLI headline).

**Example workflow**

```yaml
name: "Health Audit"

on:
  pull_request:
    branches: [main]
  schedule:
    - cron: "0 6 * * 1"   # Weekly on Monday at 06:00 UTC

jobs:
  # ── Scan: report-only, never fails the build ───────────────────────────────
  health-scan:
    name: "CI Health Scan"
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4

      - name: Run health scan
        id: audit
        uses: dcassil/ci-health-audit@v0.2.0
        with:
          config: "./ci-health-audit.config.json"
          mode: scan

      - name: Report score
        run: echo "Health score: ${{ steps.audit.outputs.score }}"

  # ── Gate: fail the job on regression ───────────────────────────────────────
  health-gate:
    name: "CI Health Gate"
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4

      - name: Run health gate
        uses: dcassil/ci-health-audit@v0.2.0
        with:
          config: "./ci-health-audit.config.json"
          mode: gate
          fail-on-regression: "true"
```

> The action installs `scc` and runs the published npm package via `npx`, so a consumer repo only needs the `uses:` reference above. Pin to a released tag (e.g. `@v0.2.0`) for reproducible CI. To develop against the action inside this repo, use `uses: ./` — see `.github/workflows/health-audit.example.yml`.

---

### Mode 3 — Pre-commit / pre-push hooks

#### Native git hooks (core.hooksPath)

The repo ships `.githooks/pre-commit` and `.githooks/pre-push`. Point git at that directory once:

```bash
git config core.hooksPath .githooks
```

Both hooks run `npx --no-install ci-health-audit gate` and block the operation on gate failure. `--no-install` resolves the binary from your `node_modules/.bin`, so add the package to the repo first:

```bash
npm install --save-dev ci-health-audit
```

If you prefer running from source during local development, substitute the full `node` invocation:

```bash
# .githooks/pre-commit (local dev version)
#!/bin/sh
node /path/to/ci-health-audit/dist/cli/main.js gate || {
  echo "ci-health-audit gate failed — commit blocked." >&2
  exit 1
}
```

#### Husky alternative

```bash
npm install --save-dev husky
npx husky init

# pre-commit hook
echo 'npx --no-install ci-health-audit gate' > .husky/pre-commit

# pre-push hook
echo 'npx --no-install ci-health-audit gate' > .husky/pre-push
```

---

## Exit-code contract

| Code | Meaning |
|------|---------|
| `0` | Scan report printed (no gate), or gate PASS (all projects within threshold or first-run seeding) |
| `1` | Gate FAIL — at least one project regressed beyond its floor |
| `2` | Config or usage error — missing/unreadable/invalid config, unknown command, `init` refusing overwrite without `--force` |

---

## Gate semantics

### Per-project gate formula

Each project is evaluated independently against its own effective baseline and threshold:

```
floor = lastScore + threshold          # threshold is negative, e.g. -2
PASS  ⟺  newScore >= floor             # boundary (newScore === floor) passes
FAIL  ⟺  newScore <  floor
```

### Fail-if-any aggregation

The overall gate decision is **FAIL if any project fails**. On failure, stderr names each failing project with its floor and delta. On pass, every project's `lastScore` is updated atomically.

**Example:** a config with `core` (score 8.1, pass) and `cli` (score 4.5, floor 5.0, fail) produces an overall FAIL naming `cli` — even though `core` improved.

### First-run seeding

When a project's `lastScore === 0` (the `init` default), that project's gate run is always a PASS regardless of its `newScore`. The computed score is written back to `lastScore`. From the second run on, normal comparison applies. Seeding applies per project — a new project added to an existing config seeds on its first run while other projects gate normally.

### Write-back

On overall PASS, the tool atomically updates every project's `lastScore` in the config file (temp-file + fsync + rename). On any FAIL, nothing is written — baselines are preserved for the next attempt.

---

## `init` auto-discovery

`ciha init` auto-discovers workspaces so you do not have to list packages by hand:

1. Reads `package.json` `workspaces` (either an array of globs, or an object with a `packages` array of globs) if present.
2. Reads `pnpm-workspace.yaml` `packages:` if present.
3. Expands all discovered globs to directories that contain a `package.json`.
4. Writes one project per discovered package, using the package's `name` field (falling back to the directory basename) as the project `name` and the package directory as `srcDir`. All projects start with `lastScore: 0`.

**Fallback:** when no workspaces are found, `init` writes a single root project (`name: "."`, `srcDir: "./src"`, `lastScore: 0`). When running in a TTY (interactive terminal), it may prompt you to confirm or add projects.

`--force` overwrites an existing config without prompting.

---

## How the score is computed

```
scc   (LOC + cyclomatic complexity per file)
  +
depcruiser  (module graph: edges, cycles, chain depths)
  ↓
Module graph  (one node per file in srcDir, edges = import relationships)
  ↓
Five p75 metrics  (one number per metric, 75th percentile across all nodes)
  ↓
Normalize each metric to 0–10  (linear interpolation between good/bad baseline)
  ↓
Weighted mean  Σ(weight × subScore) / Σ(weight)  →  per-project 0–10 score
  ↓
Arithmetic mean of project scores  →  headline 0–10 score
```

Projects are scanned in declared config order. Each project's `srcDir` is scanned in isolation — there is no cross-project module graph.

### Normalization

For a `lower-better` metric (all five defaults):

```
subScore = clamp(10 × (bad − rawP75) / (bad − good), 0, 10)
```

`rawP75 ≤ good` → 10/10. `rawP75 ≥ bad` → 0/10. Linear interpolation between.

For a `higher-better` metric the formula is inverted. The direction is configurable per metric via `baselines.<metric>.direction`.

### Weighted mean

With equal weights (all `1`) the overall score is the plain arithmetic mean of the five sub-scores. Non-equal weights let you emphasize metrics that matter more for your team — e.g. set `circularDeps` to `2` to penalize cycles harder while keeping everything else at `1`.

---

## Migrating from v0.1 → v0.2

v0.2.0 is a breaking config change. The flat single-root shape (top-level `srcDir` and `lastScore`) is **rejected** by the loader. If you run `ciha scan` or `ciha gate` with a v0.1 config you will see:

```
Error: ci-health-audit v0.2.0 dropped the flat single-root config. This config has a
top-level "srcDir"/"lastScore" and no "projects" array.
Migrate to the per-project model: provide a "projects" array where each entry has
"name", "srcDir", and "lastScore" (shared "threshold"/"weights"/"baselines" stay at
the top level as defaults), or run `ciha init` to scaffold it.
See the v0.2.0 migration notes for details.
```

### What changed

**Before (v0.1 — rejected in v0.2.0):**

```json
{
  "language": "ts",
  "srcDir": "./src",
  "lastScore": 6.8,
  "threshold": -2,
  "weights": {
    "ts": {
      "locPerModule": 1,
      "depDepth": 1,
      "circularDeps": 1,
      "complexity": 1,
      "fanInOut": 1
    }
  },
  "baselines": {
    "locPerModule": { "good": 50, "bad": 150, "direction": "lower-better" },
    "depDepth":     { "good": 5,  "bad": 20,  "direction": "lower-better" },
    "circularDeps": { "good": 0,  "bad": 3,   "direction": "lower-better" },
    "complexity":   { "good": 5,  "bad": 20,  "direction": "lower-better" },
    "fanInOut":     { "good": 6,  "bad": 30,  "direction": "lower-better" }
  }
}
```

**After (v0.2.0):**

```json
{
  "language": "ts",
  "threshold": -2,
  "weights": {
    "ts": {
      "locPerModule": 1,
      "depDepth": 1,
      "circularDeps": 1,
      "complexity": 1,
      "fanInOut": 1
    }
  },
  "baselines": {
    "locPerModule": { "good": 50, "bad": 150, "direction": "lower-better" },
    "depDepth":     { "good": 5,  "bad": 20,  "direction": "lower-better" },
    "circularDeps": { "good": 0,  "bad": 3,   "direction": "lower-better" },
    "complexity":   { "good": 5,  "bad": 20,  "direction": "lower-better" },
    "fanInOut":     { "good": 6,  "bad": 30,  "direction": "lower-better" }
  },
  "projects": [
    {
      "name": ".",
      "srcDir": "./src",
      "lastScore": 6.8
    }
  ]
}
```

The key changes:
- `srcDir` and `lastScore` move from the top level into a `projects` array entry.
- `threshold`, `weights`, and `baselines` remain at the top level as shared defaults.
- Every entry in `projects` requires a `name`, `srcDir`, and `lastScore`.

### Migration options

**Option 1 — Hand-edit** (recommended for single-repo or when you want to keep your existing baseline):

Move `srcDir` and `lastScore` into a `projects` array as shown above. Shared fields (`threshold`, `weights`, `baselines`) stay at the top level.

**Option 2 — Re-scaffold with `ciha init`**:

```bash
npx ci-health-audit init --force
```

This overwrites the config with a freshly discovered `projects` list (and resets all `lastScore` to `0`, so the first gate run re-seeds your baselines).

### GitHub Actions

Update your workflow's `uses:` references from `@v0.1.x` to `@v0.2.0`:

```yaml
uses: dcassil/ci-health-audit@v0.2.0
```

---

## Development

```bash
# Install dependencies
npm ci

# Build (TypeScript → dist/)
npm run build

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Type-check (without emitting)
npm run typecheck

# Lint
npm run lint
```

Tests use [Vitest](https://vitest.dev/) and inject fake engine implementations so they never shell out to `scc` or `depcruiser`.

---

## License

MIT
