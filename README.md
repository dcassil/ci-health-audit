# ci-health-audit

Deterministic 0–10 code health score for JS/TS codebases.

One number — computed the same way on every machine, on every run — tells you whether your codebase got healthier or sicker since the last baseline. No opinion drift, no hidden randomness, no vendor lock-in: just five well-understood structural metrics, each measured at the p75 percentile across your modules, normalized against a calibrated baseline table, and averaged into a single 0–10 score.

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

### Local build (until npm publish)

The package is not yet published. Clone and build it:

```bash
git clone https://github.com/your-org/ci-health-audit.git
cd ci-health-audit
npm ci
npm run build
# Binaries are now at dist/cli/main.js
```

---

## Quick start

```bash
# 1. Scaffold a config in the root of the repo you want to audit
node /path/to/ci-health-audit/dist/cli/main.js init

# 2. (Optional) Edit ci-health-audit.config.json — adjust srcDir, threshold, weights
#    All defaults work out-of-the-box for a standard TypeScript project

# 3. Run a scan and see the score table
node /path/to/ci-health-audit/dist/cli/main.js scan
```

Once published to npm, replace `node /path/to/ci-health-audit/dist/cli/main.js` with `npx ci-health-audit` or `npx ciha`.

---

## Config reference

`ci-health-audit init` writes a `ci-health-audit.config.json` with the defaults shown below. Every field is optional except `language`.

### Top-level fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `language` | `"ts"` | — (required) | Language to scan. Only `"ts"` is supported. |
| `srcDir` | `string` | `"./src"` | Relative path to the source directory to scan. |
| `lastScore` | `number` (0–10) | `0` | Score from the last gate pass. `0` means unseeded (first run always passes). Updated automatically on gate PASS. |
| `threshold` | `number` (negative) | `-2` | Maximum allowed score drop before the gate fails. E.g. `-2` allows a drop of up to 2 points. |
| `weights.ts.<metric>` | `number` | `0.2` each | Per-metric weight used in the weighted mean. Equal weights (all `0.2`) produce a plain average of the five sub-scores. |
| `baselines.<metric>.good` | `number` | see table | Raw metric value at which a module scores 10/10. |
| `baselines.<metric>.bad` | `number` | see table | Raw metric value at which a module scores 0/10. |
| `baselines.<metric>.direction` | `"lower-better"` \| `"higher-better"` | see table | Whether lower raw values are healthier. |

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
node dist/cli/main.js scan

# Report + machine-readable JSON
node dist/cli/main.js scan --json

# Gate: fail exit 1 on regression; write back lastScore on pass
node dist/cli/main.js gate

# Gate with custom config path
node dist/cli/main.js gate --config ./infra/ci-health-audit.config.json

# scan with --gate flag is identical to the gate command
node dist/cli/main.js scan --gate

# Force-overwrite an existing config during init
node dist/cli/main.js init --force
```

Exit codes follow the contract in the table below.

---

### Mode 2 — GitHub Actions

The action is composite: it installs `scc`, builds the tool from its own source, installs `dependency-cruiser` in the consumer repo, runs the audit, and writes a job summary.

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
| `score` | Numeric overall health score (0–10) |

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
        uses: your-org/ci-health-audit@v1
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
        uses: your-org/ci-health-audit@v1
        with:
          config: "./ci-health-audit.config.json"
          mode: gate
          fail-on-regression: "true"
```

> Until the package is published to npm, replace `uses: your-org/ci-health-audit@v1` with `uses: ./` and add a prior checkout step that checks out the action's repo into a known path. See `.github/workflows/health-audit.example.yml` for a working local-reference example.

---

### Mode 3 — Pre-commit / pre-push hooks

#### Native git hooks (core.hooksPath)

The repo ships `.githooks/pre-commit` and `.githooks/pre-push`. Point git at that directory once:

```bash
git config core.hooksPath .githooks
```

Both hooks run `npx --no-install ci-health-audit gate` and block the operation on gate failure. Once the package is on npm, `npx --no-install` resolves the binary from your `node_modules/.bin` (you must have `ci-health-audit` in `dependencies` or `devDependencies`). During local development substitute the full `node` invocation:

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
| `0` | Scan report printed (no gate), or gate PASS (score within threshold or first-run seeding) |
| `1` | Gate FAIL — `newScore < lastScore + threshold` |
| `2` | Config or usage error — missing/unreadable/invalid config, unknown command, `init` refusing overwrite without `--force` |

---

## Gate formula

```
floor = lastScore + threshold          # threshold is negative, e.g. -2
PASS  ⟺  newScore >= floor             # boundary (newScore === floor) passes
FAIL  ⟺  newScore <  floor
```

**First-run seeding:** when `lastScore === 0` (the `init` default), the run is always a PASS regardless of `newScore`. The computed score is written back to `lastScore` in `ci-health-audit.config.json`. From the second run on, normal comparison applies.

On PASS the tool atomically updates `lastScore` in the config file. On FAIL it writes nothing — the baseline is preserved for the next attempt.

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
Weighted mean  Σ(weight × subScore) / Σ(weight)  →  overall 0–10 score
```

### Normalization

For a `lower-better` metric (all five defaults):

```
subScore = clamp(10 × (bad − rawP75) / (bad − good), 0, 10)
```

`rawP75 ≤ good` → 10/10. `rawP75 ≥ bad` → 0/10. Linear interpolation between.

For a `higher-better` metric the formula is inverted. The direction is configurable per metric via `baselines.<metric>.direction`.

### Weighted mean

With equal weights (all `0.2`) the overall score is the plain arithmetic mean of the five sub-scores. Non-equal weights let you emphasize metrics that matter more for your team — e.g. set `circularDeps` to `0.4` to penalize cycles harder while keeping everything else at `0.15`.

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
