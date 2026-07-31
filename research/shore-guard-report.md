# Shore Guard / Shore Runner Code Health Scoring Report

Source inspected:
- `shore-runner/src`
- `shore-guard-web/src`

Target comparison focus: scoring and scanning logic only.

## Short Answer

This implementation splits scanning from scoring. `shore-runner` checks out code, shells out to scanner binaries, computes structural metrics, and posts metrics/detail. `shore-guard-web` validates the runner payload and recomputes health/cost/risk app-side before persistence.

Important mismatch with the requested 0-10 framing: the code computes health on a `0..100` scale, not `0..10`. DB storage also uses `smallint check (... between 0 and 100)` for health/cost/risk. A standalone 0-10 package would need an explicit `/ 10` display normalization.

There are no default per-language scoring weights in the inspected implementation. There is a `projectType:language` criteria-profile resolver, but the ingest path uses one active global `scoring_config` row for weights/criteria/composites and does not resolve per repo language.

## Scanner Interfaces and Architecture

The scanner architecture is a small explicit plugin registry, not auto-discovery. Tool plugins implement:

```ts
export interface ToolPlugin {
  readonly id: string
  readonly supports: ToolSupport
  run(ctx: ScanContext): Promise<ScannerOutput>
}

export interface ToolSupport {
  languages?: Language[]
  types?: ProjectType[]
}
```

Reference: `shore-runner/src/plugins/tools/interface.ts:9-31`.

Scanner outputs are capability-based:

```ts
export interface ScannerOutput {
  metrics?: Partial<RawMetrics>
  fileStats?: FileStats[]
  graph?: ScannerGraph
  findings?: ScanFinding[]
}
```

Reference: `shore-runner/src/domain/metrics.ts:83-99`.

Registration is manual:

```ts
toolRegistry.register(new SccToolPlugin())
toolRegistry.register(new DepcruiseToolPlugin())
toolRegistry.register(new PydepsToolPlugin())
toolRegistry.register(new CargoDepgraphToolPlugin())
```

Reference: `shore-runner/src/runner/bootstrap.ts:23-39`. The file comments state that adding a scanner means "a new class plus one register line" and "NO auto-discovery or DI container" at `shore-runner/src/runner/bootstrap.ts:5-7`.

Execution flow:

```ts
const tools = this.toolRegistry.resolve(repo)
const { toolResults, toolOutputs, findings } = await this.runTools(tools, ctx)
const aggregated = aggregateToolOutputs(toolOutputs)
...
metrics: rawToScanMetrics(aggregated.metrics),
clusters: aggregated.clusters,
modules: aggregated.modules,
edges: aggregated.edges,
findings,
```

Reference: `shore-runner/src/runner/ScanRunner.ts:71-94`.

Tool filtering is by `supports.languages`, `supports.types`, plus `tools.include/exclude` from repo config. Reference: `shore-runner/src/plugins/tools/registry.ts:25-46`.

## External Tool Dependencies

The runner shells out to external binaries:

- `scc`: LOC and complexity for all languages. `SccToolPlugin.supports = {}` means universal. References: `shore-runner/src/plugins/tools/scc.ts:14-18`, `shore-runner/src/plugins/tools/scc.ts:84-91`.
- `dependency-cruiser` via `depcruise`: JS/TS graph scanner. References: `shore-runner/src/plugins/tools/depcruise.ts:17-21`, `shore-runner/src/plugins/tools/depcruise.ts:89-103`.
- `pydeps`: Python graph scanner. References: `shore-runner/src/plugins/tools/pydeps.ts:16-20`, `shore-runner/src/plugins/tools/pydeps.ts:76-84`.
- `cargo-depgraph`: Rust graph scanner. References: `shore-runner/src/plugins/tools/cargoDepgraph.ts:16-20`, `shore-runner/src/plugins/tools/cargoDepgraph.ts:44-60`.

The Dockerfile bakes in these four tools and names their roles:

```dockerfile
#   - scc              (Go)            lines-of-code / complexity metrics
#   - depcruise        (npm, global)   JS/TS dependency graph (dependency-cruiser)
#   - pydeps           (pip)           Python dependency graph
#   - cargo-depgraph   (cargo)         Rust dependency graph
```

Reference: `shore-runner/Dockerfile:1-8`; install commands are at `shore-runner/Dockerfile:59-73`. `shore-runner/README.md:21-30` repeats the same tool table.

I found no `madge` or `ts-morph` usage in `shore-runner/src` or `shore-guard-web/src`. JS/TS scanning is `scc` + `depcruise`.

## Metric Computation

### LOC and Complexity

`scc` runs as:

```ts
execSync(`scc --by-file --format json "${targetPath}"`, ...)
```

Reference: `shore-runner/src/plugins/tools/scc.ts:77-91`.

