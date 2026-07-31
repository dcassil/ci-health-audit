---
id: core-scanning-scoring-engine
level: initiative
title: "Core Scanning & Scoring Engine"
short_code: "CIHA-I-0001"
created_at: 2026-07-31T18:20:31.883174+00:00
updated_at: 2026-07-31T19:30:09.193165+00:00
parent: CIHA-V-0001
blocked_by: []
archived: false

tags:
  - "#initiative"
  - "#phase/completed"


exit_criteria_met: false
estimated_complexity: L
strategy_id: NULL
initiative_id: core-scanning-scoring-engine
---

# Core Scanning & Scoring Engine Initiative

## Context **[REQUIRED]**

The `ci-health-audit` vision (CIHA-V-0001) calls for a single, portable command-line tool that computes one **0–10 code health score** for a JS/TS codebase and drops unchanged into three contexts (GitHub Action, pre-commit/pre-push hook, manual CLI). That tool is a deliberate extraction of the *load-bearing 20%* of two heavier reference systems — `code-audit` (a pnpm monorepo with a scoring package, a plugin-based runner, an API server, a Postgres DB of scoring profiles/composites, an MCP server, and a dashboard) and its sibling `shore-guard`. The reference systems score on a **0–100** scale, keep weights and baselines in a database, mix `avg`/`max`/`p90` aggregations per metric, and require standing up server infrastructure. Most teams that want a health gate on CI do not want that infrastructure.

This initiative — **CIHA-I-0001, "Core Scanning & Scoring Engine"** — builds the pure computational heart of the tool: everything from *"here is a config and a source directory"* to *"here is a deterministic 0–10 health score with a per-metric breakdown."* It is explicitly **not** the runtime surface (CLI commands, gate/threshold comparison, `lastScore` write-back, GitHub Action, pre-commit hook, README) — that is CIHA-I-0002, which consumes this engine as a library. The split exists so the scoring core can be built, unit-tested for determinism, and stabilized before any runtime wiring depends on it.

The reference implementation was researched in precise detail in `research/code-audit-report.md`, which is the primary technical source for this initiative. It gives exact `file:line` references for the `ToolPlugin` seam, the `scc`/`dependency-cruiser` shell-outs, the graph builder (unique-edge fan-in/out), Tarjan SCC, SCC-condensed DAG longest-path depth, the linear normalization functions, and the default good/bad baseline table. This initiative **ports those algorithms and baselines faithfully** while making three deliberate simplifications mandated by the vision: (1) reduce all five metrics to a single **p75** value each (the reference uses a mix of avg/max/p90), (2) combine sub-scores with **equal weights** (the reference uses tuned weights), and (3) target a **0–10** scale (the reference targets 0–100, so every normalized value is divided by 10).

A key open design decision that this initiative must resolve is *how p75 is taken for each of the five metrics*, because two of them — dependency depth and circular dependencies — are whole-graph scalars in the reference, not per-module distributions. The Detailed Design section below makes a concrete, defensible decision for each of the five.

## Goals & Non-Goals **[REQUIRED]**

**Goals:**
- Stand up a single-package (NOT monorepo) TypeScript ESM npm package with strict tooling: `tsconfig` (strict), ESLint (strict, no escape hatches), Vitest, and a build step. The single-package structure is the entire point of the extraction.
- Define and validate the `ci-health-audit.config.json` schema with Zod: `{ language, srcDir, lastScore, threshold, weights, baselines }`, with `lastScore` defaulting to `0`.
- Preserve the `ToolPlugin { id, supports, run(ctx) }` scanner seam from the reference and a language-keyed registry, implementing **only** the JS/TS plugin now while keeping the seam clean for future languages.
- Implement the JS/TS scanner plugin: shell out to `scc --by-file --format json` (per-file Code LOC + Complexity) and `dependency-cruiser` (`depcruise --no-config --ts-pre-compilation-deps … --output-type json`) for the dependency graph, parsing both and filtering externals/node_modules exactly as the reference does.
- Build a directed module graph (unique edges, fan-in/fan-out degrees), run Tarjan SCC for circular dependencies, and compute SCC-condensed-DAG longest-path dependency depth — all ported from the reference algorithms.
- Compute the **five metrics** (LOC/module, dependency depth, circular deps, cyclomatic complexity, fan-in/fan-out) each reduced to a single **p75** value, with a documented, per-metric decision on how p75 is taken.
- Implement a deterministic **0–10 scorer** with **equal weights**: normalize each p75 metric to 0–10 against ported good/bad baselines and combine the five sub-scores equally, emitting one overall score plus a per-metric breakdown for explainability.
- Guarantee determinism: identical source + identical config ⇒ identical score across runs and machines (given fixed `scc`/`depcruise` versions).

