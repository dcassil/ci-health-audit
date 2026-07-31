import type { ModuleGraph } from '../graph/builder.js';
import { findSCCs, longestPathDepths } from '../graph/scc.js';
import { percentile } from '../graph/stats.js';

/**
 * The five core structural metrics, each reduced to a single p75 value per the
 * "Five p75 Metric Decisions" in the initiative's Detailed Design (REQ-010).
 * These five numbers are the sole input to the scorer (T-0007) and `scan()`
 * (T-0008).
 */
export interface Metrics {
  /** p75 of per-module LOC (loc > 0). */
  locPerModule: number;
  /** p75 of per-node longest-path depth; whole-graph max on a degenerate distribution. */
  depDepth: number;
  /** p75 of per-SCC cluster sizes (size > 1); 0 when there are no cycles. */
  circularDeps: number;
  /** p75 of per-module cyclomatic complexity (complexity > 0). */
  complexity: number;
  /** p75 of per-module (fanIn + fanOut) coupling. */
  fanInOut: number;
}

/** p75 over per-node `loc`, filtering `loc <= 0`. Empty distribution → 0. */
function locPerModuleP75(graph: ModuleGraph): number {
  const values: number[] = [];
  for (const { loc } of graph.nodeStats.values()) {
    if (loc > 0) {
      values.push(loc);
    }
  }
  return percentile(values, 75);
}

/** p75 over per-node `complexity`, filtering `complexity <= 0`. Empty → 0. */
function complexityP75(graph: ModuleGraph): number {
  const values: number[] = [];
  for (const { complexity } of graph.nodeStats.values()) {
    if (complexity > 0) {
      values.push(complexity);
    }
  }
  return percentile(values, 75);
}

/**
 * p75 over per-node combined coupling `couple[node] = fanIn[node] + fanOut[node]`
 * across all graph nodes. No nodes → 0; nodes with no edges → all-zero → p75 0.
 */
function fanInOutP75(graph: ModuleGraph): number {
  const values: number[] = [];
  for (const node of graph.nodes) {
    values.push((graph.fanIn.get(node) ?? 0) + (graph.fanOut.get(node) ?? 0));
  }
  return percentile(values, 75);
}

/**
 * p75 over the per-node longest-path depth distribution: each graph node's depth
 * is its condensed SCC's resolved longest-path depth. Fallback: if the
 * distribution has ≤1 distinct value (flat graph / single node), use the
 * whole-graph `maxDepth` scalar so depth never collapses to a misleadingly small
 * p75 (reference `maxDepth` is the p100 of this same distribution). Empty → 0.
 */
function depDepthP75(graph: ModuleGraph, sccs: string[][]): number {
  if (graph.nodes.size === 0) {
    return 0;
  }
  const { maxDepth, depthByNode, dag } = longestPathDepths(graph, sccs);

  const depths: number[] = [];
  for (const node of graph.nodes) {
    const sccIndex = dag.sccOf.get(node);
    if (sccIndex === undefined) {
      continue;
    }
    depths.push(depthByNode.get(sccIndex) ?? 0);
  }

  if (new Set(depths).size <= 1) {
    return maxDepth;
  }
  return percentile(depths, 75);
}

/**
 * p75 over the per-SCC cluster sizes of SCCs with size > 1. No such clusters → 0;
 * exactly one cluster → that value. A per-module cycle ratio was explicitly
 * rejected (Alternatives Considered) — per-SCC size is the only real distribution.
 */
function circularDepsP75(sccs: string[][]): number {
  const sizes = sccs.filter((s) => s.length > 1).map((s) => s.length);
  return sizes.length > 0 ? percentile(sizes, 75) : 0;
}

/**
 * Compute the five p75 metrics from the module graph. Never throws on empty or
 * degenerate graphs (NFR-005); all inputs feed order-independent numeric p75s or
 * are sorted upstream (NFR-001).
 */
export function computeMetrics(graph: ModuleGraph): Metrics {
  const sccs = findSCCs(graph);
  return {
    locPerModule: locPerModuleP75(graph),
    depDepth: depDepthP75(graph, sccs),
    circularDeps: circularDepsP75(sccs),
    complexity: complexityP75(graph),
    fanInOut: fanInOutP75(graph),
  };
}
