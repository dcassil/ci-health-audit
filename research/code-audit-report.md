# Code-Audit Scoring and Scanning Research Report

Source repo: `/Users/danielcassil/Code/code-audit`  
Focus: existing scoring, scanning plugin pattern, shared metric/config types.

Important finding: the existing implementation scores most health/composite metrics on a **0-100** scale, not 0-10. A simplified standalone 0-10 version should divide these scores by 10 after applying the existing normalization and aggregation.

## Executive Summary

- Scanner architecture is a two-registry plugin system:
  - access plugins: `git`, `local`
  - tool plugins: `scc`, `depcruise`, `pydeps`, `cargo-depgraph`
- JS/TS scanning runs:
  - `scc --by-file --format json` for LOC and cyclomatic complexity
  - `depcruise --no-config --ts-pre-compilation-deps ... --output-type json` for dependency graph data
  - It does **not** use `madge` or `ts-morph`.
- Structural metrics are computed after tool aggregation in `apps/runner/src/graph`.
- Circular dependencies are counted as the **number of modules inside SCCs of size > 1**, not as number of circular edges.
- Dependency depth is longest depth through an SCC-condensed DAG, with root depth starting at `1`.
- LOC/module is total SCC code LOC divided by dependency graph node count.
- Fan-in/out are graph in/out degrees over unique internal edges.
- Per-language scoring profiles do not define per-language weights. They define per-language/project-type **metric baselines**. Composite weights are global unless DB rows are manually changed.

## Source Map

- Scoring package:
  - `packages/scoring/src/calculator.ts`
  - `packages/scoring/src/scoringFns.ts`
  - `packages/scoring/src/baselines.ts`
  - `packages/scoring/src/rawMetrics.ts`
  - `packages/scoring/src/dynamicScoring.ts`
  - `packages/scoring/src/scoringStyles.ts`
  - `packages/scoring/src/profiles.ts`
- Runner scanning:
  - `apps/runner/src/plugins/tools/interface.ts`
  - `apps/runner/src/plugins/tools/registry.ts`
  - `apps/runner/src/plugins/tools/scc.ts`
  - `apps/runner/src/plugins/tools/depcruise.ts`
  - `apps/runner/src/runner/bootstrap.ts`
  - `apps/runner/src/runner/ScanRunner.ts`
  - `apps/runner/src/runner/aggregator.ts`
  - `apps/runner/src/graph/builder.ts`
  - `apps/runner/src/graph/metrics.ts`
  - `apps/runner/src/graph/scc.ts`
  - `apps/runner/src/graph/stats.ts`
- Shared types:
  - `packages/core/src/types/scan.ts`
  - `packages/core/src/types/scoring.ts`
  - `packages/core/src/types/compositeDefinition.ts`
  - `packages/core/src/types/module.ts`
  - `packages/core/src/types/cluster.ts`
- Config/schema:
  - `apps/server/src/db/writes/migrations/seeds.ts`
  - `apps/server/src/db/writes/migrations/tables.ts`
  - `apps/server/src/routes/admin/scoringProfiles.schema.ts`
  - `apps/server/src/routes/admin/compositeDefinitions.schema.ts`

## Scanner Plugin Pattern

### Tool Plugin Interface

The scanner plugin interface is `ToolPlugin` in `apps/runner/src/plugins/tools/interface.ts:9-22`:

```ts
export interface ToolPlugin {
  readonly id: string;
  readonly supports: ToolSupport;
  run(ctx: ScanContext): Promise<ToolRunOutput>;
}

export interface ToolSupport {
  languages?: Language[];
  types?: ProjectType[];
}

export interface ToolOptions {
  timeout: number;
  exclude?: string[];
  targetPaths?: string[];
}
```

`ToolPlugin.run()` receives a `ScanContext` and returns a `ToolRunOutput`. Those types are in `apps/runner/src/domain/scan.ts:27-33` and `apps/runner/src/domain/metrics.ts:68-74`:

```ts
export interface ScanContext {
  repo: RepoConfig
  job: JobContext
  workdir: string
  options: RunnerOptions
}

export interface ToolRunOutput {
  raw: unknown
  metrics: Partial<RawMetrics>
  fileStats?: FileStats[]
  artifacts?: Record<string, string>
}
```

The language/type support fields use `Language` and `ProjectType` from `apps/runner/src/domain/types.ts:6-13`:

```ts
export type Language = 'js' | 'ts' | 'javascript' | 'typescript' | 'python' | 'rust' | 'go' | 'other';
export type ProjectType = 'frontend' | 'backend' | 'library' | 'monorepo' | 'default' | (string & {});
```

### Tool Registration and Resolution

Default tool registration happens in `apps/runner/src/runner/bootstrap.ts:23-38`:

```ts
const toolRegistry = new ToolRegistry();
toolRegistry.register(new SccToolPlugin());
toolRegistry.register(new DepcruiseToolPlugin());
toolRegistry.register(new PydepsToolPlugin());
toolRegistry.register(new CargoDepgraphToolPlugin());
```

The registry filters by support and repo-level include/exclude overrides in `apps/runner/src/plugins/tools/registry.ts:25-42`:

```ts
resolve(repo: RepoConfig, overrides?: ToolSelection): ToolPlugin[] {
  const selection = overrides ?? repo.tools;

  return this.tools.filter(tool => {
    if (!this.toolSupportsRepo(tool, repo)) return false;
    if (selection?.include && !selection.include.includes(tool.id)) return false;
    if (selection?.exclude && selection.exclude.includes(tool.id)) return false;
    return true;
  });
}
```

Support matching is in `apps/runner/src/plugins/tools/registry.ts:55-67`. If `supports.languages` is present, `repo.language` must be included. If `supports.types` is present and repo has a type, it must be included.

### Access Plugin Interface

The runner also has access-provider plugins. Interface in `apps/runner/src/plugins/access/interface.ts:23-39`:

```ts
export interface AccessProvider {
  readonly type: string;
  checkout(repo: RepoConfig, target: CheckoutTarget, workdir: string): Promise<CheckoutResult>;
  cleanup?(workdir: string): Promise<void>;
}
```

Default access providers are registered in `apps/runner/src/runner/bootstrap.ts:23-27`: `GitAccessProvider` and `LocalAccessProvider`.

## JS/TS Scanner Behavior

For a repo with language `js`, `ts`, `javascript`, or `typescript`, the resolved tools are:

- `scc`: universal support, `apps/runner/src/plugins/tools/scc.ts:12-15`
- `depcruise`: JS/TS support, `apps/runner/src/plugins/tools/depcruise.ts:15-19`

### `scc` Tool

`SccToolPlugin` checks for `scc` with `which scc` (`apps/runner/src/plugins/tools/scc.ts:132-139`) and runs:

```ts
execSync(`scc --by-file --format json "${targetPath}"`, ...)
```

Source: `apps/runner/src/plugins/tools/scc.ts:41-50`.

It parses each language group and keeps only these code languages: JavaScript, TypeScript, JSX, TSX, TypeScript Typings, Python, Rust, Go, Java, C, C++, C# (`apps/runner/src/plugins/tools/scc.ts:124-130`).

For each file, it reads:

```ts
const code = (f.Code ?? 0) as number;
const comp = (f.Complexity ?? 0) as number;

loc += code;
complexity += comp;
maxComp = Math.max(maxComp, comp);
files++;
```

Source: `apps/runner/src/plugins/tools/scc.ts:101-107`.

It returns:

```ts
metrics: {
  linesOfCode: totalLoc,
  totalFiles,
  avgComplexity,
  maxComplexity,
  totalComplexity,
},
fileStats: allFileStats,
```

Source: `apps/runner/src/plugins/tools/scc.ts:67-79`.

### `depcruise` Tool

`DepcruiseToolPlugin` checks `depcruise --version` (`apps/runner/src/plugins/tools/depcruise.ts:166-168`) and supports JS/TS language aliases (`apps/runner/src/plugins/tools/depcruise.ts:15-19`).

For each target path, it searches upward for `tsconfig.json` (`apps/runner/src/plugins/tools/depcruise.ts:141-153`) and shells out:

```ts
depcruise --no-config --ts-pre-compilation-deps ${tsConfigArg} --exclude "node_modules" --output-type json "${targetPath}/**/*.ts" "${targetPath}/**/*.tsx" "${targetPath}/**/*.js" "${targetPath}/**/*.jsx"
```

Source: `apps/runner/src/plugins/tools/depcruise.ts:50-63`.

