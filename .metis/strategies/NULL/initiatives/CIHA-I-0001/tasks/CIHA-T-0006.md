---
id: phase-6-five-p75-metrics
level: task
title: "Phase 6: Five p75 metrics"
short_code: "CIHA-T-0006"
created_at: 2026-07-31T18:26:19.468962+00:00
updated_at: 2026-07-31T19:08:06.198008+00:00
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

# Phase 6: Five p75 metrics

## Parent Initiative **[CONDITIONAL: Assigned Task]**

[[CIHA-I-0001]]

## Objective **[REQUIRED]**

Implement `computeMetrics(graph)` producing the five p75 metric values using the exact per-metric aggregation decisions and degenerate fallbacks from the initiative's "The Five p75 Metric Decisions". This is the crux of the whole tool: it reduces the reference's avg/max/p90 mix (and two whole-graph scalars) to a uniform p75, with documented fallbacks so p75 stays meaningful where a per-module distribution does not naturally exist.

## Acceptance Criteria

## Acceptance Criteria

## Acceptance Criteria **[REQUIRED]**

- [ ] `src/metrics/computeMetrics.ts` exports `computeMetrics(graph): Metrics` where `Metrics = { locPerModule, depDepth, circularDeps, complexity, fanInOut }` (five numbers). (REQ-010)
- [ ] **locPerModule** = p75 over per-node `loc` (filtering `loc <= 0`); empty distribution → `0`. (Decision 1; reference `metrics.ts:69-72`)
- [ ] **complexity** = p75 over per-node `complexity` (filtering `complexity <= 0`); empty → `0`. (Decision 2; reference `metrics.ts:73-75`)
- [ ] **fanInOut** = p75 over per-node `couple[node] = fanIn[node] + fanOut[node]` across all nodes; no nodes → `0`; nodes with zero edges → all values `0` → p75 `0`. (Decision 3)
- [ ] **depDepth** = p75 over per-node longest-path depth from roots (`depthByNode` from Phase 5); fallback: if the distribution has ≤1 distinct value (flat graph / single node), use the whole-graph scalar `maxDependencyDepth`; empty graph → `0`. (Decision 4)
- [ ] **circularDeps** = p75 over per-SCC cluster sizes of SCCs with size > 1 (`cycleClusters.map(c => c.length)`); no clusters → `0`; exactly one cluster → that value. (Decision 5)
- [ ] All five use the Phase 5 `computePercentiles` (linear interpolation, p75). Iteration order over `Map`/`Set` that feeds a value is sorted or order-independent (NFR-001). No throws on empty/degenerate graphs (NFR-005).
- [ ] Fixture tests in `test/metrics.test.ts` exercise EACH degenerate fallback: empty graph (all → 0), single node, flat graph (depth fallback to whole-graph max), zero cycles (`circularDeps` → 0), one giant cycle vs many small cycles (per-SCC-size p75), a graph with nodes but no edges (`fanInOut` → 0). (Testing Strategy → The five p75 decisions)

## Implementation Notes **[CONDITIONAL: Technical Task]**

### Execution profile
`Recommended Agent: opus + high`

This is where the documented per-metric decisions and degenerate fallbacks live; getting the distributions/fallbacks wrong corrupts the single number the product exists to produce.

### Technical Approach
- Source of truth is the initiative's "The Five p75 Metric Decisions" section and its summary table (aggregation + degenerate fallback per metric). Follow it literally — do not re-derive.
- Read distributions from the Phase 5 graph: `graph.nodeStats` for loc/complexity, `graph.fanIn`/`graph.fanOut` for coupling, `findSCCs(graph)` for cycle clusters, and the `depthByNode` + `maxDependencyDepth` from `longestPath(condense(...))`.
- `depDepth` "≤1 distinct value" check: build the depth distribution, `new Set(depths).size <= 1` → fallback to `maxDependencyDepth` (reference `scc.ts:119-145`). This makes p75 a strict generalization (reference max = p100 of this distribution).
- `circularDeps`: `const clusters = findSCCs(graph).filter(s => s.length > 1); const sizes = clusters.map(c => c.length); return sizes.length ? p75(sizes) : 0;` (reference cycle intent: `metrics.ts:87-90`).
- Filter `loc <= 0` / `complexity <= 0` before p75 (reference `metrics.ts:69-75`, see `code-audit-report.md:284-291`, `:379-384`).
- For determinism, sort any values array before percentile (Phase 5 already sorts inside `computePercentiles`); cluster sizes and coupling values are numeric arrays so order is irrelevant to p75.
- `metrics/` depends on `graph/` only.

### Dependencies
Depends on: CIHA-T-0005 (graph builder, `findSCCs`, `depthByNode`, `computePercentiles`). Blocks: CIHA-T-0007 (scorer normalizes these five values) and CIHA-T-0008 (`scan()` calls `computeMetrics`).

### Risk Considerations
- The two whole-graph metrics (depth, cycles) are exactly where a naive p75 would be misleading; the fallbacks are the mitigation and MUST be tested per the acceptance criteria. A depth p75 that silently collapses to a small value on a flat graph is the specific failure the ≤1-distinct-value fallback prevents.
- Do not p75 a per-module cycle ratio — that was explicitly rejected (Alternatives Considered); use per-SCC-size only.

## Verification Steps **[REQUIRED]**

```
npm run lint && npm run typecheck && npm test
```

Success proof:
- `test/metrics.test.ts` passes all five metrics on hand-computed fixtures and every degenerate fallback: empty→all 0, flat graph depth→whole-graph max, zero cycles→0, one-giant vs many-small cluster p75, no-edges fanInOut→0.
- Values match hand-computed p75 (linear interpolation) exactly.
- Lint/typecheck exit 0 with no escape hatches.

## Status Updates **[REQUIRED]**

*To be added during implementation*