**Non-Goals (owned by CIHA-I-0002 or explicitly out of scope):**
- CLI commands (`init`, `scan`), argument parsing, and terminal output formatting.
- Gate/threshold comparison logic, the `lastScore` write-back to config, and pass/fail exit codes.
- The GitHub Action wrapper and the pre-commit/pre-push hook wiring.
- README / usage documentation.
- Any second language plugin (Python, Rust, Go). The seam must not preclude them, but none is implemented.
- Any server, database, MCP, dashboard, network calls, or persistence beyond what CIHA-I-0002 later adds.
- Tuned/non-equal weights, per-language weight tuning, and dynamic composite definitions from the reference (deliberately dropped).
- Re-implementing `scc` or `dependency-cruiser` in-process (they are shelled out as in the reference).

## Requirements **[CONDITIONAL: Requirements-Heavy Initiative]**

### User Requirements
- **User Characteristics**: The direct "user" of this initiative's output is *another engineer* (the CIHA-I-0002 implementer) consuming this package as a library, plus the scoring core's own maintainers. They are TypeScript-fluent, expect strict typing and no escape hatches, and depend on the API being stable and deterministic. The eventual end-user (a developer running the CLI) never touches this layer directly.
- **System Functionality**: Consumers expect a single entrypoint that, given a validated config object and a source directory, returns a fully-typed result object containing the overall 0–10 score, the five per-metric p75 raw values, and the five per-metric 0–10 sub-scores — with no side effects (no writes, no network).
- **User Interfaces**: A programmatic TypeScript API only (exported functions/types). No CLI, no HTTP, no files written. The public surface is: config schema + loader, the scanner/registry, the plugin, the graph/metrics functions, and the scorer.

