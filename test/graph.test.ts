import { describe, expect, it } from 'vitest';
import { buildGraph } from '../src/graph/builder.js';
import { condense, findSCCs, longestPath, longestPathDepths } from '../src/graph/scc.js';
import type { Edge, FileStats, ModuleEntry } from '../src/scanner/types.js';

function edge(fromPath: string, toPath: string): Edge {
  return { fromPath, toPath };
}

function mod(source: string, dependencies: string[] = []): ModuleEntry {
  return { source, dependencies };
}

/** Sort SCCs canonically for order-independent comparison. */
function normalizeSccs(sccs: string[][]): string[][] {
  return sccs.map((c) => [...c].sort()).sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''));
}

describe('buildGraph', () => {
  it('creates a node per module source and every edge endpoint', () => {
    const g = buildGraph([mod('a'), mod('b')], [edge('a', 'c')], []);
    expect(g.nodes).toEqual(new Set(['a', 'b', 'c']));
  });

  it('dedupes parallel edges: fan-in/out counted once', () => {
    const g = buildGraph([], [edge('a', 'b'), edge('a', 'b'), edge('a', 'b')], []);
    expect(g.fanOut.get('a')).toBe(1);
    expect(g.fanIn.get('b')).toBe(1);
    expect(g.adj.get('a')).toEqual(new Set(['b']));
    expect(g.revAdj.get('b')).toEqual(new Set(['a']));
  });

  it('attaches per-node loc/complexity by matching FileStats.path', () => {
    const stats: FileStats[] = [
      { path: 'a', loc: 10, complexity: 3 },
      { path: 'orphan', loc: 99, complexity: 9 },
    ];
    const g = buildGraph([mod('a'), mod('b')], [], stats);
    expect(g.nodeStats.get('a')).toEqual({ loc: 10, complexity: 3 });
    // Unmatched node defaults to zeros; stats for non-nodes ignored.
    expect(g.nodeStats.get('b')).toEqual({ loc: 0, complexity: 0 });
    expect(g.nodeStats.has('orphan')).toBe(false);
  });

  it('hub node: fan-in and fan-out degree counts', () => {
    // hub depends on a,b,c ; x,y depend on hub
    const edges = [
      edge('hub', 'a'),
      edge('hub', 'b'),
      edge('hub', 'c'),
      edge('x', 'hub'),
      edge('y', 'hub'),
    ];
    const g = buildGraph([], edges, []);
    expect(g.fanOut.get('hub')).toBe(3);
    expect(g.fanIn.get('hub')).toBe(2);
    expect(g.fanIn.get('a')).toBe(1);
    expect(g.fanOut.get('x')).toBe(1);
  });
});

describe('findSCCs', () => {
  it('linear chain: all singletons', () => {
    const g = buildGraph([], [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')], []);
    const sccs = findSCCs(g);
    expect(sccs).toHaveLength(4);
    expect(sccs.every((c) => c.length === 1)).toBe(true);
  });

  it('3-node cycle: one SCC of size 3', () => {
    const g = buildGraph([], [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')], []);
    const sccs = findSCCs(g);
    expect(sccs).toHaveLength(1);
    expect(sccs[0]).toEqual(['a', 'b', 'c']);
  });

  it('two disjoint cycles: two SCCs of size 2', () => {
    const edges = [
      edge('a', 'b'),
      edge('b', 'a'),
      edge('x', 'y'),
      edge('y', 'x'),
    ];
    const g = buildGraph([], edges, []);
    const sccs = normalizeSccs(findSCCs(g));
    expect(sccs).toEqual([
      ['a', 'b'],
      ['x', 'y'],
    ]);
  });

  it('self-loop is a singleton SCC (NOT size 2)', () => {
    const g = buildGraph([mod('a')], [edge('a', 'a')], []);
    const sccs = findSCCs(g);
    expect(sccs).toEqual([['a']]);
    expect(sccs.every((c) => c.length === 1)).toBe(true);
  });

  it('empty graph: no SCCs', () => {
    expect(findSCCs(buildGraph([], [], []))).toEqual([]);
  });

  it('single node: one singleton SCC', () => {
    expect(findSCCs(buildGraph([mod('a')], [], []))).toEqual([['a']]);
  });
});

describe('longestPath depth', () => {
  it('linear chain: depth equals length, per-node depths 1..n', () => {
    const chain = buildGraph([], [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')], []);
    const sccs = findSCCs(chain);
    const { maxDepth, depthByNode, dag } = longestPathDepths(chain, sccs);
    expect(maxDepth).toBe(4);
    // each SCC is a singleton; map its node to depth
    const depthOf = (id: string): number => depthByNode.get(dag.sccOf.get(id) ?? -1) ?? 0;
    expect(depthOf('a')).toBe(1);
    expect(depthOf('b')).toBe(2);
    expect(depthOf('c')).toBe(3);
    expect(depthOf('d')).toBe(4);
  });

  it('diamond: converging paths keep the longer depth', () => {
    // a→b, a→c, b→d, c→d  → depth of d = 3
    const g = buildGraph([], [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')], []);
    const sccs = findSCCs(g);
    const { maxDepth, depthByNode, dag } = longestPathDepths(g, sccs);
    expect(maxDepth).toBe(3);
    const depthOf = (id: string): number => depthByNode.get(dag.sccOf.get(id) ?? -1) ?? 0;
    expect(depthOf('a')).toBe(1);
    expect(depthOf('b')).toBe(2);
    expect(depthOf('c')).toBe(2);
    expect(depthOf('d')).toBe(3);
  });

  it('single node: depth 1', () => {
    const g = buildGraph([mod('a')], [], []);
    const { maxDepth } = longestPathDepths(g, findSCCs(g));
    expect(maxDepth).toBe(1);
  });

  it('empty graph: depth 0', () => {
    const g = buildGraph([], [], []);
    const { maxDepth, depthByNode } = longestPathDepths(g, findSCCs(g));
    expect(maxDepth).toBe(0);
    expect(depthByNode.size).toBe(0);
  });

  it('3-node cycle condenses to one node: depth 1', () => {
    const g = buildGraph([], [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')], []);
    const sccs = findSCCs(g);
    const dag = condense(g, sccs);
    expect(dag.size).toBe(1);
    expect(longestPath(dag).maxDepth).toBe(1);
  });

  it('cycle feeding a tail: condensed chain depth 2', () => {
    // a↔b cycle, then b→c
    const g = buildGraph([], [edge('a', 'b'), edge('b', 'a'), edge('b', 'c')], []);
    const sccs = findSCCs(g);
    const { maxDepth } = longestPathDepths(g, sccs);
    expect(maxDepth).toBe(2);
  });
});