It parses `output.modules`, normalizes source/dependency paths, filters externals and excludes, deduplicates edges with `sourcePath|normalizedDep`, and emits:

```ts
edges.push({ fromPath: sourcePath, toPath: normalizedDep });
modules.push({ source: sourcePath, dependencies: deps });
```

Source: `apps/runner/src/plugins/tools/depcruise.ts:95-139`.

External filtering is simple:

```ts
return filePath.includes('node_modules') || filePath.startsWith('node:') || !filePath.includes('/');
```

Source: `apps/runner/src/plugins/tools/depcruise.ts:162-164`.

### Tool Aggregation

The runner executes tools sequentially in `apps/runner/src/runner/ScanRunner.ts:86-102`. It then aggregates outputs in `apps/runner/src/runner/aggregator.ts:24-86`.

Key aggregation behavior:

- `Object.assign(aggregated, output.metrics)` merges metric partials in tool execution order.
- `fileStats` is replaced by the latest output that has `fileStats`.
- `edges` and dependency `modules` are replaced by the latest output whose `raw` contains those fields.
- If dependency modules exist, graph metrics are computed and replace raw structural/default stats.

Source: `apps/runner/src/runner/aggregator.ts:30-48` and `apps/runner/src/runner/aggregator.ts:50-85`.

The default registration order is `scc`, `depcruise`, `pydeps`, `cargo-depgraph`, but the language filter normally leaves only one dependency graph plugin plus `scc`.

## Exact Metric Computation

### Graph Construction

Graph construction happens in `apps/runner/src/graph/builder.ts:19-75`.

- Every module source becomes a node.
- Every edge ensures both endpoints exist.
- Adjacency sets deduplicate outgoing edges.
- `fanOut(from)` increments once per unique `from -> to`.
- `fanIn(to)` increments once per unique `from -> to`.

Representative code from `apps/runner/src/graph/builder.ts:61-72`:

```ts
const fromAdj = adj.get(from);
if (fromAdj && !fromAdj.has(to)) {
  fromAdj.add(to);
  fanOut.set(from, (fanOut.get(from) ?? 0) + 1);
  fanIn.set(to, (fanIn.get(to) ?? 0) + 1);
  revAdj.get(to)?.add(from);
}
```

### 1. LOC Per Module

`scc` provides `linesOfCode` as sum of per-file `Code` fields. Graph metrics then compute:

```ts
avgLocPerFile: sccResult.totalFiles > 0 ? sccResult.linesOfCode / sccResult.totalFiles : 0,
avgLocPerModule: nodeCount > 0 ? sccResult.linesOfCode / nodeCount : 0,
```

Source: `apps/runner/src/graph/metrics.ts:120-123`.

`nodeCount` is `graph.nodes.size` (`apps/runner/src/graph/metrics.ts:87`). Therefore:

```text
avgLocPerModule = total SCC Code LOC / dependency graph node count
```

LOC distribution is computed from module-level LOC values matched from `sccResult.fileStats`:

```ts
const locValues = modules.map(m => m.loc ?? 0).filter(l => l > 0);
const locStats = computeDistributionStats(locValues);
```

Source: `apps/runner/src/graph/metrics.ts:69-72`.

The default score uses **avg LOC/module** and **p90 LOC/file**, not p75. `p90LocPerFile` is set from `locStats.percentiles.p90` at `apps/runner/src/graph/metrics.ts:123-125`.

p75 is still computed and stored in `locPercentiles.p75` via `computeDistributionStats()` (`apps/runner/src/graph/stats.ts:120-127`) and exposed as raw metric `locP75` in `packages/scoring/src/rawMetrics.ts:43-46`.

### 2. Dependency Depth

Depth is computed by:

1. Find strongly connected components with Tarjan (`apps/runner/src/graph/scc.ts:10-63`).
2. Collapse SCCs into a DAG (`apps/runner/src/graph/scc.ts:68-95`).
3. Find SCC DAG roots with condensed indegree `0` (`apps/runner/src/graph/scc.ts:97-113`).
4. Start each root at depth `1` (`apps/runner/src/graph/scc.ts:119-127`).
5. Traverse edges and retain longest discovered depth (`apps/runner/src/graph/scc.ts:128-145`).

Representative code:

```ts
for (const root of roots) {
  depths.set(root, 1);
}

let maxDepth = 1;

while (queue.length > 0) {
  const currentDepth = depths.get(current) ?? 0;
  for (const neighbor of neighbors) {
    const newDepth = currentDepth + 1;
    if (!depths.has(neighbor) || (depths.get(neighbor) ?? 0) < newDepth) {
      depths.set(neighbor, newDepth);
      maxDepth = Math.max(maxDepth, newDepth);
      queue.push(neighbor);
    }
  }
}
```

Source: `apps/runner/src/graph/scc.ts:122-145`.

`maxDependencyDepth` is then assigned in `apps/runner/src/graph/metrics.ts:40-42` and `apps/runner/src/graph/metrics.ts:116-119`.

### 3. Circular Dependencies

Circular dependencies use SCCs:

```ts
const sccs = findSCCs(graph);
const cycleClusters = sccs.filter(scc => scc.length > 1);
```

Source: `apps/runner/src/graph/metrics.ts:39-42`.

The main circular-dependency count is:

```ts
const totalCircularDeps = cycleClusters.reduce((sum, c) => sum + c.length, 0);
```

Source: `apps/runner/src/graph/metrics.ts:87-90`.

So:

```text
totalCircularDeps = number of modules participating in SCCs with size > 1
totalCircularClusters = number of SCCs with size > 1
```

Source for assignments: `apps/runner/src/graph/metrics.ts:116-117`.

Note: self-loops are not counted as circular clusters because single-node SCCs are filtered out by `scc.length > 1`.

Cycle cluster metadata is computed in `apps/runner/src/graph/clusters.ts:12-65`, including internal edge count, edge density, and max internal fan-in/out.

### 4. Cyclomatic Complexity

The scanner reads per-file complexity from SCC JSON field `Complexity`:

```ts
const comp = (f.Complexity ?? 0) as number;
complexity += comp;
maxComp = Math.max(maxComp, comp);
```

Source: `apps/runner/src/plugins/tools/scc.ts:101-107`.

The `scc` plugin returns `avgComplexity = totalComplexity / totalFiles` (`apps/runner/src/plugins/tools/scc.ts:67-78`), but when graph metrics are available, the aggregator converts file stats into an `SccResult` and `computeMetrics()` recomputes complexity distribution from modules matched to graph nodes:

```ts
const complexityValues = modules.map(m => m.complexity ?? 0).filter(c => c > 0);
const complexityStats = computeDistributionStats(complexityValues);
```

Source: `apps/runner/src/graph/metrics.ts:73-75`.

The final graph-backed metrics are:

```ts
avgComplexity: complexityStats.mean,
maxComplexity: complexityStats.max,
totalComplexity: complexityStats.sum,
medianComplexity: complexityStats.percentiles.p50,
p90Complexity: complexityStats.percentiles.p90,
complexityPercentiles: complexityStats.percentiles,
```

Source: `apps/runner/src/graph/metrics.ts:129-137`.

p75 complexity is computed and stored (`complexityPercentiles.p75`) but the default legacy score uses **avgComplexity** and **maxComplexity**, not p75 or p90. `complexityP75` is exposed as a dynamic raw metric in `packages/scoring/src/rawMetrics.ts:60-64`.

### 5. Fan-In and Fan-Out

Fan-in/out are unique graph degrees computed during graph construction (`apps/runner/src/graph/builder.ts:61-72`):

```text
fanOut(module) = count of unique outgoing internal dependency edges
fanIn(module) = count of unique incoming internal dependency edges
```

Graph metrics then compute:

```ts
const fanInValues = Array.from(graph.fanIn.values());
const fanOutValues = Array.from(graph.fanOut.values());
const fanInPercentiles = computePercentiles(fanInValues);
const fanOutPercentiles = computePercentiles(fanOutValues);
const fanInMean = fanInValues.length > 0 ? fanInValues.reduce((a, b) => a + b, 0) / fanInValues.length : 0;
const fanOutMean = fanOutValues.length > 0 ? fanOutValues.reduce((a, b) => a + b, 0) / fanOutValues.length : 0;
```

Source: `apps/runner/src/graph/metrics.ts:77-85`.

Assignments:

```ts
maxFanIn: Math.max(...fanInValues, 0),
avgFanIn: fanInMean,
fanInPercentiles,
fanInStdDev,
maxFanOut: Math.max(...fanOutValues, 0),
avgFanOut: fanOutMean,
fanOutPercentiles,
fanOutStdDev,
```

