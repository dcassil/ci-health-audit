import { describe, expect, it } from 'vitest';
import { parseScc, runScc, SccError } from '../src/plugins/ts/scc.js';
import {
  DepcruiseError,
  parseDepcruise,
  runDepcruise,
} from '../src/plugins/ts/depcruise.js';
import { TsToolPlugin } from '../src/plugins/ts/plugin.js';
import type { CommandRunner, ScanContext } from '../src/scanner/types.js';
import { type Config, DEFAULT_CONFIG } from '../src/config/schema.js';

const config: Config = DEFAULT_CONFIG;

/** A CommandRunner that returns a canned stdout for whichever binary is invoked. */
function makeRunner(map: {
  scc?: string;
  depcruise?: string;
  throwFor?: 'scc' | 'depcruise';
}): CommandRunner {
  return {
    run(command: string): string {
      const which = command.startsWith('scc') ? 'scc' : 'depcruise';
      if (map.throwFor === which) {
        throw new Error(`command not found: ${which}`);
      }
      const out = which === 'scc' ? map.scc : map.depcruise;
      if (out === undefined) {
        throw new Error(`no canned output for ${which}`);
      }
      return out;
    },
  };
}

function makeCtx(runner: CommandRunner, srcDir = '/repo/src'): ScanContext {
  return { srcDir, config, runner };
}

// Canned scc output: one JS group, one TS group, one non-code (Markdown) group.
const SCC_JSON = [
  {
    Name: 'TypeScript',
    Files: [
      { Filename: '/repo/src/a.ts', Code: 100, Complexity: 8 },
      { Filename: '/repo/src/b.ts', Code: 40, Complexity: 2 },
    ],
  },
  {
    Name: 'JavaScript',
    Files: [{ Filename: '/repo/src/c.js', Code: 25, Complexity: 1 }],
  },
  {
    Name: 'Markdown',
    Files: [{ Filename: '/repo/README.md', Code: 999, Complexity: 0 }],
  },
];

// Canned depcruise output exercising internal edges, externals, and a dup edge.
const DEPCRUISE_JSON = {
  modules: [
    {
      source: 'src/a.ts',
      dependencies: [
        { resolved: 'src/b.ts' },
        { resolved: 'src/b.ts' }, // duplicate — must dedup
        { resolved: 'node_modules/zod/index.js' }, // external
        { resolved: 'node:path' }, // external builtin
        { resolved: 'lodash' }, // bare specifier external
      ],
    },
    {
      source: 'src/b.ts',
      dependencies: [{ resolved: 'src/c.ts' }],
    },
    {
      source: 'node_modules/zod/index.js', // external source — skipped entirely
      dependencies: [{ resolved: 'src/a.ts' }],
    },
  ],
};

describe('parseScc', () => {
  it('keeps only recognized code languages and maps Code/Complexity', () => {
    const stats = parseScc(SCC_JSON);
    expect(stats).toEqual([
      { path: '/repo/src/a.ts', loc: 100, complexity: 8 },
      { path: '/repo/src/b.ts', loc: 40, complexity: 2 },
      { path: '/repo/src/c.js', loc: 25, complexity: 1 },
    ]);
  });

  it('returns an empty array for degenerate (empty) input', () => {
    expect(parseScc([])).toEqual([]);
  });

  it('throws a descriptive SccError on malformed JSON shape', () => {
    expect(() => parseScc({ not: 'an array' })).toThrow(SccError);
    expect(() => parseScc([{ Name: 'TypeScript' }])).toThrow(SccError);
  });
});

describe('parseDepcruise', () => {
  it('filters externals, normalizes, and dedups edges', () => {
    const { modules, edges } = parseDepcruise(DEPCRUISE_JSON);

    // External source module dropped; two internal modules remain.
    expect(modules).toEqual([
      { source: 'src/a.ts', dependencies: ['src/b.ts'] },
      { source: 'src/b.ts', dependencies: ['src/c.ts'] },
    ]);

    // node_modules / node: / bare specifiers filtered; duplicate collapsed.
    expect(edges).toEqual([
      { fromPath: 'src/a.ts', toPath: 'src/b.ts' },
      { fromPath: 'src/b.ts', toPath: 'src/c.ts' },
    ]);
  });

  it('returns empty modules/edges for degenerate (no modules) input', () => {
    expect(parseDepcruise({ modules: [] })).toEqual({
      modules: [],
      edges: [],
    });
  });

  it('throws a descriptive DepcruiseError on malformed JSON shape', () => {
    expect(() => parseDepcruise({ nope: true })).toThrow(DepcruiseError);
  });
});

