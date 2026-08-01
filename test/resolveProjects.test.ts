import { describe, expect, it } from 'vitest';
import { resolveProjects } from '../src/config/resolveProjects.js';
import { loadConfig } from '../src/config/loadConfig.js';
import type { ConfigFile } from '../src/config/schema.js';

/** Build a valid ConfigFile via the loader from a shared base + projects. */
function makeConfig(projects: Record<string, unknown>[]): ConfigFile {
  return loadConfig({
    language: 'ts',
    threshold: -2,
    weights: {
      ts: {
        locPerModule: 1,
        depDepth: 1,
        circularDeps: 1,
        complexity: 1,
        fanInOut: 1,
      },
    },
    baselines: {
      locPerModule: { good: 50, bad: 150, direction: 'lower-better' },
      depDepth: { good: 5, bad: 20, direction: 'lower-better' },
      circularDeps: { good: 0, bad: 3, direction: 'lower-better' },
      complexity: { good: 5, bad: 20, direction: 'lower-better' },
      fanInOut: { good: 6, bad: 30, direction: 'lower-better' },
    },
    projects,
  });
}

describe('resolveProjects', () => {
  it('resolves each project in declared config order (NFR-001)', () => {
    const config = makeConfig([
      { name: 'core', srcDir: './packages/core', lastScore: 7.4 },
      { name: 'cli', srcDir: './apps/cli', lastScore: 6.1 },
      { name: 'web', srcDir: './apps/web', lastScore: 5.0 },
    ]);
    const resolved = resolveProjects(config);
    expect(resolved.map((p) => p.srcDir)).toEqual([
      './packages/core',
      './apps/cli',
      './apps/web',
    ]);
    expect(resolved.map((p) => p.lastScore)).toEqual([7.4, 6.1, 5.0]);
  });

  it('inherits shared defaults when a project has no overrides', () => {
    const config = makeConfig([{ name: 'core', srcDir: './src', lastScore: 3 }]);
    const [effective] = resolveProjects(config);
    expect(effective).toEqual({
      language: 'ts',
      srcDir: './src',
      lastScore: 3,
      threshold: -2,
      weights: config.weights,
      baselines: config.baselines,
    });
  });

  it('is shape-identical to a single-root Config for a one-project config', () => {
    const config = makeConfig([{ name: '.', srcDir: './src', lastScore: 0 }]);
    const [effective] = resolveProjects(config);
    expect(Object.keys(effective ?? {}).sort()).toEqual(
      ['baselines', 'lastScore', 'language', 'srcDir', 'threshold', 'weights'].sort(),
    );
  });

  it('replaces threshold wholesale when overridden (scalar replace)', () => {
    const config = makeConfig([
      { name: 'core', srcDir: './src', lastScore: 5, threshold: -5 },
    ]);
    const [effective] = resolveProjects(config);
    expect(effective?.threshold).toBe(-5);
  });

  it('deep-merges a single baseline override, preserving the other four', () => {
    const config = makeConfig([
      {
        name: 'cli',
        srcDir: './apps/cli',
        lastScore: 6,
        baselines: {
          complexity: { good: 8, bad: 25, direction: 'lower-better' },
        },
      },
    ]);
    const [effective] = resolveProjects(config);
    // Overridden metric wins.
    expect(effective?.baselines.complexity).toEqual({
      good: 8,
      bad: 25,
      direction: 'lower-better',
    });
    // The other four survive from the shared defaults.
    expect(effective?.baselines.locPerModule).toEqual(config.baselines.locPerModule);
    expect(effective?.baselines.depDepth).toEqual(config.baselines.depDepth);
    expect(effective?.baselines.circularDeps).toEqual(config.baselines.circularDeps);
    expect(effective?.baselines.fanInOut).toEqual(config.baselines.fanInOut);
  });

  it('deep-merges a single weight override, preserving the other four', () => {
    const config = makeConfig([
      {
        name: 'cli',
        srcDir: './apps/cli',
        lastScore: 6,
        weights: {
          ts: {
            locPerModule: 5,
            depDepth: 1,
            circularDeps: 1,
            complexity: 1,
            fanInOut: 1,
          },
        },
      },
    ]);
    const [effective] = resolveProjects(config);
    expect(effective?.weights.ts.locPerModule).toBe(5);
    expect(effective?.weights.ts.depDepth).toBe(1);
    expect(effective?.weights.ts.fanInOut).toBe(1);
  });

  it('does not mutate the shared defaults across projects', () => {
    const config = makeConfig([
      {
        name: 'a',
        srcDir: './a',
        lastScore: 1,
        baselines: { complexity: { good: 99, bad: 100, direction: 'lower-better' } },
      },
      { name: 'b', srcDir: './b', lastScore: 2 },
    ]);
    const [, second] = resolveProjects(config);
    // Project b inherited the untouched shared complexity baseline.
    expect(second?.baselines.complexity).toEqual(config.baselines.complexity);
  });
});
