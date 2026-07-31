---
id: phase-5-graph-builder-algorithms
level: task
title: "Phase 5: Graph builder & algorithms"
short_code: "CIHA-T-0005"
created_at: 2026-07-31T18:26:17.851180+00:00
updated_at: 2026-07-31T19:05:35.032258+00:00
parent: CIHA-I-0001
blocked_by: []
archived: false

tags:
  - "#task"
  - "#phase/completed"


exit_criteria_met: false
strategy_id: NULL
initiative_id: CIHA-I-0001
---

# Phase 5: Graph builder & algorithms

## Parent Initiative **[CONDITIONAL: Assigned Task]**

[[CIHA-I-0001]]

## Objective **[REQUIRED]**

Build the directed module graph and the graph algorithms every metric depends on: `buildGraph` (unique edges, fan-in/fan-out degrees, per-node LOC/complexity), Tarjan `findSCCs`, SCC `condense` + `longestPath` dependency depth (roots at depth 1), and linear-interpolation percentile/distribution stats. These are the subtle, load-bearing pieces — Tarjan and SCC-condensed longest-path are easy to get subtly wrong and every one of the five metrics reads from here.

## Acceptance Criteria

## Acceptance Criteria

## Acceptance Criteria **[REQUIRED]**

- [ ] `src/graph/builder.ts` exports `buildGraph(modules: ModuleEntry[], edges: Edge[], fileStats: FileStats[]): ModuleGraph`. Every module `source` is a node; every edge ensures both endpoints exist; adjacency `Set`s dedupe outgoing edges; on each new unique `from→to`: `fanOut[from]++`, `fanIn[to]++`, and reverse adjacency records `to→from`. Per-node `loc`/`complexity` attached by matching `FileStats.path` to node id. Exposes `nodes: Set<string>`, `adj: Map<string,Set<string>>`, `fanIn: Map<string,number>`, `fanOut: Map<string,number>`, `nodeStats: Map<string,{loc:number;complexity:number}>`. (REQ-007; reference `builder.ts:19-75`, `:61-72`)
- [ ] `src/graph/scc.ts` exports `findSCCs(graph): string[][]` via Tarjan's algorithm. (REQ-008; reference `scc.ts:10-63`)
- [ ] `src/graph/scc.ts` exports `condense(graph, sccs)` → DAG and `longestPath(dag)` computing depth as the longest path through the SCC-condensed DAG, condensed roots (indegree 0) starting at depth 1, and (for Phase 6) retaining **every node's resolved depth**, not only the max. (REQ-009; reference `scc.ts:68-95`, `:97-113`, `:119-145`)
- [ ] `src/graph/stats.ts` exports `computePercentiles(values)` using linear interpolation `index=(p/100)*(n-1)`, interpolating between floor/ceil (reference `stats.ts:29-41`), returning p25/p50/p75/p90/p95/p99, plus a `computeDistributionStats` helper as needed. (REQ-013)
- [ ] Determinism: any `Map`/`Set` iteration feeding a numeric result is order-independent or explicitly sorted (NFR-001). Empty/degenerate graphs (no nodes, no edges, single node, self-loop) do not throw and return well-defined values (NFR-005).
- [ ] Self-loops are NOT counted as circular clusters (single-node SCCs excluded by size > 1 downstream; the builder/SCC code must handle a self-edge without producing a size-2 SCC).
- [ ] Exhaustive known-answer unit tests in `test/graph.test.ts`: linear chain (depth = length, roots at depth 1), diamond, 3-node cycle (one SCC size 3), two disjoint cycles, self-loop (must NOT count as circular), hub node (fan-in/out counts); percentile tests including single-element and empty arrays. (Testing Strategy → Graph algorithms, Percentile/stats)

## Implementation Notes **[CONDITIONAL: Technical Task]**

### Execution profile
`Recommended Agent: opus + high`

Tarjan SCC and SCC-condensed longest-path are subtle and every metric depends on them. A wrong depth/SCC result silently corrupts the whole score; this is core algorithm groundwork.

### Technical Approach
- Port faithfully from reference `apps/runner/src/graph/` (see `code-audit-report.md:245-460`): `builder.ts:19-75` for graph construction, `scc.ts:10-63` (Tarjan), `scc.ts:68-145` (condense/roots/longest-path), `stats.ts:29-41` (percentiles).
- Depth generalization for Phase 6: the reference keeps only `maxDepth`; here also retain the full `depths` map (per-condensed-node longest path from roots) and expose it (e.g. `longestPath` returns `{ maxDepth, depthByNode }`). The reference's `maxDepth` is the p100 of that distribution.
- Longest-path relaxation is a Kahn/queue forward relaxation over the condensed DAG: roots at depth 1, relax `newDepth = currentDepth + 1`, keep max per node (reference `scc.ts:122-145`).
- For determinism (NFR-001), when iterating `nodes`/`adj` in a way that could affect tie-broken results, sort node ids first. Percentiles sort the value array ascending before interpolation.
- Define the `ModuleGraph` type in `graph/builder.ts` (or a small `graph/types.ts`); `graph/` depends on nothing internal except shared scanner types (`ModuleEntry`/`Edge`/`FileStats`).

### Dependencies
Depends on: CIHA-T-0001 (tooling), CIHA-T-0003 (`ModuleEntry`/`Edge`/`FileStats` types). Blocks: CIHA-T-0006 (metrics read `nodeStats`, `fanIn`/`fanOut`, `findSCCs`, `depthByNode`, `computePercentiles`) and CIHA-T-0008.

### Risk Considerations
- Tarjan recursion can stack-overflow on very deep graphs; an explicit-stack iterative Tarjan is safer for large real repos (integration test in Phase 8). Note this and prefer the iterative form.
- Roots-at-depth-1 (not 0) is a deliberate reference choice; a single isolated node graph → depth 1 (or the documented empty→0 case). Pin these in tests.

## Verification Steps **[REQUIRED]**

```
npm run lint && npm run typecheck && npm test
```

Success proof:
- `test/graph.test.ts` passes every known-answer case: SCC membership for the 3-node cycle and two disjoint cycles, self-loop excluded from size>1 SCCs, condensed-DAG longest-path depth for chain/diamond, unique-edge fan-in/out for the hub, and percentile interpolation for single/empty/multi-value arrays.
- Degenerate graphs return documented values without throwing.
- Lint/typecheck exit 0 with no escape hatches.

## Status Updates **[REQUIRED]**

*To be added during implementation*