The parser includes only known code languages, sums `Code` into LOC, sums `Complexity`, tracks max complexity, and stores per-file stats:

```ts
loc += stat.code
complexity += stat.complexity
maxComp = Math.max(maxComp, stat.complexity)
files++
fileStats.push(stat)
```

Reference: `shore-runner/src/plugins/tools/scc.parse.ts:16-43`. File fields come from `Location/Filename`, `Lines`, `Code`, `Comments`, `Blank`, and `Complexity` at `shore-runner/src/plugins/tools/scc.parse.ts:46-67`.

Note: the implementation treats `scc`'s `Complexity` as the complexity metric. It does not independently compute cyclomatic complexity via AST tooling.

### JS/TS Dependency Graph

For JS/TS, `depcruise` supports `['js', 'ts', 'javascript', 'typescript']` and runs:

```ts
depcruise --no-config --ts-pre-compilation-deps ${tsConfigArg} \
  --exclude "node_modules" --output-type json \
  "${targetPath}/**/*.ts" "${targetPath}/**/*.tsx" "${targetPath}/**/*.js" "${targetPath}/**/*.jsx"
```

Reference: `shore-runner/src/plugins/tools/depcruise.ts:17-21`, `shore-runner/src/plugins/tools/depcruise.ts:89-103`.

Parsing normalizes module paths, skips external deps (`node_modules`, `node:`, and paths without `/`), dedupes edges, and emits `{ modules, edges }`. Reference: `shore-runner/src/plugins/tools/depcruise.parse.ts:14-35`, `shore-runner/src/plugins/tools/depcruise.parse.ts:38-91`.

### Graph, Fan-In, Fan-Out

The graph builder registers nodes, directed adjacency, reverse adjacency, and fan counts. Duplicate edges are ignored:

```ts
fromAdj.add(to);
graph.fanOut.set(from, (graph.fanOut.get(from) ?? 0) + 1);
graph.fanIn.set(to, (graph.fanIn.get(to) ?? 0) + 1);
graph.revAdj.get(to)?.add(from);
```

Reference: `shore-runner/src/graph/builder.ts:31-45`.

`getOrphans` means `fanIn === 0 && fanOut === 0`; `getRoots` means `fanIn === 0`; `getExports` means `fanIn > 0`. References: `shore-runner/src/graph/builder.ts:67-107`.

Fan-in and fan-out distributions are computed over all graph node values, including zeros:

```ts
const fanIn = computeFanStats(Array.from(graph.fanIn.values()))
const fanOut = computeFanStats(Array.from(graph.fanOut.values()))
```

Reference: `shore-runner/src/graph/metrics.ts:37-38`.

### Circular Dependencies and Dependency Depth

Cycles use Tarjan SCCs:

```ts
const sccs = findSCCs(graph)
const cycleClusters = sccs.filter(scc => scc.length > 1)
const maxDepth = calculateMaxDepth(graph, sccs)
```

Reference: `shore-runner/src/graph/metrics.ts:20-24`; Tarjan implementation is in `shore-runner/src/graph/scc.ts:10-73`.

`totalCircularDeps` is not an edge count; it is the number of modules in SCCs with size greater than 1:

```ts
const totalCircularDeps = cycleClusters.reduce((sum, c) => sum + c.length, 0)
```

Reference: `shore-runner/src/graph/metrics.ts:40-43`.

Max dependency depth collapses SCCs into a DAG, finds root SCCs with indegree 0, then computes the longest path in SCC-nodes:

```ts
const nodeToScc = buildNodeToScc(sccs);
const condensedAdj = buildCondensedAdj(graph, sccs, nodeToScc);
const roots = findCondensedRoots(sccs.length, condensedAdj);
...
return longestDepthFromRoots(roots, condensedAdj);
```

Reference: `shore-runner/src/graph/scc.ts:170-183`.

### Percentiles and Distribution Aggregation

Percentiles are `p25/p50/p75/p90/p95/p99` with linear interpolation:

```ts
const index = (p / 100) * (sortedValues.length - 1)
...
return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight
```

Reference: `shore-runner/src/graph/stats.ts:25-41`; standard percentile set at `shore-runner/src/graph/stats.ts:46-61`.

LOC and complexity distributions are per graph module after enriching modules with `scc` file stats. Zero/null values are filtered out:

```ts
const locValues = modules.map(m => m.loc ?? 0).filter(l => l > 0)
const complexityValues = modules.map(m => m.complexity ?? 0).filter(c => c > 0)
```

Reference: `shore-runner/src/graph/metrics.ts:29-35`. Per-module LOC/complexity matching is exact path or `endsWith(filePath)` at `shore-runner/src/graph/metrics.helpers.ts:27-35`.

The emitted LOC metrics are:

```ts
avgLocPerFile: sccResult.totalFiles > 0 ? sccResult.linesOfCode / sccResult.totalFiles : 0,
avgLocPerModule: nodeCount > 0 ? sccResult.linesOfCode / nodeCount : 0,
medianLocPerFile: locStats.percentiles.p50,
p90LocPerFile: locStats.percentiles.p90,
locPercentiles: locStats.percentiles,
```

Reference: `shore-runner/src/graph/metrics.ts:53-99`.

The naming is slightly messy: `medianLocPerFile` and `p90LocPerFile` are derived from `modules`, not directly from all `scc` code files.

### Health Metrics From Graph

Graph health indicators are:

```ts
couplingFactor: maxPossibleEdges > 0 ? totalEdges / maxPossibleEdges : 0,
orphanRatio: nodeCount > 0 ? orphanCount / nodeCount : 0,
cycleRatio: nodeCount > 0 ? totalCircularDeps / nodeCount : 0,
avgClusterSize: cycleClusterCount > 0 ? totalCircularDeps / cycleClusterCount : 0,
godFileCount,
```

`godFileCount` uses hardcoded thresholds: LOC > 500 or complexity > 50.

Reference: `shore-runner/src/graph/metrics.helpers.ts:96-113`.

## Score Aggregation Formula

Scoring is app-side. The runner payload accepts optional `scores`, but `/api/runner/results` always recomputes:

```ts
const allScores = calculateAllScores(result.metrics, criteria, weights)
const risk = calculateRisk(result.metrics, criteria)
const uiScores = mapScoresForUi(allScores, risk)
```

Reference: `shore-guard-web/src/app/api/runner/results/route.ts:99-115`.

Base scoring primitives:

```ts
scoreLowerBetter = (1 - clamp01((value - good) / (bad - good))) * 100
scoreHigherBetter = clamp01((value - bad) / (good - bad)) * 100
```

Reference: `shore-guard-web/src/modules/scoring/helpers/score-primitives.ts:4-18`.

Scale is logarithmic by LOC: <= 5,000 LOC => 100, >= 150,000 LOC => 20, interpolated in log10 space. Reference: `shore-guard-web/src/modules/scoring/helpers/score-primitives.ts:20-30`.

Default component weights:

```ts
architecture: { cycles: 0.4, depth: 0.35, roots: 0.25 },
maintainability: { avgLoc: 0.35, p90Loc: 0.35, edges: 0.25, orphan: 0.05 },
testability: { fan: 0.3, avgComplexity: 0.25, maxComplexity: 0.2, circularRate: 0.15, depth: 0.1 },
health: { architecture: 0.3, maintainability: 0.3, testability: 0.3, scale: 0.1 },
```

Reference: `shore-guard-web/src/modules/scoring/helpers/default-weights.ts:15-33`.

Formulas:

- Architecture = `0.4 * score(circularDeps/modules)` + `0.35 * score(maxDependencyDepth)` + `0.25 * score(roots/modules)`. Reference: `shore-guard-web/src/modules/scoring/helpers/calculators/architecture.ts:8-30`.
- Maintainability = `0.35 * score(avgLocPerModule)` + `0.35 * score(p90LocPerFile)` + `0.25 * score(totalEdges/modules)` + `0.05 * score(totalOrphans/modules)`. Reference: `shore-guard-web/src/modules/scoring/helpers/calculators/maintainability.ts:8-32`.
- Testability = `0.3 * score(maxFanIn + maxFanOut)` + `0.25 * score(avgComplexity)` + `0.2 * score(maxComplexity)` + `0.15 * score(circularDeps/modules)` + `0.1 * score(maxDependencyDepth)`. Reference: `shore-guard-web/src/modules/scoring/helpers/calculators/testability.ts:8-37`.
- Health = `0.3 * architecture + 0.3 * maintainability + 0.3 * testability + 0.1 * scale`. Reference: `shore-guard-web/src/modules/scoring/helpers/calculators/health.ts:11-37`.

Default health does not use p75 directly. P75 metrics exist in the metric contract and dynamic scorer; risk uses `complexityP75`. Reference: `shore-guard-web/src/modules/scoring/helpers/calculators/risk.ts:48-83`.

Cost factor is a 1-4 multiplier:

```ts
friction = weighted inverted quality
factor = min + K * clamp01(friction)^P
```

with `K=2.25`, `P=1.35`, `[min,max]=[1,4]`. References: `shore-guard-web/src/modules/scoring/helpers/calculators/cost-factor.ts:11-45`, `shore-guard-web/src/modules/scoring/helpers/default-weights.ts:8-13`.

UI cost maps factor `[1,4]` to `[0,100]`; health is `scores.health.score`; risk is `calculateRisk`. Reference: `shore-guard-web/src/modules/scoring/helpers/ui-score-mapping.ts:15-44`.

DB persistence rounds and clamps UI scores to `0..100` smallints:

