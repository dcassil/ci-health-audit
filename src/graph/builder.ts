import type { Edge, FileStats, ModuleEntry } from '../scanner/types.js';

/**
 * Per-node LOC and cyclomatic complexity, matched from {@link FileStats}.
 */
export interface NodeStats {
  loc: number;
  complexity: number;
}

/**
 * The directed module graph every structural metric reads from.
 *
 * - `nodes`: every module source plus every edge endpoint.
 * - `adj`: outgoing adjacency; `Set`s dedupe parallel `from→to` edges.
 * - `revAdj`: reverse adjacency (`to→from`) for the same unique edges.
 * - `fanIn`/`fanOut`: unique in/out degree per node.
 * - `nodeStats`: LOC/complexity per node id (defaults to 0 when unmatched).
 */
export interface ModuleGraph {
  nodes: Set<string>;
  adj: Map<string, Set<string>>;
  revAdj: Map<string, Set<string>>;
  fanIn: Map<string, number>;
  fanOut: Map<string, number>;
  nodeStats: Map<string, NodeStats>;
}

function ensureNode(graph: ModuleGraph, id: string): void {
  if (graph.nodes.has(id)) {
    return;
  }
  graph.nodes.add(id);
  graph.adj.set(id, new Set<string>());
  graph.revAdj.set(id, new Set<string>());
  graph.fanIn.set(id, 0);
  graph.fanOut.set(id, 0);
  graph.nodeStats.set(id, { loc: 0, complexity: 0 });
}

/**
 * Build the directed module graph from scanner output.
 *
 * Every module `source` becomes a node. Every edge ensures both endpoints
 * exist. Outgoing adjacency `Set`s deduplicate edges, so a repeated `from→to`
 * increments `fanOut`/`fanIn` exactly once. A self-edge (`from === to`) is
 * recorded in adjacency but does not double-count as two distinct nodes; it
 * yields a singleton SCC downstream (never a size-2 cluster).
 */
export function buildGraph(
  modules: ModuleEntry[],
  edges: Edge[],
  fileStats: FileStats[],
): ModuleGraph {
  const graph: ModuleGraph = {
    nodes: new Set<string>(),
    adj: new Map<string, Set<string>>(),
    revAdj: new Map<string, Set<string>>(),
    fanIn: new Map<string, number>(),
    fanOut: new Map<string, number>(),
    nodeStats: new Map<string, NodeStats>(),
  };

  for (const module of modules) {
    ensureNode(graph, module.source);
  }

  for (const edge of edges) {
    const { fromPath: from, toPath: to } = edge;
    ensureNode(graph, from);
    ensureNode(graph, to);

    const fromAdj = graph.adj.get(from);
    if (fromAdj && !fromAdj.has(to)) {
      fromAdj.add(to);
      graph.fanOut.set(from, (graph.fanOut.get(from) ?? 0) + 1);
      graph.fanIn.set(to, (graph.fanIn.get(to) ?? 0) + 1);
      graph.revAdj.get(to)?.add(from);
    }
  }

  for (const stats of fileStats) {
    if (graph.nodes.has(stats.path)) {
      graph.nodeStats.set(stats.path, {
        loc: stats.loc,
        complexity: stats.complexity,
      });
    }
  }

  return graph;
}
