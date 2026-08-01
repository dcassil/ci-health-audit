import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  configFileSchema,
  type ConfigFile,
} from '../src/config/schema.js';
import { loadConfig } from '../src/config/loadConfig.js';

/** A minimal, fully-specified valid raw config file (single project). */
function fullRawConfig(): Record<string, unknown> {
  return {
    language: 'ts',
    threshold: -1,
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
    projects: [{ name: 'core', srcDir: './lib', lastScore: 7.5 }],
  };
}

/** A full valid config with two projects. */
function twoProjectConfig(): Record<string, unknown> {
  const full = fullRawConfig();
  full['projects'] = [
    { name: 'core', srcDir: './packages/core', lastScore: 7.4 },
    { name: 'cli', srcDir: './apps/cli', lastScore: 6.1 },
  ];
  return full;
}

describe('config schema & loader', () => {
  it('round-trips a fully-specified valid config', () => {
    const raw = fullRawConfig();
    const config = loadConfig(raw);
    expect(config).toEqual(raw as unknown as ConfigFile);
  });

  it('applies the shared threshold default (-2) when omitted', () => {
    const raw = fullRawConfig();
    delete raw['threshold'];
    const config = loadConfig(raw);
    expect(config.threshold).toBe(-2);
  });

  it('DEFAULT_CONFIG carries the shared defaults (equal weights + ported baselines)', () => {
    expect(DEFAULT_CONFIG.threshold).toBe(-2);
    const w = DEFAULT_CONFIG.weights.ts;
    expect(new Set(Object.values(w))).toEqual(new Set([1]));
    expect(DEFAULT_CONFIG.baselines).toEqual({
      locPerModule: { good: 50, bad: 150, direction: 'lower-better' },
      depDepth: { good: 5, bad: 20, direction: 'lower-better' },
      circularDeps: { good: 0, bad: 3, direction: 'lower-better' },
      complexity: { good: 5, bad: 20, direction: 'lower-better' },
      fanInOut: { good: 6, bad: 30, direction: 'lower-better' },
    });
  });

  it('accepts a valid two-project config', () => {
    expect(() => configFileSchema.parse(twoProjectConfig())).not.toThrow();
    const config = loadConfig(twoProjectConfig());
    expect(config.projects.map((p) => p.name)).toEqual(['core', 'cli']);
  });

  it('rejects a wrong language literal', () => {
    const raw = fullRawConfig();
    raw['language'] = 'py';
    expect(() => loadConfig(raw)).toThrow(/Invalid ci-health-audit config/);
  });

  it('rejects an unknown top-level key (strict schema)', () => {
    const raw = fullRawConfig();
    raw['bogus'] = true;
    expect(() => loadConfig(raw)).toThrow(/Invalid ci-health-audit config/);
  });

  it('rejects an empty projects array', () => {
    const raw = fullRawConfig();
    raw['projects'] = [];
    expect(() => loadConfig(raw)).toThrow(/at least one project/);
  });

  it('rejects duplicate project names', () => {
    const raw = fullRawConfig();
    raw['projects'] = [
      { name: 'dup', srcDir: './a', lastScore: 1 },
      { name: 'dup', srcDir: './b', lastScore: 2 },
    ];
    expect(() => loadConfig(raw)).toThrow(/duplicate project name/);
  });

  it('rejects an empty project name', () => {
    const raw = fullRawConfig();
    raw['projects'] = [{ name: '', srcDir: './a', lastScore: 1 }];
    expect(() => loadConfig(raw)).toThrow(/non-empty/);
  });

  it('rejects a project missing srcDir', () => {
    const raw = fullRawConfig();
    raw['projects'] = [{ name: 'core', lastScore: 1 }];
    expect(() => loadConfig(raw)).toThrow(/srcDir/);
  });

  it('rejects an empty srcDir', () => {
    const raw = fullRawConfig();
    raw['projects'] = [{ name: 'core', srcDir: '', lastScore: 1 }];
    expect(() => loadConfig(raw)).toThrow(/srcDir/);
  });

  it('rejects a project lastScore out of the 0-10 range', () => {
    const raw = fullRawConfig();
    raw['projects'] = [{ name: 'core', srcDir: './a', lastScore: 42 }];
    expect(() => loadConfig(raw)).toThrow(/lastScore/);
  });

  it('rejects an unknown per-project key (strict schema)', () => {
    const raw = fullRawConfig();
    raw['projects'] = [{ name: 'core', srcDir: './a', lastScore: 1, bogus: 1 }];
    expect(() => loadConfig(raw)).toThrow(/Invalid ci-health-audit config/);
  });

  it('rejects a missing baselines block', () => {
    const raw = fullRawConfig();
    delete raw['baselines'];
    expect(() => loadConfig(raw)).toThrow(/baselines/);
  });

  it('rejects a bad baseline direction enum', () => {
    const raw = fullRawConfig();
    (raw['baselines'] as Record<string, unknown>)['depDepth'] = {
      good: 5,
      bad: 20,
      direction: 'sideways',
    };
    expect(() => loadConfig(raw)).toThrow(/direction/);
  });

  it('rejects a non-object input', () => {
    expect(() => loadConfig(null)).toThrow(/Invalid ci-health-audit config/);
    expect(() => loadConfig('nope')).toThrow(/Invalid ci-health-audit config/);
  });

  describe('legacy-config migration error', () => {
    it('rejects a flat config with top-level srcDir and no projects', () => {
      const raw = fullRawConfig();
      delete raw['projects'];
      raw['srcDir'] = './src';
      expect(() => loadConfig(raw)).toThrow(/v0\.2\.0/);
      expect(() => loadConfig(raw)).toThrow(/projects/);
    });

    it('rejects a flat config with top-level lastScore and no projects', () => {
      const raw = fullRawConfig();
      delete raw['projects'];
      raw['lastScore'] = 0;
      expect(() => loadConfig(raw)).toThrow(/ciha init/);
    });

    it('does not trigger the migration error when projects is present', () => {
      // srcDir/lastScore alongside projects is a strict-schema error, not the
      // migration error (projects present ⇒ not the legacy flat shape).
      const raw = fullRawConfig();
      raw['srcDir'] = './src';
      expect(() => loadConfig(raw)).toThrow(/Invalid ci-health-audit config/);
    });
  });
});