```sql
least(100, greatest(0, round((v_ui ->> 'health')::numeric)))::smallint
```

Reference: `shore-guard-web/supabase/migrations/00000000000140_shore_rollups.sql:430-443`; schema checks at `shore-guard-web/supabase/migrations/00000000000110_shore_code_scans.sql:356-377`.

## Config Schema

Scan config lives on `repo_connections`:

```sql
language          text,
project_type      text,
target_directory  text,
exclude           text[] not null default '{}',
tools             jsonb  not null default '{}'::jsonb,
timeout           int    not null default 600,
```

Reference: `shore-guard-web/supabase/migrations/00000000000110_shore_code_scans.sql:61-72`.

Runner lease returns the same config fields. Reference: `shore-guard-web/src/kernel/contracts/scanner-contracts.ts:22-46`. The runner maps timeout seconds to milliseconds at `shore-runner/src/daemon/scanMapping.ts:51-55`.

Scoring config schema in TypeScript:

```ts
export interface MetricBaseline {
  good: number
  bad: number
  direction: 'lower-better' | 'higher-better'
}

export interface ScoringCriteria {
  metricBaselines: Record<string, MetricBaseline>
}

export interface CompositeDefinition {
  id: number
  name: string
  slug: string
  priority: CompositePriority
  scoringStyle: ScoringStyle
  isSingle: boolean
  metrics: CompositeMetricEntry[]
  isDefault: boolean
  createdAt: string
  updatedAt: string
}
```

Reference: `shore-guard-web/src/modules/scoring/types/scoring-types.ts:21-112`.

Scoring config persistence is a single active global row with opaque JSONB:

```sql
create table if not exists public.scoring_config (
    id uuid primary key default extensions.gen_random_uuid(),
    version int not null,
    is_active boolean not null default true,
    weights jsonb not null,
    criteria jsonb not null,
    composites jsonb not null,
    created_at timestamptz,
    updated_at timestamptz
);
```

Reference: `shore-guard-web/supabase/migrations/00000000000200_shore_scoring_config.sql:1-37`. The loader returns `unknown` payloads and lets the ingest caller cast to scoring types. Reference: `shore-guard-web/src/modules/data/data/scoring-config-repo.ts:4-27`, `shore-guard-web/src/app/api/runner/results/route.ts:104-113`.

Default baselines include raw counts, LOC percentiles, complexity percentiles, fan-in/out percentiles, and graph health indicators. References:
- scored/count/LOC baselines: `shore-guard-web/src/modules/scoring/helpers/default-baselines-scored.ts:3-43`
- complexity/fan/health baselines: `shore-guard-web/src/modules/scoring/helpers/default-baselines-dist.ts:3-44`

Profile support exists only for criteria thresholds:

```ts
Keys use the format: "projectType:language", "projectType:", ":language"
Fallback chain: type+language → type-only → language-only → default
```

Reference: `shore-guard-web/src/modules/scoring/helpers/profiles.ts:7-55`. I did not find this resolver used in runner ingest; active DB scoring config is global.

## Clean vs Messy Compared With a Typical Monorepo Scoring Package

Cleaner:
- Scanner output is typed by capability (`metrics`, `fileStats`, `graph`) instead of magic raw blobs. References: `shore-runner/src/domain/metrics.ts:83-99`, `shore-runner/src/runner/aggregator.ts:1-13`.
- Graph algorithms are isolated and mostly pure (`builder`, `scc`, `clusters`, `stats`, `metrics`). References: `shore-runner/src/graph/*`.
- The runner does not persist or score; the app validates and recomputes scores at ingest, avoiding stale runner-side score logic. Reference: `shore-guard-web/src/app/api/runner/results/route.ts:99-115`.
- Contracts are strict Zod schemas with `.strictObject` and no coercion. Reference: `shore-guard-web/src/kernel/contracts/scan-metrics-contracts.ts:113-229`.

Messier / extraction risks:
- The health score is `0..100`, not `0..10`; DB and UI assume `0..100`.
- "Cyclomatic complexity" is whatever `scc` reports as `Complexity`; there is no AST-level per-language complexity implementation.
- The default health formula does not use p75, even though p75 metrics are computed and configurable for dynamic composites.
- No native per-language weights. There is criteria profile machinery by `projectType:language`, but active ingest uses a single global scoring config row.
- Scanner plugins are manual registration plus shell-out binaries. This is simple, but a standalone package must either vendor/install/check these binaries or degrade gracefully.
- Go is in the language union, and `scc` can produce LOC/complexity, but there is no Go graph plugin registered. A Go scan would have no dependency graph metrics unless `tools.include` selects something custom not present here.
- `medianLocPerFile` / `p90LocPerFile` are computed from graph modules after path matching, not all raw `scc` files. That naming can confuse downstream consumers.