### System Requirements
- **Functional Requirements**:
  - REQ-001: The package MUST expose a Zod schema and loader that parses and validates `ci-health-audit.config.json` into a typed `Config` object, applying `lastScore` default `0` and `threshold` default `-2`.
  - REQ-002: The config schema MUST accept `language: "ts"`, `srcDir` (string path), `lastScore` (number 0–10), `threshold` (number, max allowed score drop before failing), `weights.ts` (the five equal weight keys `locPerModule`, `depDepth`, `circularDeps`, `complexity`, `fanInOut`), and `baselines` (per-metric good/bad/direction), and MUST reject unknown/malformed shapes with a clear error.
  - REQ-003: The package MUST define the `ToolPlugin { readonly id; readonly supports; run(ctx): Promise<ToolRunOutput> }` interface and a registry that resolves plugins by `language`.
  - REQ-004: A JS/TS `ToolPlugin` MUST be registered whose `supports.languages` includes the TS/JS aliases, and it MUST be the plugin resolved for `language: "ts"`.
  - REQ-005: The JS/TS plugin MUST run `scc --by-file --format json "<srcDir>"` and parse per-file `Code` (LOC) and `Complexity`, keeping only recognized code languages (JavaScript, TypeScript, JSX, TSX, TypeScript Typings — and the reference's broader set is retained but only JS/TS matter here).
  - REQ-006: The JS/TS plugin MUST run `depcruise --no-config --ts-pre-compilation-deps <tsconfigArg> --exclude "node_modules" --output-type json "<srcDir>/**/*.{ts,tsx,js,jsx}"`, parse `output.modules`, normalize paths, filter externals (`node_modules`, `node:` prefix, and paths without `/`), and deduplicate edges by `sourcePath|normalizedDep`.
  - REQ-007: The engine MUST build a directed graph where every module source is a node, every edge ensures both endpoints exist, adjacency sets deduplicate outgoing edges, and `fanOut`/`fanIn` are incremented once per unique `from→to` edge.
  - REQ-008: The engine MUST compute strongly connected components via Tarjan's algorithm and identify circular clusters as SCCs of size > 1.
  - REQ-009: The engine MUST compute dependency depth as the longest path through the SCC-condensed DAG, with condensed roots (indegree 0) starting at depth 1.
  - REQ-010: The engine MUST compute the five metrics each reduced to a single **p75** value per the per-metric aggregation decisions in Detailed Design.
  - REQ-011: The engine MUST normalize each of the five p75 values to a 0–10 sub-score using the ported linear good/bad normalization (0–100 formula divided by 10), honoring per-metric `direction`.
  - REQ-012: The scorer MUST combine the five sub-scores using **equal weights** taken from `weights.ts` and MUST emit the overall 0–10 score plus a per-metric breakdown (raw p75 value + sub-score) for explainability.
  - REQ-013: Percentile computation MUST use linear interpolation over sorted values, matching the reference (`index = (p/100)*(n-1)`, interpolate between floor/ceil).
  - REQ-014: The engine MUST expose a single top-level `scan(config, opts)`-style function that orchestrates config → resolve plugin → run plugin → build graph → compute metrics → score, returning the typed result.
- **Non-Functional Requirements**:
  - NFR-001 (Determinism): Given identical source, identical config, and identical `scc`/`depcruise` versions, the engine MUST produce a bit-identical score and breakdown across runs and machines. Any iteration over `Map`/`Set` that feeds a numeric result MUST be order-independent or explicitly sorted.
  - NFR-002 (No side effects): The engine MUST NOT write files, mutate the config, open network connections, or read anything outside the target `srcDir` (and the `tsconfig.json` search the reference performs).
  - NFR-003 (Strictness / no escape hatches): The codebase MUST pass strict ESLint and `tsc --strict` with zero inline disables, `any`/`unknown` casts through, `ts-ignore`, or `ts-expect-error`. External tool JSON is parsed through typed, validated parsers.
  - NFR-004 (Failure clarity): Missing `scc`/`depcruise` binaries, non-zero tool exits, and unparseable tool output MUST surface as typed, descriptive errors rather than silent zeros or crashes with opaque stack traces.
  - NFR-005 (Empty/degenerate graphs): Empty source dirs, single-file repos, and graphs with no edges MUST NOT throw; metrics MUST degrade to well-defined values (e.g. depth 0/1, empty distributions → 0) documented per metric.
  - NFR-006 (Testability seam): The plugin's shell-out MUST be injectable/mockable so unit tests can feed canned `scc`/`depcruise` JSON without invoking the real binaries.

## Architecture **[CONDITIONAL: Technically Complex Initiative]**

### Overview

The engine is a linear pipeline of pure-ish stages with one impure edge (the plugin's shell-out). Data flows:

```
config.json ──▶ Config Loader (Zod)
                     │  typed Config
                     ▼
              Plugin Registry ──resolve(language)──▶ ToolPlugin (JS/TS)
                     │                                     │ run(ctx)
                     │                          ┌──────────┴───────────┐
                     │                          ▼                      ▼
                     │                   scc --by-file          depcruise --no-config
                     │                   (per-file LOC +         (modules + deps →
                     │                    Complexity)             normalized edges)
                     │                          └──────────┬───────────┘
                     ▼                                     ▼  ToolRunOutput
              ┌───────────────────────────── Graph Builder ─────────────────────────────┐
              │  nodes, unique edges, fanIn/fanOut degrees, per-node LOC + complexity     │
              └───────────────────────────────────────┬─────────────────────────────────┘
                                                       ▼
                        Metrics: Tarjan SCC ──▶ circular clusters
                                 SCC-condensed DAG longest-path ──▶ depth
                                 per-node LOC / complexity / (fanIn+fanOut) distributions
                                                       │  five p75 values
                                                       ▼
                          Scorer: normalize each p75 → 0–10 (baselines, direction)
                                  combine with equal weights.ts
                                                       ▼
                            ScoreResult { overall: number, breakdown: MetricScore[] }
```

Each stage has a single, testable responsibility. The **only** impure stage is `ToolPlugin.run`, which is behind an injectable command-runner (NFR-006) so every downstream stage is deterministically testable against fixtures.

### Component Diagrams

Components (each a module directory under `src/`):

- **`config/`** — Zod schema + `loadConfig(json): Config`. Owns defaults (`lastScore=0`, `threshold=-2`) and the `weights`/`baselines` shapes. Depends on nothing internal.
- **`scanner/`** — the `ToolPlugin` interface, `ScanContext`/`ToolRunOutput` types, and the `PluginRegistry` (`register`, `resolve(language)`). Depends on nothing internal except shared types.
- **`plugins/ts/`** — the JS/TS `ToolPlugin` implementation: `scc` runner + parser, `depcruise` runner + parser, external filtering, edge dedup. Depends on `scanner/` (interface) and an injected `CommandRunner`.
- **`graph/`** — `buildGraph(modules, edges, fileStats)`, Tarjan `findSCCs`, `condense`+`longestPath` depth, and percentile/distribution stats. Depends on nothing internal except shared types.
- **`metrics/`** — reduces a built graph to the five p75 values. Depends on `graph/`.
- **`scorer/`** — normalization functions (`scoreLowerBetter`/`scoreHigherBetter`, rescaled to 0–10) + equal-weight combination. Depends on `config/` (baselines/weights) and `metrics/` (values).
- **`index.ts`** — the `scan()` orchestrator wiring all of the above.

### Sequence Diagrams

**Sequence of a single scan (`scan(config, { commandRunner })`):**

1. Caller passes an already-validated `Config` (or raw JSON, which `scan` runs through `loadConfig` first).
2. `scan` calls `registry.resolve(config.language)` → returns the JS/TS `ToolPlugin`.
3. `scan` builds a `ScanContext { srcDir, config, commandRunner }` and calls `plugin.run(ctx)`.
4. Inside `run`: the plugin invokes `commandRunner` for `scc --by-file --format json "<srcDir>"`, parses per-file `Code`/`Complexity` into `FileStats[]`.
5. The plugin searches upward from `srcDir` for `tsconfig.json`, then invokes `commandRunner` for the `depcruise` command, parses `output.modules` into normalized `modules` + deduped `edges`, filtering externals.
6. `run` returns `ToolRunOutput { raw, fileStats, modules, edges }`.
7. `scan` calls `buildGraph(output)` → a `ModuleGraph` with nodes, adjacency, `fanIn`/`fanOut` maps, and per-node LOC/complexity attached from `fileStats`.
8. `scan` calls `computeMetrics(graph)`:
   - `findSCCs(graph)` (Tarjan) → SCC list; circular clusters = SCCs with size > 1.
   - `condense(graph, sccs)` → DAG; `longestPath(dag)` with roots at depth 1 → depth scalar.
   - per-node distributions for LOC, complexity, and fan-in+fan-out.
   - reduce each of the five to its p75 per the Detailed Design decisions.
9. `scan` calls `score(metrics, config.baselines, config.weights.ts)`:
   - normalize each p75 → 0–10 sub-score (direction-aware).
   - combine the five with equal weights → overall 0–10.
10. `scan` returns `ScanResult { score, breakdown, rawMetrics }`. No writes, no exits — that is CIHA-I-0002's job.

## Detailed Design **[REQUIRED]**

### File Layout (single package, ESM)

```
ci-health-audit/
├── package.json            # "type": "module", bin left for CIHA-I-0002, exports the lib
├── tsconfig.json           # strict, NodeNext module resolution, ESM
├── eslint.config.mjs       # strict, no escape hatches (guard-rails style)
├── vitest.config.ts
├── src/
│   ├── index.ts            # scan() orchestrator + public re-exports
│   ├── config/
│   │   ├── schema.ts       # Zod schema + Config type
│   │   └── loadConfig.ts   # parse + defaults + friendly errors
│   ├── scanner/
│   │   ├── types.ts        # ToolPlugin, ScanContext, ToolRunOutput, CommandRunner
│   │   └── registry.ts     # PluginRegistry.register / resolve(language)
│   ├── plugins/
│   │   └── ts/
│   │       ├── plugin.ts   # TsToolPlugin (id "ts")
│   │       ├── scc.ts      # runScc(ctx) + parseScc(json) -> FileStats[]
│   │       └── depcruise.ts# runDepcruise(ctx) + parseDepcruise(json) -> {modules,edges}
│   ├── graph/
│   │   ├── builder.ts      # buildGraph()
│   │   ├── scc.ts          # findSCCs (Tarjan), condense, longestPath depth
│   │   └── stats.ts        # computePercentiles / distribution (p25..p99)
│   ├── metrics/
│   │   └── computeMetrics.ts
│   └── scorer/
│       ├── normalize.ts    # scoreLowerBetter / scoreHigherBetter (0–10)
│       └── score.ts        # equal-weight combination + breakdown
└── test/
    ├── graph.test.ts, metrics.test.ts, scorer.test.ts, config.test.ts
    ├── fixtures/            # canned scc/depcruise JSON + known-answer graphs
    └── integration/        # tiny real fixture repo scanned end-to-end
```

### Config Schema (`config/schema.ts`)

```ts
const metricBaseline = z.object({
  good: z.number(),
  bad: z.number(),
  direction: z.enum(["lower-better", "higher-better"]),
});

const tsWeights = z.object({
  locPerModule: z.number(),
  depDepth: z.number(),
  circularDeps: z.number(),
  complexity: z.number(),
  fanInOut: z.number(),
});

export const configSchema = z.object({
  language: z.literal("ts"),                 // only "ts" for now; keeps seam open
  srcDir: z.string().default("./src"),
  lastScore: z.number().min(0).max(10).default(0),
  threshold: z.number().default(-2),          // max points the score may fall before failing (used by CIHA-I-0002)
  weights: z.object({ ts: tsWeights }),       // equal weights for now, e.g. all 1
  baselines: z.object({
    locPerModule: metricBaseline,
    depDepth: metricBaseline,
    circularDeps: metricBaseline,
    complexity: metricBaseline,
    fanInOut: metricBaseline,
  }),
});
export type Config = z.infer<typeof configSchema>;
```

`loadConfig(raw)` runs `configSchema.parse` and rethrows Zod errors as a single readable message. Equal weights are expressed as equal numeric values (e.g. all `1`, or all `0.2`); the scorer normalizes by total weight so the absolute magnitude is irrelevant, but the *default* config ships all five at `1`.

### Scanner Seam (`scanner/types.ts`)

Ported faithfully from `apps/runner/src/plugins/tools/interface.ts:9-22` and the `ScanContext`/`ToolRunOutput` shapes, trimmed to what the standalone tool needs:

```ts
export type Language = "ts" | "js" | "typescript" | "javascript";

export interface ToolSupport {
  languages?: Language[];
}

export interface CommandRunner {
  run(command: string, cwd: string): string;   // returns stdout; injectable for tests (NFR-006)
}

export interface ScanContext {
  srcDir: string;
  config: Config;
  runner: CommandRunner;
}

export interface ModuleEntry { source: string; dependencies: string[]; }
export interface Edge { fromPath: string; toPath: string; }
export interface FileStats { path: string; loc: number; complexity: number; }

export interface ToolRunOutput {
  raw: unknown;
  fileStats: FileStats[];
  modules: ModuleEntry[];
  edges: Edge[];
}

export interface ToolPlugin {
  readonly id: string;
  readonly supports: ToolSupport;
  run(ctx: ScanContext): Promise<ToolRunOutput>;
}
```

`PluginRegistry.resolve(language)` returns the first registered plugin whose `supports.languages` includes that language (mirroring `registry.ts:55-67`). Only `TsToolPlugin` (`id: "ts"`, `supports.languages: ["ts","js","typescript","javascript"]`) is registered; the seam is otherwise untouched so a future `PyToolPlugin` slots in with no core change.

### JS/TS Plugin (`plugins/ts/`)

- **`scc.ts`** shells `scc --by-file --format json "<srcDir>"` via `ctx.runner`, parses the JSON language groups, keeps only recognized code languages (JavaScript, TypeScript, JSX, TSX, TypeScript Typings — reference keeps a broader set at `scc.ts:124-130`; we retain it but only JS/TS are relevant), and for each file records `{ path, loc: Code, complexity: Complexity }`. (Reference: `scc.ts:41-50`, `scc.ts:101-107`.)
- **`depcruise.ts`** searches upward from `srcDir` for `tsconfig.json` (reference `depcruise.ts:141-153`), then shells:
  `depcruise --no-config --ts-pre-compilation-deps <tsConfigArg> --exclude "node_modules" --output-type json "<srcDir>/**/*.ts" "…/**/*.tsx" "…/**/*.js" "…/**/*.jsx"` (reference `depcruise.ts:50-63`). It parses `output.modules`, normalizes source/dependency paths, filters externals with the reference predicate `filePath.includes("node_modules") || filePath.startsWith("node:") || !filePath.includes("/")` (reference `depcruise.ts:162-164`), deduplicates edges by `sourcePath|normalizedDep`, and emits `edges` + `modules`.

### Graph Construction (`graph/builder.ts`)

Ported from `builder.ts:19-75`. Every module `source` becomes a node; every edge ensures both endpoints exist; adjacency `Set`s dedupe outgoing edges; on each *new* unique `from→to`: `fanOut[from]++`, `fanIn[to]++`, and the reverse adjacency records `to→from`. Per-node `loc`/`complexity` are attached by matching `FileStats.path` to node ids. The graph exposes `nodes: Set<string>`, `adj: Map<string,Set<string>>`, `fanIn: Map<string,number>`, `fanOut: Map<string,number>`, and `nodeStats: Map<string,{loc,complexity}>`.

### The Five p75 Metric Decisions (the crux)

The reference stores several per-node distributions but its *default* scorer draws avg/max/p90 scalars, and depth/circular-deps are whole-graph scalars with no meaningful per-module distribution. The vision mandates a uniform p75 for all five. Below is the concrete, defensible decision for **each** metric, plus the fallback when a distribution is degenerate. Percentiles use the reference's linear-interpolation `computePercentiles` (`stats.ts:29-41`), standard set p25/p50/**p75**/p90/p95/p99.

1. **LOC per module** — genuinely a per-module distribution. **Decision: p75 over per-node `loc`** across all graph nodes (filtering `loc <= 0`, matching reference `metrics.ts:69-72`). Fallback: empty distribution → `0`. Rationale: this is exactly the distribution the reference already computes and exposes as `locP75`; taking p75 is a faithful, meaningful reduction (75% of modules are at or below this size).

2. **Cyclomatic complexity** — per-file/per-module distribution from `scc` `Complexity`. **Decision: p75 over per-node `complexity`** (filtering `complexity <= 0`, matching `metrics.ts:73-75`; the reference already exposes `complexityP75`). Fallback: empty → `0`.

3. **Fan-in/fan-out** — per-module degrees. The reference's default `fan` metric is the whole-graph scalar `maxFanIn + maxFanOut`, but per-node in/out degrees are a real distribution. **Decision: build a per-node combined-coupling distribution `couple[node] = fanIn[node] + fanOut[node]` over all nodes, and take its p75.** This preserves the reference's "in+out coupling" intent while giving a robust p75 instead of a max that a single hub node dominates. Fallback: no nodes → `0`; a graph with nodes but zero edges → all values `0` → p75 `0`.

4. **Dependency depth** — a **whole-graph scalar** in the reference (`maxDependencyDepth`, longest path through the SCC-condensed DAG, roots at depth 1; `scc.ts:119-145`). There is no natural per-module distribution for "the graph's depth." **Decision: compute a per-node depth distribution — `depth[node]` = the longest path length from any condensed root down to that node's SCC (the same forward-longest-path relaxation the reference already runs, but *retaining every node's* resolved depth rather than only the max) — and take p75 over those per-node depths.** This is meaningful (75% of modules sit at or below this depth in the dependency DAG) and is a strict generalization of the reference: the reference's `maxDepth` is the p100 of exactly this distribution. **Fallback:** if the distribution is degenerate (≤1 distinct value, e.g. a flat graph or a single node), fall back to the whole-graph scalar `maxDependencyDepth` so depth never collapses to a misleadingly small p75. Empty graph → `0`.

5. **Circular dependencies** — also a **whole-graph scalar** in the reference (`totalCircularDeps` = sum of sizes of SCCs with size > 1; `metrics.ts:87-90`). A p75 "over modules" of a mostly-zero indicator is not meaningful (most repos have no cycles, so p75 would be `0` and hide real cycles). **Decision: take p75 over the *per-SCC sizes of the circular clusters* (the SCCs with size > 1).** Concretely: `circularP75 = p75(cycleClusters.map(c => c.length))`. This answers "how big is a typical cycle cluster," which is the health-relevant signal, and it is robust to one giant tangle. **Fallback:** if there are **no** circular clusters, `circularP75 = 0` (the healthy case). If there is exactly one cluster, p75 of a single value is that value (correct). Rationale for not using per-module ratio: `totalCircularDeps/modules` is a ratio, not a distribution, and cannot be p75'd; per-SCC size is the only place a distribution exists, and its p75 degrades gracefully to `0` when clean.

Summary table of aggregation choices:

| Metric | Distribution p75 is taken over | Degenerate fallback |
|---|---|---|
| `locPerModule` | per-node LOC (loc > 0) | empty → 0 |
| `complexity` | per-node complexity (complexity > 0) | empty → 0 |
| `fanInOut` | per-node (fanIn + fanOut) | no nodes → 0 |
| `depDepth` | per-node longest-path depth from roots | ≤1 distinct value → whole-graph `maxDepth`; empty → 0 |
| `circularDeps` | per-SCC cluster size (size > 1) | no clusters → 0 |

### Normalization (`scorer/normalize.ts`)

Ported from `scoringFns.ts:7-17` and **rescaled to 0–10** by dividing by 10 (the report's `score0to10 = score0to100 / 10`). Rather than compute 0–100 and divide, we fold the `/10` into the constant so there is a single rounding step:

```ts
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

// lower-is-better: value at/below good → 10, at/above bad → 0
export function scoreLowerBetter(value: number, good: number, bad: number): number {
  const t = (value - good) / (bad - good);
  return Math.round((1 - clamp01(t)) * 1000) / 100;   // 0..10, 2 decimals
}

// higher-is-better: value at/above good → 10, at/below bad → 0
export function scoreHigherBetter(value: number, good: number, bad: number): number {
  const t = (value - bad) / (good - bad);
  return Math.round(clamp01(t) * 1000) / 100;         // 0..10, 2 decimals
}
```

(`* 1000 / 100` is the 0–100 formula's `* 10000 / 100` with the `/10` rescale applied, preserving 2-decimal rounding on the 0–10 scale.) All five core metrics are `lower-better` (bigger modules, deeper graphs, more cycles, higher complexity, tighter coupling are all worse), so `scoreHigherBetter` is retained only for seam-completeness/future baselines. The special logarithmic LOC-*scale* function (`scoringFns.ts:19-29`) and the `roots`/`orphan`/`edges` metrics are **not** part of this tool's five metrics and are dropped.

### Baseline Table (ported from the report, `baselines.ts:4-17`, rescaled context)

The five active baselines are seeded from the reference defaults, adapted to the p75 metric they now score. Baselines are in *raw metric units* (not 0–10) — they feed `scoreLowerBetter(rawP75, good, bad)`:

| Config key | good | bad | direction | Ported from reference baseline |
|---|---|---|---|---|
| `locPerModule` | 50 | 150 | lower-better | `avgLoc { good:50, bad:150 }` (the report's LOC/module baseline; applied to p75 LOC) |
| `depDepth` | 5 | 20 | lower-better | `depth { good:5, bad:20 }` |
| `circularDeps` | 0 | 3 | lower-better | derived from cycles intent; healthy = 0 clusters, bad = clusters of size ≥ 3 (report scores cycles as a ratio `good:0, bad:0.30`; since we p75 per-cluster *size*, we set good=0/bad=3 so any non-trivial cluster tank the sub-score) |
| `complexity` | 5 | 20 | lower-better | `avgComplexity { good:5, bad:20 }` (applied to p75 complexity) |
| `fanInOut` | 6 | 30 | lower-better | derived from `fan` intent; the report's whole-graph `fan { good:30, bad:200 }` is `maxFanIn+maxFanOut` across the *whole* graph, but our metric is *per-module* (fanIn+fanOut) p75, which is ~an order of magnitude smaller, so good=6/bad=30 keeps the sub-score meaningful for a per-module value |

The two derived baselines (`circularDeps`, `fanInOut`) are the only places the port *cannot* be a literal copy, because the aggregation changed from whole-graph scalar to a per-unit distribution; the chosen values reproduce the reference's *severity intent* on the new units and are documented above so they can be tuned later.

### Scorer Combination (`scorer/score.ts`)

```ts
export interface MetricScore { metric: string; rawP75: number; subScore: number; weight: number; }
export interface ScanResult { score: number; breakdown: MetricScore[]; }

export function score(m: Metrics, baselines: Baselines, weights: TsWeights): ScanResult {
  const parts: MetricScore[] = [
    mk("locPerModule", m.locPerModule, baselines.locPerModule, weights.locPerModule),
    mk("depDepth",     m.depDepth,     baselines.depDepth,     weights.depDepth),
    mk("circularDeps", m.circularDeps, baselines.circularDeps, weights.circularDeps),
    mk("complexity",   m.complexity,   baselines.complexity,   weights.complexity),
    mk("fanInOut",     m.fanInOut,     baselines.fanInOut,     weights.fanInOut),
  ];
  const totalW = parts.reduce((s, p) => s + p.weight, 0);
  const score = parts.reduce((s, p) => s + p.weight * p.subScore, 0) / totalW; // weighted mean → 0..10
  return { score: Math.round(score * 100) / 100, breakdown: parts };
}
```

`mk` applies `scoreLowerBetter`/`scoreHigherBetter` by the baseline's `direction`. Because weights are equal and the sum is normalized by `totalW`, the overall score is the **plain mean of the five sub-scores** — but expressing it as a normalized weighted sum keeps the seam open for non-equal weights without a code change (only config changes). This differs deliberately from the reference's un-normalized weighted sum (`scoringStyles.ts:69-79`), which relied on weights summing to 1.0; normalizing by `totalW` makes "all weights = 1" valid and robust.

## Testing Strategy **[CONDITIONAL: Separate Testing Initiative]**

### Unit Testing
- **Strategy**: Vitest, table-driven, against **known-answer fixtures** so every deterministic stage is pinned:
  - **Graph algorithms** (`graph/`): hand-built small graphs with hand-computed answers — a linear chain (depth = length), a diamond, a 3-node cycle (one SCC of size 3), two disjoint cycles, a self-loop (must NOT count as circular, per reference), and a hub node (fan-in/out). Assert Tarjan SCC membership, condensed-DAG longest-path depth (roots at depth 1), and unique-edge fan-in/out counts.
  - **Percentile/stats** (`stats.ts`): assert linear-interpolation p75 against hand-computed values, including single-element and empty arrays.
  - **The five p75 decisions** (`metrics/`): fixtures that exercise each degenerate fallback — empty graph, single node, flat graph (depth fallback to whole-graph max), zero cycles (`circularDeps` p75 → 0), one giant cycle vs many small cycles.
  - **Scorer determinism** (`scorer/`): golden tests mapping a fixed metrics object + fixed baselines/weights to an exact 0–10 score and breakdown; boundary cases at/below `good` (→10) and at/above `bad` (→0), and mid-range interpolation; assert the overall equals the plain mean under equal weights.
  - **Config** (`config/`): valid config round-trips; `lastScore`/`threshold` defaults applied; malformed shapes rejected with a Zod error.
  - **Plugin parsers** (`plugins/ts/`): feed canned `scc` and `depcruise` JSON through the parsers via a mocked `CommandRunner` (NFR-006); assert `FileStats`, external filtering, and edge dedup.
- **Coverage Target**: 100% of `graph/`, `metrics/`, `scorer/`, and the plugin *parsers* (the pure logic); ≥90% overall. The impure shell-out itself is covered by the integration test, not unit-mocked coverage inflation.
- **Tools**: Vitest + `@vitest/coverage-v8`.

### Integration Testing
- **Strategy**: One end-to-end test that runs the **real** `TsToolPlugin` (real `scc` + real `depcruise`) against a tiny committed fixture repo (`test/integration/fixture-repo/`) with a known structure (~5–8 TS modules including one deliberate 2-module cycle and one deep chain). Assert the overall score is within a tight tolerance of a pinned expected value and that the breakdown metrics match expected raw p75 values.
- **Test Environment**: Local + CI. The test is guarded to `skip` (not fail) with a clear message if `scc`/`depcruise` are not on `PATH`, so contributors without the binaries can still run the unit suite; CI installs both so the integration test actually runs there.
- **Data Management**: The fixture repo and its expected-score snapshot are committed. Regenerating the snapshot is a deliberate, reviewed action (guards against silently rubber-stamping a scoring regression). Tool versions (`dependency-cruiser` pinned in `package.json`, `scc` version recorded) are fixed to keep the snapshot stable (NFR-001).

### Test Selection
Prioritize (1) the graph algorithms and (2) the five p75-decision fallbacks and (3) scorer determinism — these are the load-bearing, easy-to-get-subtly-wrong pieces. Config validation and parser tests are next. UI/output formatting is out of scope (CIHA-I-0002).

### Bug Tracking
Defects found during this initiative are logged as Metis tasks/backlog items under CIHA-I-0001; a scoring-math defect (wrong metric/normalization/aggregation) is treated as highest priority because it silently corrupts the single number the whole product exists to produce.

## Alternatives Considered **[REQUIRED]**

- **Re-implement `scc`/`dependency-cruiser` in-process (ts-morph/madge) vs shell out.** Rejected. The reference deliberately shells out to these mature tools; re-implementing cyclomatic complexity and TS-aware dependency resolution would be a large, bug-prone effort that diverges from the reference's proven numbers. Shelling out preserves fidelity and keeps the package small. Cost: two external binaries as runtime deps (accepted per vision constraints).
- **Monorepo (pnpm workspaces) vs single package.** Rejected the monorepo. The entire point of this extraction is to escape the reference's multi-package weight. A single ESM package is simpler to publish, `npx`-run, and reason about, and there is no second consumer to justify workspace splits.
- **Keep the 0–100 scale vs rescale to 0–10.** Rejected keeping 0–100. The vision fixes a 0–10 scale everywhere. We fold the `/10` into the normalization constant (single rounding step) rather than computing 0–100 then dividing, avoiding double-rounding drift.
- **Per-metric aggregation: keep the reference's avg/max/p90 mix vs uniform p75.** Rejected the mix. The vision mandates uniform p75 for consistency and explainability. The non-trivial cost is that depth and circular-deps have no natural per-module distribution; addressed by the explicit per-metric decisions (per-node depth distribution with whole-graph-max fallback; per-SCC-size distribution for cycles). We considered simply using the whole-graph scalar for depth/cycles (ignoring "p75"), but that would break the uniform-p75 promise; the chosen distributions make p75 meaningful while degrading to the reference scalar exactly where a distribution isn't.
- **Circular-deps as per-module ratio (`totalCircularDeps/modules`) vs per-SCC-size p75.** Rejected the ratio. A ratio is not a distribution and cannot be p75'd; p75 over a mostly-zero per-module cycle indicator would read `0` even when real cycles exist. Per-SCC-cluster-size p75 answers the health-relevant question and degrades to `0` cleanly when there are no cycles.
- **Un-normalized weighted sum (reference, weights must sum to 1.0) vs normalize by total weight.** Rejected the un-normalized form. Normalizing by `Σweight` lets the default config use `all weights = 1`, is robust to any weight magnitudes, and makes the equal-weights case exactly the mean — while still leaving room for future non-equal weights via config only.
- **Non-injectable direct `execSync` vs injectable `CommandRunner`.** Rejected direct exec in the core path. An injectable runner (NFR-006) is what makes the whole pipeline deterministically unit-testable against canned tool JSON without the binaries; the real `execSync` runner is the default implementation.

## Implementation Plan **[REQUIRED]**

Ordered phases; each maps cleanly to one or a few future Metis tasks. Model/effort recommendations follow the global rubric.

- **Phase 1 — Project scaffolding & tooling** *(opus + high — foundational; every downstream task depends on the strictness substrate)*. Single ESM package: `package.json` (`type: module`, exports), strict `tsconfig.json` (NodeNext), strict `eslint.config.mjs` with no escape hatches, Vitest config, build script. Pin `dependency-cruiser`; document `scc`. CI target that runs lint + typecheck + unit tests. Acceptance: `npm run lint && npm run typecheck && npm test` all green on an empty skeleton.
- **Phase 2 — Config schema + loader** *(opus + low — a couple of files, clear design)*. Zod schema, `Config` type, `loadConfig` with defaults (`lastScore=0`, `threshold=-2`) and friendly errors; ship a default config with equal weights and the ported baseline table. Unit tests (REQ-001/002).
- **Phase 3 — Scanner seam + registry** *(opus + medium — the extensibility seam is load-bearing for the vision's "add a language" promise)*. `ToolPlugin`/`ScanContext`/`ToolRunOutput`/`CommandRunner` types and `PluginRegistry.resolve(language)`. Unit tests for resolution (REQ-003/004).
- **Phase 4 — JS/TS plugin: parsers first, then runners** *(opus + medium — integration with two external tool formats, plus external-filter/dedup correctness)*. Implement `parseScc` and `parseDepcruise` (pure, unit-tested against canned JSON) before wiring the real `execSync` `CommandRunner` and the `tsconfig.json` upward search (REQ-005/006, NFR-006).
- **Phase 5 — Graph builder + algorithms** *(opus + high — Tarjan SCC and SCC-condensed longest-path are subtle and every metric depends on them)*. `buildGraph` (unique edges, fan-in/out), Tarjan `findSCCs`, `condense` + `longestPath` depth, linear-interpolation percentiles. Exhaustive known-answer unit tests (REQ-007/008/009/013).
- **Phase 6 — Five p75 metrics** *(opus + high — this is where the documented per-metric decisions and degenerate fallbacks live; getting the distributions/fallbacks wrong corrupts the score)*. Implement `computeMetrics` producing the five p75 values with the exact decisions and fallbacks from Detailed Design; fixture tests per fallback (REQ-010).
- **Phase 7 — 0–10 scorer** *(opus + medium — small but the determinism-critical rounding/normalization must be exact)*. `scoreLowerBetter`/`scoreHigherBetter` (0–10), equal-weight normalized combination, `ScanResult` breakdown. Golden determinism tests (REQ-011/012, NFR-001).
- **Phase 8 — `scan()` orchestrator + integration test** *(opus + medium — wires all stages and validates against the real tools)*. `src/index.ts` orchestration (REQ-014) and the end-to-end integration test on the committed fixture repo with a pinned expected score (NFR-004/005). Exit criterion: a real JS/TS repo yields a stable, reproducible 0–10 score with a full per-metric breakdown, entirely as a library — ready for CIHA-I-0002 to add the runtimes.