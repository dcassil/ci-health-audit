import { describe, expect, it } from 'vitest';
import { buildGraph } from '../src/graph/builder.js';
import { computeMetrics } from '../src/metrics/computeMetrics.js';
import type { Edge, FileStats, ModuleEntry } from '../src/scanner/types.js';

function edge(fromPath: string, toPath: string): Edge {
  return { fromPath, toPath };
}

function mod(source: string, dependencies: string[] = []): ModuleEntry {
  return { source, dependencies };
}

function stat(path: string, loc: number, complexity: number): FileStats {
  return { path, loc, complexity };
}

describe('computeMetrics — degenerate graphs', () => {
  it('empty graph → all five metrics are 0', () => {
    const g = buildGraph([], [], []);
    expect(computeMetrics(g)).toEqual({
      locPerModule: 0,
      depDepth: 0,
      circularDeps: 0,
      complexity: 0,
      fanInOut: 0,
    });
  });

  it('single node with no edges', () => {
    // One node, loc/complexity set, no edges.
    const g = buildGraph([mod('a')], [], [stat('a', 42, 7)]);
    const m = computeMetrics(g);
    // Single non-zero loc/complexity value → p75 is that value.
    expect(m.locPerModule).toBe(42);
    expect(m.complexity).toBe(7);
    // No edges → coupling all 0 → p75 0.
    expect(m.fanInOut).toBe(0);
    // Single node: depth distribution = [1], ≤1 distinct → fallback maxDepth = 1.
    expect(m.depDepth).toBe(1);
    // No cycles.
    expect(m.circularDeps).toBe(0);
  });

  it('graph with nodes but zero edges → fanInOut p75 is 0', () => {
    const g = buildGraph([mod('a'), mod('b'), mod('c')], [], []);
    expect(computeMetrics(g).fanInOut).toBe(0);
  });
});

describe('computeMetrics — locPerModule and complexity p75', () => {
  it('takes p75 over per-node values, filtering non-positive', () => {
    // loc values (positive): 10, 20, 30, 40 (node "z" has loc 0 → filtered).
    const g = buildGraph(
      [mod('a'), mod('b'), mod('c'), mod('d'), mod('z')],
      [],
      [
        stat('a', 10, 1),
        stat('b', 20, 2),
        stat('c', 30, 3),
        stat('d', 40, 4),
        stat('z', 0, 0),
      ],
    );
    const m = computeMetrics(g);
    // sorted loc [10,20,30,40], n=4, idx=0.75*3=2.25 → 30 + 0.25*(40-30) = 32.5
    expect(m.locPerModule).toBe(32.5);
    // sorted complexity [1,2,3,4], idx=2.25 → 3 + 0.25*1 = 3.25
    expect(m.complexity).toBe(3.25);
  });

  it('all loc filtered out → locPerModule 0', () => {
    const g = buildGraph([mod('a')], [], [stat('a', 0, 0)]);
    const m = computeMetrics(g);
    expect(m.locPerModule).toBe(0);
    expect(m.complexity).toBe(0);
  });
});

describe('computeMetrics — fanInOut p75 (hub)', () => {
  it('p75 over per-node (fanIn + fanOut)', () => {
    // Hub 'h' points at leaves a,b,c,d. h: fanOut 4, fanIn 0 → couple 4.
    // Each leaf: fanIn 1, fanOut 0 → couple 1.
    const g = buildGraph(
      [mod('h'), mod('a'), mod('b'), mod('c'), mod('d')],
      [edge('h', 'a'), edge('h', 'b'), edge('h', 'c'), edge('h', 'd')],
      [],
    );
    const m = computeMetrics(g);
    // couple values sorted: [1,1,1,1,4], n=5, idx=0.75*4=3 → exact index 3 = 1
    expect(m.fanInOut).toBe(1);
  });
});