Source: `apps/runner/src/graph/metrics.ts:139-149`.

The default `fan` scoring metric is not p75 or average. It is:

```ts
fan: (s) => s.maxFanIn + s.maxFanOut
```

Source: `packages/scoring/src/rawMetrics.ts:17`.

## Percentiles and Aggregation

Percentile computation uses linear interpolation over sorted values:

```ts
const index = (p / 100) * (sortedValues.length - 1)
const lower = Math.floor(index)
const upper = Math.ceil(index)
const weight = index - lower
return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight
```

Source: `apps/runner/src/graph/stats.ts:29-41`.

Standard percentiles are p25, p50, p75, p90, p95, p99 (`apps/runner/src/graph/stats.ts:46-60` and `apps/runner/src/graph/stats.ts:120-127`).

Default legacy scoring consumes:

- cycles: `totalCircularDeps / totalModules`
- depth: `maxDependencyDepth`
- roots: `totalRoots / totalModules`
- avgLoc: `avgLocPerModule`
- p90Loc: `p90LocPerFile`
- edges: `totalEdges / totalModules`
- orphan: `totalOrphans / totalModules`
- fan: `maxFanIn + maxFanOut`
- avgComplexity: `avgComplexity`
- maxComplexity: `maxComplexity`
- scale: `linesOfCode`

Source: `packages/scoring/src/rawMetrics.ts:8-21`.

## Score Normalization

### Linear Metric Scoring

Lower-is-better metrics:

```ts
const t = (value - good) / (bad - good)
return Math.round((1 - clamp01(t)) * 10000) / 100
```

Source: `packages/scoring/src/scoringFns.ts:7-11`.

Higher-is-better metrics:

```ts
const t = (value - bad) / (good - bad)
return Math.round(clamp01(t) * 10000) / 100
```

Source: `packages/scoring/src/scoringFns.ts:13-17`.

This returns a 0-100 score rounded to two decimals. For a 0-10 standalone tool:

```text
score0to10 = score0to100 / 10
```

### LOC Scale Scoring

LOC scale is special and logarithmic:

```ts
if (loc <= 5_000) return 100
if (loc >= 150_000) return 20

const lo = Math.log10(5_000)
const hi = Math.log10(150_000)
const x = Math.log10(Math.max(1, loc))
const t = clamp01((x - lo) / (hi - lo))
const score = 100 - t * 80
```

Source: `packages/scoring/src/scoringFns.ts:19-29`.

### Default Baselines

Default baselines for the core scored metrics are in `packages/scoring/src/baselines.ts:4-17`:

```ts
cycles:        { good: 0.0, bad: 0.30, direction: 'lower-better' },
depth:         { good: 5, bad: 20, direction: 'lower-better' },
roots:         { good: 0.50, bad: 0.10, direction: 'higher-better' },
avgLoc:        { good: 50, bad: 150, direction: 'lower-better' },
p90Loc:        { good: 150, bad: 400, direction: 'lower-better' },
edges:         { good: 2, bad: 6, direction: 'lower-better' },
orphan:        { good: 0.00, bad: 0.10, direction: 'lower-better' },
fan:           { good: 30, bad: 200, direction: 'lower-better' },
avgComplexity: { good: 5, bad: 20, direction: 'lower-better' },
maxComplexity: { good: 30, bad: 200, direction: 'lower-better' },
scale:         { good: 5_000, bad: 150_000, direction: 'lower-better' },
```

The same file defines additional selectable baselines for p75 LOC, p75 complexity, fan-in percentiles, fan-out percentiles, etc. See `packages/scoring/src/baselines.ts:30-75`.

## Default Score Aggregation

The legacy fixed scorer is in `packages/scoring/src/calculator.ts`. The server seeds equivalent default dynamic composite definitions in `apps/server/src/db/writes/migrations/seeds.ts:9-56`.

### Architecture

Metrics and weights from `packages/scoring/src/calculator.ts:8-29`:

```text
sCycles = scoreLowerBetter(totalCircularDeps / modules, cycles.good, cycles.bad)
sDepth  = scoreLowerBetter(maxDependencyDepth, depth.good, depth.bad)
sRoots  = scoreHigherBetter(totalRoots / modules, roots.bad, roots.good)

architecture = 0.40*sCycles + 0.35*sDepth + 0.25*sRoots
```

