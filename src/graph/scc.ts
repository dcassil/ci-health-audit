import type { ModuleGraph } from './builder.js';

/**
 * Deterministically sorted successors of `node`. Sorting makes Tarjan's output
 * order and the longest-path relaxation independent of `Set`/`Map` insertion
 * order (NFR-001).
 */
function sortedSuccessors(graph: ModuleGraph, node: string): string[] {
  const successors = graph.adj.get(node);
  if (!successors) {
    return [];
  }
  return [...successors].sort();
}

interface TarjanState {
  index: number;
  indices: Map<string, number>;
  lowlink: Map<string, number>;
  onStack: Set<string>;
  stack: string[];
  sccs: string[][];
}

interface Frame {
  node: string;
  successors: string[];
  next: number;
}

function pushFrame(graph: ModuleGraph, state: TarjanState, node: string): Frame {
  state.indices.set(node, state.index);
  state.lowlink.set(node, state.index);
  state.index += 1;
  state.stack.push(node);
  state.onStack.add(node);
  return { node, successors: sortedSuccessors(graph, node), next: 0 };
}

function closeScc(state: TarjanState, root: string): void {
  const component: string[] = [];
  let popped: string | undefined;
  do {
    popped = state.stack.pop();
    if (popped === undefined) {
      break;
    }
    state.onStack.delete(popped);
    component.push(popped);
  } while (popped !== root);
  state.sccs.push(component.sort());
}

/** Process one outgoing edge of `frame`, descending into unvisited successors. */
function visitSuccessor(graph: ModuleGraph, state: TarjanState, frames: Frame[], frame: Frame): void {
  const successor = frame.successors[frame.next];
  frame.next += 1;
  if (successor === undefined) {
    return;
  }
  if (!state.indices.has(successor)) {
    frames.push(pushFrame(graph, state, successor));
  } else if (state.onStack.has(successor)) {
    const current = state.lowlink.get(frame.node) ?? 0;
    const successorIndex = state.indices.get(successor) ?? 0;
    state.lowlink.set(frame.node, Math.min(current, successorIndex));
  }
}

/** Pop a fully-explored `frame`, propagate its lowlink up, and close its SCC if it is a root. */
function settleFrame(state: TarjanState, frames: Frame[], frame: Frame): void {
  frames.pop();
  const parent = frames[frames.length - 1];
  if (parent) {
    const parentLow = state.lowlink.get(parent.node) ?? 0;
    const childLow = state.lowlink.get(frame.node) ?? 0;
    state.lowlink.set(parent.node, Math.min(parentLow, childLow));
  }
  if ((state.lowlink.get(frame.node) ?? 0) === (state.indices.get(frame.node) ?? 0)) {
    closeScc(state, frame.node);
  }
}

function runTarjanFrom(graph: ModuleGraph, state: TarjanState, start: string): void {
  const frames: Frame[] = [pushFrame(graph, state, start)];

  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    if (!frame) {
      break;
    }
    if (frame.next < frame.successors.length) {
      visitSuccessor(graph, state, frames, frame);
    } else {
      settleFrame(state, frames, frame);
    }
  }
}

/**
 * Find strongly connected components via an iterative (explicit-stack) Tarjan's
 * algorithm — safe against stack overflow on deep real-world graphs. A
 * self-loop yields a singleton SCC (never size 2). Node ids are iterated in
 * sorted order so output is deterministic (NFR-001).
 */
export function findSCCs(graph: ModuleGraph): string[][] {
  const state: TarjanState = {
    index: 0,
    indices: new Map<string, number>(),
    lowlink: new Map<string, number>(),
    onStack: new Set<string>(),
    stack: [],
    sccs: [],
  };

  for (const node of [...graph.nodes].sort()) {
    if (!state.indices.has(node)) {
      runTarjanFrom(graph, state, node);
    }
  }

  return state.sccs;
}

/**
 * The SCC-condensed DAG: nodes are SCC indices, edges are unique inter-SCC
 * edges. `indegree` counts incoming condensed edges (roots have indegree 0).
 */
export interface CondensedDag {
  /** Count of SCC nodes. */
  size: number;
  /** SCC index → sorted set of successor SCC indices. */
  adj: Map<number, Set<number>>;
  /** SCC index → condensed indegree. */
  indegree: Map<number, number>;
  /** Node id → its SCC index. */
  sccOf: Map<string, number>;
  /** SCCs, indexed by SCC index. */
  sccs: string[][];
}

/**
 * Collapse a graph's SCCs into a DAG over SCC indices. Self-edges and
 * intra-SCC edges are dropped; inter-SCC edges are deduplicated.
 */
export function condense(graph: ModuleGraph, sccs: string[][]): CondensedDag {
  const sccOf = new Map<string, number>();
  sccs.forEach((component, i) => {
    for (const node of component) {
      sccOf.set(node, i);
    }
  });

  const adj = new Map<number, Set<number>>();
  const indegree = new Map<number, number>();
  for (let i = 0; i < sccs.length; i += 1) {
    adj.set(i, new Set<number>());
    indegree.set(i, 0);
  }

  for (const from of [...graph.nodes].sort()) {
    const fromScc = sccOf.get(from);
    if (fromScc === undefined) {
      continue;
    }
    for (const to of sortedSuccessors(graph, from)) {
      const toScc = sccOf.get(to);
      if (toScc === undefined || toScc === fromScc) {
        continue;
      }
      const successors = adj.get(fromScc);
      if (successors && !successors.has(toScc)) {
        successors.add(toScc);
        indegree.set(toScc, (indegree.get(toScc) ?? 0) + 1);
      }
    }
  }

  return { size: sccs.length, adj, indegree, sccOf, sccs };
}

/**
 * Longest-path depths over the condensed DAG. Condensed roots (indegree 0)
 * start at depth 1; each edge relaxes `newDepth = currentDepth + 1`, keeping
 * the maximum per node (a forward Kahn/queue relaxation). Returns both the
 * per-condensed-node depth map and the whole-graph max depth. `maxDepth` is the
 * p100 of the depth distribution. Empty graph → `maxDepth` 0.
 */
export function longestPath(dag: CondensedDag): {
  maxDepth: number;
  depthByNode: Map<number, number>;
} {
  const depthByNode = new Map<number, number>();
  const queue: number[] = [];

  for (let i = 0; i < dag.size; i += 1) {
    if ((dag.indegree.get(i) ?? 0) === 0) {
      depthByNode.set(i, 1);
      queue.push(i);
    }
  }
  queue.sort((a, b) => a - b);

  let maxDepth = dag.size > 0 ? 1 : 0;
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (current === undefined) {
      continue;
    }
    const newDepth = (depthByNode.get(current) ?? 0) + 1;
    for (const neighbor of [...(dag.adj.get(current) ?? [])].sort((a, b) => a - b)) {
      if ((depthByNode.get(neighbor) ?? 0) < newDepth) {
        depthByNode.set(neighbor, newDepth);
        maxDepth = Math.max(maxDepth, newDepth);
        queue.push(neighbor);
      }
    }
  }

  return { maxDepth, depthByNode };
}

/**
 * Convenience: condense a graph's SCCs and compute condensed longest-path
 * depths in one call, returning both the per-SCC-node depth map and the
 * whole-graph max depth (T-0006 consumes both).
 */
export function longestPathDepths(
  graph: ModuleGraph,
  sccs: string[][],
): { maxDepth: number; depthByNode: Map<number, number>; dag: CondensedDag } {
  const dag = condense(graph, sccs);
  const { maxDepth, depthByNode } = longestPath(dag);
  return { maxDepth, depthByNode, dag };
}