describe('runScc', () => {
  it('builds the scc command and parses its stdout', () => {
    let captured = '';
    const runner: CommandRunner = {
      run(command: string): string {
        captured = command;
        return JSON.stringify(SCC_JSON);
      },
    };
    const stats = runScc(makeCtx(runner));
    // Scans the cwd (`.`), which the runner sets to the resolved srcDir, so a
    // relative srcDir cannot become srcDir/srcDir.
    expect(captured).toBe('scc --by-file --format json .');
    expect(stats).toHaveLength(3);
  });

  it('wraps a runner failure as a descriptive SccError (NFR-004)', () => {
    const runner = makeRunner({ throwFor: 'scc' });
    expect(() => runScc(makeCtx(runner))).toThrow(SccError);
    expect(() => runScc(makeCtx(runner))).toThrow(/scc.*installed/);
  });

  it('throws SccError when stdout is not valid JSON (NFR-004)', () => {
    const runner = makeRunner({ scc: 'not json at all' });
    expect(() => runScc(makeCtx(runner))).toThrow(SccError);
    expect(() => runScc(makeCtx(runner))).toThrow(/not valid JSON/);
  });
});

describe('runDepcruise', () => {
  it('builds the depcruise command (no tsconfig found) and parses stdout', () => {
    let captured = '';
    const runner: CommandRunner = {
      run(command: string): string {
        captured = command;
        return JSON.stringify(DEPCRUISE_JSON);
      },
    };
    // Use a path that will not find a tsconfig.json up to root.
    const { edges } = runDepcruise(
      makeCtx(runner, '/nonexistent-xyz-123/src'),
    );
    expect(captured).toContain('depcruise --config');
    expect(captured).toContain('--output-type json');
    // Globs are srcDir-relative (cwd = resolved srcDir), not srcDir-embedded.
    expect(captured).toContain('"**/*.ts"');
    expect(edges).toHaveLength(2);
  });

  it('wraps a runner failure as a descriptive DepcruiseError (NFR-004)', () => {
    const runner = makeRunner({ throwFor: 'depcruise' });
    expect(() =>
      runDepcruise(makeCtx(runner, '/nonexistent-xyz-123/src')),
    ).toThrow(DepcruiseError);
  });

  it('throws DepcruiseError when stdout is not valid JSON (NFR-004)', () => {
    const runner = makeRunner({ depcruise: '<<<garbage>>>' });
    expect(() =>
      runDepcruise(makeCtx(runner, '/nonexistent-xyz-123/src')),
    ).toThrow(/not valid JSON/);
  });
});

describe('TsToolPlugin', () => {
  it('has id "ts" and supports the four TS/JS aliases', () => {
    const plugin = new TsToolPlugin();
    expect(plugin.id).toBe('ts');
    expect(plugin.supports.languages).toEqual([
      'ts',
      'js',
      'typescript',
      'javascript',
    ]);
  });

  it('composes runScc + runDepcruise into a ToolRunOutput', async () => {
    const runner = makeRunner({
      scc: JSON.stringify(SCC_JSON),
      depcruise: JSON.stringify(DEPCRUISE_JSON),
    });
    const plugin = new TsToolPlugin();
    const output = await plugin.run(makeCtx(runner, '/nonexistent-xyz-123/src'));

    expect(output.fileStats).toHaveLength(3);
    expect(output.modules).toEqual([
      { source: 'src/a.ts', dependencies: ['src/b.ts'] },
      { source: 'src/b.ts', dependencies: ['src/c.ts'] },
    ]);
    expect(output.edges).toEqual([
      { fromPath: 'src/a.ts', toPath: 'src/b.ts' },
      { fromPath: 'src/b.ts', toPath: 'src/c.ts' },
    ]);
    expect(output.raw).toEqual({
      fileStats: output.fileStats,
      modules: output.modules,
      edges: output.edges,
    });
  });

  it('propagates a typed error when a binary is missing (NFR-004)', async () => {
    const runner = makeRunner({ throwFor: 'scc' });
    const plugin = new TsToolPlugin();
    await expect(
      plugin.run(makeCtx(runner, '/nonexistent-xyz-123/src')),
    ).rejects.toThrow(SccError);
  });
});