describe('computeMetrics — depDepth p75 and fallback', () => {
  it('flat graph (no edges, multiple nodes) → fallback to whole-graph maxDepth', () => {
    // No edges: every node is a singleton root at depth 1. depths all 1 →
    // ≤1 distinct value → fallback to maxDepth (which is 1).
    const g = buildGraph([mod('a'), mod('b'), mod('c')], [], []);
    expect(computeMetrics(g).depDepth).toBe(1);
  });

  it('chain a→b→c→d → per-node depth p75 (distribution has >1 distinct value)', () => {
    const g = buildGraph(
      [mod('a'), mod('b'), mod('c'), mod('d')],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')],
      [],
    );
    // depths: a=1, b=2, c=3, d=4 → sorted [1,2,3,4], idx=2.25 → 3 + 0.25 = 3.25
    expect(computeMetrics(g).depDepth).toBe(3.25);
  });

  it('deep-but-mostly-flat graph exercises fallback vs p75 boundary', () => {
    // Root r → a, and a long chain r→x1→x2→x3→x4 with x's off to the side.
    // depths: r=1, a=2, x1=2, x2=3, x3=4, x4=5. Distinct {1,2,3,4,5} → p75.
    const g = buildGraph(
      [mod('r'), mod('a'), mod('x1'), mod('x2'), mod('x3'), mod('x4')],
      [
        edge('r', 'a'),
        edge('r', 'x1'),
        edge('x1', 'x2'),
        edge('x2', 'x3'),
        edge('x3', 'x4'),
      ],
      [],
    );
    // depths sorted: [1,2,2,3,4,5], n=6, idx=0.75*5=3.75 → val[3]=3 + 0.75*(4-3)=3.75
    expect(computeMetrics(g).depDepth).toBe(3.75);
  });
});

describe('computeMetrics — circularDeps p75', () => {
  it('zero cycles → 0', () => {
    const g = buildGraph(
      [mod('a'), mod('b'), mod('c')],
      [edge('a', 'b'), edge('b', 'c')],
      [],
    );
    expect(computeMetrics(g).circularDeps).toBe(0);
  });

  it('one giant cycle → p75 of a single cluster size is that size', () => {
    // 4-cycle a→b→c→d→a → one SCC of size 4.
    const g = buildGraph(
      [mod('a'), mod('b'), mod('c'), mod('d')],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('d', 'a')],
      [],
    );
    expect(computeMetrics(g).circularDeps).toBe(4);
  });

  it('many small cycles → p75 over per-SCC cluster sizes', () => {
    // Three independent 2-cycles → three SCCs of size 2.
    const g = buildGraph(
      [mod('a'), mod('b'), mod('c'), mod('d'), mod('e'), mod('f')],
      [
        edge('a', 'b'),
        edge('b', 'a'),
        edge('c', 'd'),
        edge('d', 'c'),
        edge('e', 'f'),
        edge('f', 'e'),
      ],
      [],
    );
    // sizes [2,2,2] → p75 = 2
    expect(computeMetrics(g).circularDeps).toBe(2);
  });

  it('mixed cluster sizes → interpolated p75', () => {
    // One 2-cycle (a,b) and one 4-cycle (c,d,e,f). sizes = [2,4].
    const g = buildGraph(
      [mod('a'), mod('b'), mod('c'), mod('d'), mod('e'), mod('f')],
      [
        edge('a', 'b'),
        edge('b', 'a'),
        edge('c', 'd'),
        edge('d', 'e'),
        edge('e', 'f'),
        edge('f', 'c'),
      ],
      [],
    );
    // sorted sizes [2,4], n=2, idx=0.75*1=0.75 → 2 + 0.75*(4-2) = 3.5
    expect(computeMetrics(g).circularDeps).toBe(3.5);
  });
});

describe('computeMetrics — combined realistic fixture', () => {
  it('produces all five metrics together', () => {
    const modules: ModuleEntry[] = [mod('a'), mod('b'), mod('c')];
    const edges: Edge[] = [edge('a', 'b'), edge('b', 'c')];
    const stats: FileStats[] = [
      stat('a', 100, 5),
      stat('b', 200, 10),
      stat('c', 300, 15),
    ];
    const m = computeMetrics(buildGraph(modules, edges, stats));
    // loc [100,200,300], n=3, idx=1.5 → 200 + 0.5*(300-200) = 250
    expect(m.locPerModule).toBe(250);
    // complexity [5,10,15], idx=1.5 → 10 + 0.5*5 = 12.5
    expect(m.complexity).toBe(12.5);
    // depths a=1,b=2,c=3 → sorted [1,2,3], idx=1.5 → 2 + 0.5 = 2.5
    expect(m.depDepth).toBe(2.5);
    // no cycles
    expect(m.circularDeps).toBe(0);
    // couple: a(out1)=1, b(in1+out1)=2, c(in1)=1 → sorted [1,1,2], idx=1.5 → 1+0.5=1.5
    expect(m.fanInOut).toBe(1.5);
  });
});
