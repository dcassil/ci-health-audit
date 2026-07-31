import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, configSchema, type Config } from '../src/config/schema.js';
import { loadConfig } from '../src/config/loadConfig.js';

/** A minimal, fully-specified valid raw config (no reliance on defaults). */
function fullRawConfig(): Record<string, unknown> {
  return {
    language: 'ts',
    srcDir: './lib',
    lastScore: 7.5,
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
  };
}

/** A valid raw config that omits the defaulted fields. */
function minimalRawConfig(): Record<string, unknown> {
  const full = fullRawConfig();
  delete full['srcDir'];
  delete full['lastScore'];
  delete full['threshold'];
  return full;
}

describe('config schema & loader', () => {
  it('round-trips a fully-specified valid config', () => {
    const raw = fullRawConfig();
    const config = loadConfig(raw);
    expect(config).toEqual(raw as unknown as Config);
  });

  it('applies defaults (srcDir, lastScore=0, threshold=-2)', () => {
    const config = loadConfig(minimalRawConfig());
    expect(config.srcDir).toBe('./src');
    expect(config.lastScore).toBe(0);
    expect(config.threshold).toBe(-2);
  });

  it('DEFAULT_CONFIG is valid and equal-weighted with the ported baselines', () => {
    // Parses cleanly through the schema.
    expect(() => configSchema.parse(DEFAULT_CONFIG)).not.toThrow();
    expect(loadConfig(DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);

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

  it('rejects a wrong language literal', () => {
    const raw = fullRawConfig();
    raw['language'] = 'py';
    expect(() => loadConfig(raw)).toThrow(/Invalid ci-health-audit config/);
  });

  it('rejects lastScore out of the 0-10 range', () => {
    const raw = fullRawConfig();
    raw['lastScore'] = 42;
    expect(() => loadConfig(raw)).toThrow(/lastScore/);
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
});
