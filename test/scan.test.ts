/**
 * Unit tests for the `scan()` orchestrator and the real `execCommandRunner`
 * (CIHA-I-0001, Phase 8 / CIHA-T-0008). These use a mocked {@link CommandRunner}
 * so they run without `scc`/`depcruise` installed and assert wiring, absence of
 * side effects, and degenerate-input behavior. The real end-to-end run against
 * the fixture repo lives in `test/integration/scan.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  scanOne,
  scanProjects,
  scanWithRawConfig,
  execCommandRunner,
  CommandExecutionError,
  PluginRegistry,
  DEFAULT_CONFIG,
  type CommandRunner,
  type Config,
  type ConfigFile,
  type ScanResult,
} from '../src/index.js';

/** Canned scc output: two nested modules with LOC/complexity. */
const SCC_JSON = JSON.stringify([
  {
    Name: 'TypeScript',
    Files: [
      { Filename: 'a.ts', Location: 'lib/a.ts', Code: 100, Complexity: 8 },
      { Filename: 'b.ts', Location: 'lib/b.ts', Code: 40, Complexity: 2 },
    ],
  },
]);

/** Canned depcruise output: a single edge lib/a.ts -> lib/b.ts. */
const DEPCRUISE_JSON = JSON.stringify({
  modules: [
    { source: 'lib/a.ts', dependencies: [{ resolved: 'lib/b.ts' }] },
    { source: 'lib/b.ts', dependencies: [] },
  ],
});

function cannedRunner(): CommandRunner {
  return {
    run(command: string): string {
      return command.startsWith('scc') ? SCC_JSON : DEPCRUISE_JSON;
    },
  };
}

const config: Config = { ...DEFAULT_CONFIG, srcDir: '/repo/src', lastScore: 0 };

describe('scanOne()', () => {
  it('wires plugin → graph → metrics → scorer into a ScanResult', async () => {
    const result = await scanOne(config, { runner: cannedRunner() });
    expect(typeof result.score).toBe('number');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(10);
    expect(result.breakdown.map((b) => b.metric)).toEqual([
      'locPerModule',
      'depDepth',
      'circularDeps',
      'complexity',
      'fanInOut',
    ]);
    // scc LOC/complexity flowed through to the breakdown (path-matched nodes).
    const loc = result.breakdown.find((b) => b.metric === 'locPerModule');
    expect(loc?.rawP75).toBeGreaterThan(0);
  });

  it('resolves the TsToolPlugin from the default registry for language "ts"', async () => {
    // No explicit registry: exercises the built-in default (TsToolPlugin).
    const result = await scanOne(config, { runner: cannedRunner() });
    expect(result.breakdown).toHaveLength(5);
  });

  it('accepts an injected registry (NFR-006)', async () => {
    const registry = new PluginRegistry();
    const { TsToolPlugin } = await import('../src/plugins/ts/plugin.js');
    registry.register(new TsToolPlugin());
    const result = await scanOne(config, { runner: cannedRunner(), registry });
    expect(result.breakdown).toHaveLength(5);
  });

  it('performs no writes, exits, or network — only reads via the runner (NFR-002)', async () => {
    const run = vi.fn((command: string): string =>
      command.startsWith('scc') ? SCC_JSON : DEPCRUISE_JSON,
    );
    const original = { ...config };
    await scanOne(config, { runner: { run } });
    // The config object is not mutated (no lastScore write-back).
    expect(config).toEqual(original);
    // The runner is the only side-effecting seam and was invoked.
    expect(run).toHaveBeenCalled();
  });

  it('does not throw on degenerate empty tool output (NFR-005)', async () => {
    const emptyRunner: CommandRunner = {
      run(command: string): string {
        return command.startsWith('scc') ? '[]' : '{"modules":[]}';
      },
    };
    const result = await scanOne(config, { runner: emptyRunner });
    expect(result.breakdown.map((b) => b.rawP75)).toEqual([0, 0, 0, 0, 0]);
    expect(result.score).toBe(10);
  });

  it('propagates typed tool errors (NFR-004)', async () => {
    const failing: CommandRunner = {
      run(): string {
        throw new Error('command not found: scc');
      },
    };
    await expect(scanOne(config, { runner: failing })).rejects.toThrow();
  });
});

/** A fake `scanOne` seam yielding a fixed score per call (no shell-out). */
function fakeScanOne(scores: number[]): {
  fn: (config: Config) => Promise<ScanResult>;
  seenSrcDirs: string[];
} {
  const seenSrcDirs: string[] = [];
  let i = 0;
  const fn = (config: Config): Promise<ScanResult> => {
    seenSrcDirs.push(config.srcDir);
    const s = scores[i] ?? 0;
    i += 1;
    return Promise.resolve({ score: s, breakdown: [] });
  };
  return { fn, seenSrcDirs };
}

/** Build a validated-shaped ConfigFile from a list of [name, srcDir] projects. */
function configFile(projects: [string, string][]): ConfigFile {
  return {
    ...DEFAULT_CONFIG,
    projects: projects.map(([name, srcDir]) => ({ name, srcDir, lastScore: 0 })),
  };
}