### Maintainability

Metrics and weights from `packages/scoring/src/calculator.ts:31-53`:

```text
sAvgLoc = scoreLowerBetter(avgLocPerModule, avgLoc.good, avgLoc.bad)
sP90Loc = scoreLowerBetter(p90LocPerFile, p90Loc.good, p90Loc.bad)
sEdges  = scoreLowerBetter(totalEdges / modules, edges.good, edges.bad)
sOrphan = scoreLowerBetter(totalOrphans / modules, orphan.good, orphan.bad)

maintainability = 0.35*sAvgLoc + 0.35*sP90Loc + 0.25*sEdges + 0.05*sOrphan
```

### Testability

Metrics and weights from `packages/scoring/src/calculator.ts:55-81`:

```text
sFan   = scoreLowerBetter(maxFanIn + maxFanOut, fan.good, fan.bad)
sAvgCx = scoreLowerBetter(avgComplexity, avgComplexity.good, avgComplexity.bad)
sMaxCx = scoreLowerBetter(maxComplexity, maxComplexity.good, maxComplexity.bad)
sCirc  = scoreLowerBetter(totalCircularDeps / modules, cycles.good, cycles.bad)
sDepth = scoreLowerBetter(maxDependencyDepth, depth.good, depth.bad)

testability = 0.30*sFan + 0.25*sAvgCx + 0.20*sMaxCx + 0.15*sCirc + 0.10*sDepth
```

### Overall Health

Overall health from `packages/scoring/src/calculator.ts:83-104`:

```text
health = 0.30*architecture + 0.30*maintainability + 0.30*testability + 0.10*scale
```

### Cost Factor

Legacy cost factor from `packages/scoring/src/calculator.ts:106-137`:

```text
a = (100 - architecture) / 100
m = (100 - maintainability) / 100
t = (100 - testability) / 100
hotBad = (100 - score(maxComplexity)) / 100
s = (100 - scoreScaleByLOC(linesOfCode)) / 100

friction = 0.25*a + 0.25*m + 0.35*t + 0.10*hotBad + 0.05*s
factor = 1 + 2.25 * clamp01(friction)^1.35
costFactor = clamp(factor, 1, 4)
```

Dynamic `multiplier` style differs: it returns only the delta, not `1 + delta`, and clamps to `[0, 3]`. Source: `packages/scoring/src/scoringStyles.ts:34-50`.

## Dynamic Composite Scoring

Dynamic scoring uses `CompositeDefinition[]` and `ScoringCriteria`.

Base metric scoring is in `packages/scoring/src/dynamicScoring.ts:13-24`:

```ts
if (metricId === 'scale') return scoreScaleByLOC(scan.linesOfCode)

const baseline = criteria.metricBaselines[metricId] ?? defaultMetricBaselines[metricId]
const raw = getRawMetricValue(metricId, scan, criteria)
return baseline.direction === 'higher-better'
  ? scoreHigherBetter(raw, baseline.bad, baseline.good)
  : scoreLowerBetter(raw, baseline.good, baseline.bad)
```

Composite references are topologically sorted so dependencies calculate first (`packages/scoring/src/topologicalSort.ts:7-38`). Circular composite references throw.

Weighted style is a simple sum, without internally normalizing by total weight:

```ts
const score = makeup.reduce((sum, m) => sum + m.weight * m.value, 0)
```

Source: `packages/scoring/src/scoringStyles.ts:69-79`.

The API validates that non-multiplier weights sum to 1.0 within 0.01 in `apps/server/src/routes/admin/compositeDefinitions.ts:28-34` and `apps/server/src/routes/admin/compositeDefinitions.ts:73-78`.

Default composite definitions are seeded in `apps/server/src/db/writes/migrations/seeds.ts:9-56` and mirror the legacy scorer:

- Architecture: cycles 0.40, depth 0.35, roots 0.25
- Maintainability: avgLoc 0.35, p90Loc 0.35, edges 0.25, orphan 0.05
- Testability: fan 0.30, avgComplexity 0.25, maxComplexity 0.20, cycles 0.15, depth 0.10
- Health: architecture 0.30, maintainability 0.30, testability 0.30, scale 0.10
- Cost Factor: architecture 0.25, maintainability 0.25, testability 0.35, maxComplexity 0.10, scale 0.05

