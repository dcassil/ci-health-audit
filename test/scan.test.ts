/**
 * Unit tests for the `scan()` orchestrator and the real `execCommandRunner`
 * (CIHA-I-0001, Phase 8 / CIHA-T-0008). These use a mocked {@link CommandRunner}
 * so they run without `scc`/`depcruise` installed and assert wiring, absence of
 * side effects, and degenerate-input behavior. The real end-to-end run against
 * the fixture repo lives in `test/integration/scan.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  scan,
  scanWithRawConfig,
  execCommandRunner,
  CommandExecutionError,
  PluginRegistry,
  DEFAULT_CONFIG,
  type CommandRunner,
  type Config,
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

const config: Config = { ...DEFAULT_CONFIG, srcDir: '/repo/src' };

describe('scan()', () => {
  it('wires plugin → graph → metrics → scorer into a ScanResult', async () => {
    const result = await scan(config, { runner: cannedRunner() });
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
    const result = await scan(config, { runner: cannedRunner() });
    expect(result.breakdown).toHaveLength(5);
  });

  it('accepts an injected registry (NFR-006)', async () => {
    const registry = new PluginRegistry();
    const { TsToolPlugin } = await import('../src/plugins/ts/plugin.js');
    registry.register(new TsToolPlugin());
    const result = await scan(config, { runner: cannedRunner(), registry });
    expect(result.breakdown).toHaveLength(5);
  });

  it('performs no writes, exits, or network — only reads via the runner (NFR-002)', async () => {
    const run = vi.fn((command: string): string =>
      command.startsWith('scc') ? SCC_JSON : DEPCRUISE_JSON,
    );
    const original = { ...config };
    await scan(config, { runner: { run } });
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
    const result = await scan(config, { runner: emptyRunner });
    expect(result.breakdown.map((b) => b.rawP75)).toEqual([0, 0, 0, 0, 0]);
    expect(result.score).toBe(10);
  });

  it('propagates typed tool errors (NFR-004)', async () => {
    const failing: CommandRunner = {
      run(): string {
        throw new Error('command not found: scc');
      },
    };
    await expect(scan(config, { runner: failing })).rejects.toThrow();
  });
});

describe('scanWithRawConfig()', () => {
  it('validates raw JSON via loadConfig then scans', async () => {
    const raw = { ...DEFAULT_CONFIG, srcDir: '/repo/src' };
    const result = await scanWithRawConfig(raw, { runner: cannedRunner() });
    expect(result.breakdown).toHaveLength(5);
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