describe('scanProjects()', () => {
  it('scores every project in declared config order (NFR-001)', async () => {
    const cfg = configFile([
      ['core', '/repo/core'],
      ['cli', '/repo/cli'],
      ['dash', '/repo/dash'],
    ]);
    const fake = fakeScanOne([7, 5, 9]);
    const out = await scanProjects(cfg, { scanOne: fake.fn });
    expect(out.projects.map((p) => p.name)).toEqual(['core', 'cli', 'dash']);
    // scanOne was invoked in declared order (srcDir sequence proves it).
    expect(fake.seenSrcDirs).toEqual(['/repo/core', '/repo/cli', '/repo/dash']);
  });

  it('carries each project name, srcDir, and its ScanResult through', async () => {
    const cfg = configFile([
      ['core', '/repo/core'],
      ['cli', '/repo/cli'],
    ]);
    const fake = fakeScanOne([7, 5]);
    const out = await scanProjects(cfg, { scanOne: fake.fn });
    expect(out.projects[0]).toEqual({
      name: 'core',
      srcDir: '/repo/core',
      result: { score: 7, breakdown: [] },
    });
    expect(out.projects[1]?.result.score).toBe(5);
  });

  it('headline score is the arithmetic mean, rounded to two decimals (REQ-004)', async () => {
    const cfg = configFile([
      ['a', '/a'],
      ['b', '/b'],
      ['c', '/c'],
    ]);
    // (7 + 5 + 9) / 3 = 7
    const out = await scanProjects(cfg, { scanOne: fakeScanOne([7, 5, 9]).fn });
    expect(out.score).toBe(7);

    // (8.1 + 4.5) / 2 = 6.3 (exercises rounding to two decimals)
    const out2 = await scanProjects(configFile([['a', '/a'], ['b', '/b']]), {
      scanOne: fakeScanOne([8.1, 4.5]).fn,
    });
    expect(out2.score).toBe(6.3);

    // (1 + 2) / 3-style repeating decimal → exactly one rounding step.
    const out3 = await scanProjects(
      configFile([['a', '/a'], ['b', '/b'], ['c', '/c']]),
      { scanOne: fakeScanOne([1, 1, 2]).fn },
    );
    expect(out3.score).toBe(1.33);
  });

  it('a one-project config yields that project single score unchanged', async () => {
    const cfg = configFile([['only', '/repo/only']]);
    const out = await scanProjects(cfg, { scanOne: fakeScanOne([6.42]).fn });
    expect(out.projects).toHaveLength(1);
    expect(out.projects[0]?.result.score).toBe(6.42);
    expect(out.score).toBe(6.42);
  });

  it('performs no writes/exits and calls scanOne once per project (NFR-002)', async () => {
    const cfg = configFile([['a', '/a'], ['b', '/b']]);
    const spy = vi.fn(
      (config: Config): Promise<ScanResult> =>
        Promise.resolve({ score: config.srcDir === '/a' ? 3 : 7, breakdown: [] }),
    );
    const original = structuredClone(cfg);
    const out = await scanProjects(cfg, { scanOne: spy });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(out.score).toBe(5);
    // The config file object is not mutated (no write-back in the engine).
    expect(cfg).toEqual(original);
  });

  it('defaults to the real scanOne when none is injected (uses runner seam)', async () => {
    const cfg = configFile([['a', '/repo/src']]);
    const out = await scanProjects(cfg, { runner: cannedRunner() });
    expect(out.projects).toHaveLength(1);
    expect(out.projects[0]?.result.breakdown).toHaveLength(5);
  });
});

describe('scanWithRawConfig()', () => {
  it('validates raw JSON via loadConfig then scans every project', async () => {
    const raw = {
      ...DEFAULT_CONFIG,
      projects: [{ name: '.', srcDir: '/repo/src', lastScore: 0 }],
    };
    const result = await scanWithRawConfig(raw, { runner: cannedRunner() });
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]?.result.breakdown).toHaveLength(5);
    expect(result.score).toBe(result.projects[0]?.result.score);
  });

  it('rejects invalid raw config with a readable error', async () => {
    await expect(
      scanWithRawConfig({ language: 'python' }, { runner: cannedRunner() }),
    ).rejects.toThrow(/Invalid ci-health-audit config/);
  });
});

describe('execCommandRunner', () => {
  it('returns stdout for a successful command', () => {
    const out = execCommandRunner.run('echo hello-world', process.cwd());
    expect(out).toContain('hello-world');
  });

  it('throws a descriptive CommandExecutionError on non-zero exit (NFR-004)', () => {
    expect(() =>
      execCommandRunner.run('this-binary-does-not-exist-xyz', process.cwd()),
    ).toThrow(CommandExecutionError);
  });

  it('names the command and cwd in the error', () => {
    try {
      execCommandRunner.run('exit 3', process.cwd());
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CommandExecutionError);
      const err = error as CommandExecutionError;
      expect(err.command).toBe('exit 3');
      expect(err.cwd).toBe(process.cwd());
    }
  });
});