## Per-Language Profile and Weight Structure

There are per-language/project-type scoring profiles, but they hold **baselines**, not weights.

Core profile type:

```ts
export interface ScoringCriteria {
  metricBaselines: Record<string, MetricBaseline>
}
```

Source: `packages/core/src/types/scoring.ts:15-18`.

Profile resolution fallback is in `packages/scoring/src/profiles.ts:25-56`:

```text
projectType:language -> projectType: -> :language -> default
```

Representative code:

```ts
if (pt && lang) {
  const key = `${pt}:${lang}`
  if (profiles[key]) return normalizeCriteria(profiles[key])
}
...
if (lang) {
  const key = `:${lang}`
  if (profiles[key]) return normalizeCriteria(profiles[key])
}
return defaultScoringCriteria
```

Source: `packages/scoring/src/profiles.ts:37-56`.

The DB schema supports `language`, `project_type`, and `criteria_json` on `scoring_profiles` (`apps/server/src/db/writes/migrations/tables.ts:111-124`).

Composite weights live separately in `composite_definitions.metrics_json` and are not keyed by language (`apps/server/src/db/writes/migrations/tables.ts:127-141`).

## Shared Types

### Scan Metrics

`ScanMetrics` is the central shared metrics shape in `packages/core/src/types/scan.ts:25-72`:

```ts
export interface ScanMetrics {
  linesOfCode: number
  totalCodeFiles: number
  totalModules: number
  totalEdges: number
  totalOrphans: number
  totalRoots: number
  totalExports: number
  totalCircularDeps: number
  totalCircularClusters: number
  maxDependencyDepth: number
  avgLocPerFile: number
  avgLocPerModule: number
  medianLocPerFile: number
  p90LocPerFile: number
  locPercentiles: PercentileSet
  avgComplexity: number
  maxComplexity: number
  totalComplexity: number
  medianComplexity: number
  p90Complexity: number
  complexityPercentiles: PercentileSet
  maxFanIn: number
  avgFanIn: number
  fanInPercentiles: PercentileSet
  maxFanOut: number
  avgFanOut: number
  fanOutPercentiles: PercentileSet
  health: HealthMetrics
}
```

The actual interface also includes std-dev and skewness fields for LOC, complexity, fan-in, and fan-out.

### Scoring Types

From `packages/core/src/types/scoring.ts:7-41`:

```ts
export interface MetricBaseline {
  good: number
  bad: number
  direction: 'lower-better' | 'higher-better'
}

export interface ScoreResult {
  score: number
  makeup: ScoreBreakdown[]
  scoringStyle?: ScoringStyle
}

export interface AllScores {
  health: ScoreResult
  architecture: ScoreResult
  maintainability: ScoreResult
  testability: ScoreResult
  costFactor: ScoreResult
}
```

### Composite Definition Types

From `packages/core/src/types/compositeDefinition.ts:1-35`:

```ts
export interface CompositeMetricEntry {
  metricId: string
  weight: number
  invert?: boolean
  factorRange?: number
}

export type ScoringStyle = 'higher-is-better' | 'lower-is-better' | 'multiplier' | 'raw'

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

### Module and Cluster Types

`ModuleData` includes per-node fan-in/out, orphan/root/cycle flags, LOC, and complexity (`packages/core/src/types/module.ts:20-33`).

`ClusterData` includes SCC/cycle cluster size, edge count, density, max internal fan-in/out, largest flag, and module paths (`packages/core/src/types/cluster.ts:19-28`).

## Config Schema

### Runner Config Example

`apps/runner/config.example.json:1-18` shows the legacy/config-file runner shape:

```json
{
  "repos": [
    {
      "name": "hive-bidder-frontend",
      "gitUrl": "...",
      "branch": "main",
      "language": "ts",
      "historyStates": 14,
      "retroactive": true,
      "targetDirectory": ["src/"],
      "timeout": 300000
    }
  ],
  "runInterval": "daily"
}
```

The current runner CLI constructs `RepoConfig` directly from flags in `apps/runner/src/index.ts:51-62`.

### Scoring Profile Schema

Admin route schema accepts scoring profiles with:

```ts
name: string
language?: string
projectType?: string
criteria: object
```

Source: `apps/server/src/routes/admin/scoringProfiles.schema.ts:18-27`.

Single baseline updates require:

```ts
good: number
bad: number
direction: 'lower-better' | 'higher-better'
```

Source: `apps/server/src/routes/admin/scoringProfiles.schema.ts:54-68`.

When populating baselines from a repo, raw value becomes `good`, and `bad` is `raw * 3` for lower-better metrics or `raw / 3` for higher-better metrics. Source: `apps/server/src/routes/admin/scoringProfiles.ts:87-96`.

### Composite Definition Schema

Metric entries:

```ts
metricId: string
weight: number // 0..1
invert?: boolean
factorRange?: number
```

Source: `apps/server/src/routes/admin/compositeDefinitions.schema.ts:1-10`.

Definitions include:

```ts
name: string
priority: 'high' | 'avg' | 'low'
scoringStyle?: 'higher-is-better' | 'lower-is-better' | 'multiplier' | 'raw'
isSingle?: boolean
metrics: CompositeMetricEntry[]
```

Source: `apps/server/src/routes/admin/compositeDefinitions.schema.ts:38-53`.

## External Tool Dependencies

### NPM Dependencies

Runner package dependencies from `apps/runner/package.json:27-34`:

- `@simple-audit/core`
- `commander`
- `dependency-cruiser`
- `esbuild`
- `esbuild-register`
- `simple-git`

Root dev dependency also pins `dependency-cruiser` to `16.10.4` (`package.json:46-57`).

### CLIs Used at Runtime

The runner directly shells out to:

- `scc`: checked with `which scc`; command `scc --by-file --format json`
  - Source: `apps/runner/src/plugins/tools/scc.ts:41-50`, `apps/runner/src/plugins/tools/scc.ts:132-139`
- `depcruise`: checked with `depcruise --version`; command `depcruise --no-config --ts-pre-compilation-deps ...`
  - Source: `apps/runner/src/plugins/tools/depcruise.ts:50-63`, `apps/runner/src/plugins/tools/depcruise.ts:166-168`
- `pydeps`: checked with `which pydeps`; command `pydeps --no-show --show-deps`
  - Source: `apps/runner/src/plugins/tools/pydeps.ts:49-57`, `apps/runner/src/plugins/tools/pydeps.ts:80-87`
- `cargo-depgraph`: checked with `which cargo-depgraph` or `cargo depgraph --version`; command `cargo depgraph --all-deps`
  - Source: `apps/runner/src/plugins/tools/cargoDepgraph.ts:43-49`, `apps/runner/src/plugins/tools/cargoDepgraph.ts:69-84`

The runner Dockerfile installs these runtime tools:

- `scc` via Go install (`apps/runner/Dockerfile:35-40`)
- `dependency-cruiser` globally (`apps/runner/Dockerfile:42-43`)
- `pydeps` via pip (`apps/runner/Dockerfile:45-46`)
- `cargo-depgraph` from a Rust builder stage (`apps/runner/Dockerfile:18-22`, `apps/runner/Dockerfile:48-49`)

## Reimplementation Notes for a Simplified Standalone Tool

For a minimal JS/TS-only implementation, reproduce:

1. Run `scc --by-file --format json <target>` and keep per-file `Code` and `Complexity`.
2. Run `depcruise --no-config --ts-pre-compilation-deps --exclude "node_modules" --output-type json <glob...>`.
3. Normalize to internal modules and edges; ignore externals the same way or choose a stricter path-based filter.
4. Build a unique directed graph.
5. Compute:
   - `avgLocPerModule = totalCodeLoc / graphNodeCount`
   - `maxDependencyDepth` via Tarjan SCC condensation, root depth `1`
   - `totalCircularDeps = sum(size of SCCs where size > 1)`
   - `avgComplexity`, `maxComplexity` over graph-matched file complexities greater than `0`
   - `maxFanIn + maxFanOut` for the default fan metric
6. Normalize each metric to 0-100 with the existing good/bad baselines, then divide by 10 for 0-10 output.
7. Use the default weights:
   - Architecture: cycles 0.40, depth 0.35, roots 0.25
   - Maintainability: avgLoc 0.35, p90Loc 0.35, edges/module 0.25, orphan/module 0.05
   - Testability: fan 0.30, avg complexity 0.25, max complexity 0.20, cycles 0.15, depth 0.10
   - Overall health: architecture 0.30, maintainability 0.30, testability 0.30, scale 0.10

