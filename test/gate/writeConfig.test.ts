import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as fs from 'node:fs';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Controllable rename: when `renameShouldThrow` is set, renameSync throws so the
// atomicity guarantee (original intact, no .tmp left) can be exercised. All other
// fs calls delegate to the real implementation.
const control: { renameShouldThrow: boolean } = { renameShouldThrow: false };

vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof fs>();
  return {
    ...actual,
    renameSync: (from: string, to: string): void => {
      if (control.renameShouldThrow) {
        throw new Error('injected rename failure');
      }
      actual.renameSync(from, to);
    },
  };
});

// Imported after the mock is registered so the writer binds the mocked renameSync.
const { writeLastScore, writeLastScores } = await import('../../src/gate/writeConfig.js');

/** A fully-populated config with weights + baselines, 2-space indent + newline. */
function sampleConfig(): string {
  const obj = {
    language: 'ts',
    srcDir: './src',
    lastScore: 0,
    threshold: -2,
    weights: {
      ts: {
        locPerModule: 0.2,
        depDepth: 0.2,
        circularDeps: 0.2,
        complexity: 0.2,
        fanInOut: 0.2,
      },
    },
    baselines: {
      locPerModule: { good: 50, bad: 150, direction: 'lower-better' },
    },
  };
  return `${JSON.stringify(obj, null, 2)}\n`;
}

let dir: string;
let cfgPath: string;

beforeEach(() => {
  control.renameShouldThrow = false;
  dir = mkdtempSync(join(tmpdir(), 'ciha-gate-'));
  cfgPath = join(dir, 'ci-health-audit.config.json');
  writeFileSync(cfgPath, sampleConfig(), 'utf8');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('writeLastScore (TC-002)', () => {
  it('updates only lastScore, preserving key order, indent, and trailing newline', () => {
    writeLastScore(cfgPath, 7.4);
    const after = readFileSync(cfgPath, 'utf8');

    // Only lastScore changed vs a hand-computed expected string.
    const expected = sampleConfig().replace('"lastScore": 0', '"lastScore": 7.4');
    expect(after).toBe(expected);
    expect(after.endsWith('\n')).toBe(true);
    expect(after).toContain('  "language": "ts"'); // 2-space indent preserved
  });

  it('rounds newScore to one decimal before writing', () => {
    writeLastScore(cfgPath, 7.4499);
    const parsed = JSON.parse(readFileSync(cfgPath, 'utf8')) as { lastScore: number };
    expect(parsed.lastScore).toBe(7.4);
  });

  it('is atomic: a failing rename leaves the original intact and no .tmp remains', () => {
    const before = readFileSync(cfgPath, 'utf8');
    control.renameShouldThrow = true;

    expect(() => { writeLastScore(cfgPath, 9.9); }).toThrow('injected rename failure');

    expect(readFileSync(cfgPath, 'utf8')).toBe(before);
    expect(existsSync(`${cfgPath}.tmp`)).toBe(false);
  });

  it('throws when the config is not a JSON object', () => {
    writeFileSync(cfgPath, '[1, 2, 3]\n', 'utf8');
    expect(() => { writeLastScore(cfgPath, 5); }).toThrow(/not a JSON object/);
  });
});

/** A multi-project config (v0.2.0 shape), 2-space indent + trailing newline. */
function projectsConfig(): string {
  const obj = {
    language: 'ts',
    threshold: -2,
    weights: {
      ts: {
        locPerModule: 0.2,
        depDepth: 0.2,
        circularDeps: 0.2,
        complexity: 0.2,
        fanInOut: 0.2,
      },
    },
    baselines: {
      locPerModule: { good: 50, bad: 150, direction: 'lower-better' },
    },
    projects: [
      { name: 'core', srcDir: './packages/core', lastScore: 0 },
      { name: 'cli', srcDir: './apps/cli', lastScore: 0 },
    ],
  };
  return `${JSON.stringify(obj, null, 2)}\n`;
}

describe('writeLastScores (CIHA-T-0017)', () => {
  beforeEach(() => {
    writeFileSync(cfgPath, projectsConfig(), 'utf8');
  });

  it('updates every matched project rounded to one decimal, changing only the numbers', () => {
    writeLastScores(cfgPath, new Map([['core', 7.4499], ['cli', 6.05]]));
    const after = readFileSync(cfgPath, 'utf8');

    const expected = projectsConfig()
      .replace('"name": "core",\n      "srcDir": "./packages/core",\n      "lastScore": 0', '"name": "core",\n      "srcDir": "./packages/core",\n      "lastScore": 7.4')
      .replace('"name": "cli",\n      "srcDir": "./apps/cli",\n      "lastScore": 0', '"name": "cli",\n      "srcDir": "./apps/cli",\n      "lastScore": 6.1');
    expect(after).toBe(expected);
    expect(after.endsWith('\n')).toBe(true);
    expect(after).toContain('  "language": "ts"'); // 2-space indent preserved
  });

  it('updates only the named subset, leaving others untouched', () => {
    writeLastScores(cfgPath, new Map([['cli', 5.5]]));
    const parsed = JSON.parse(readFileSync(cfgPath, 'utf8')) as {
      projects: { name: string; lastScore: number }[];
    };
    expect(parsed.projects[0]).toMatchObject({ name: 'core', lastScore: 0 });
    expect(parsed.projects[1]).toMatchObject({ name: 'cli', lastScore: 5.5 });
  });

  it('skips malformed (null / nameless) project entries and matches valid ones', () => {
    const malformed = `${JSON.stringify(
      {
        language: 'ts',
        projects: [null, { srcDir: './x' }, { name: 'core', srcDir: './packages/core', lastScore: 0 }],
      },
      null,
      2,
    )}\n`;
    writeFileSync(cfgPath, malformed, 'utf8');
    writeLastScores(cfgPath, new Map([['core', 4.2]]));
    const parsed = JSON.parse(readFileSync(cfgPath, 'utf8')) as {
      projects: ({ name?: string; lastScore?: number } | null)[];
    };
    expect(parsed.projects[2]).toMatchObject({ name: 'core', lastScore: 4.2 });
  });

  it('throws when a requested name has no matching project', () => {
    expect(() => {
      writeLastScores(cfgPath, new Map([['nope', 5]]));
    }).toThrow(/No project named "nope"/);
  });

  it('throws when the config has no projects array', () => {
    writeFileSync(cfgPath, sampleConfig(), 'utf8');
    expect(() => {
      writeLastScores(cfgPath, new Map([['core', 5]]));
    }).toThrow(/no "projects" array/);
  });

  it('throws when the config is not a JSON object', () => {
    writeFileSync(cfgPath, '[1, 2, 3]\n', 'utf8');
    expect(() => {
      writeLastScores(cfgPath, new Map([['core', 5]]));
    }).toThrow(/not a JSON object/);
  });

  it('is atomic: a failing rename leaves the original intact and no .tmp remains', () => {
    const before = readFileSync(cfgPath, 'utf8');
    control.renameShouldThrow = true;

    expect(() => {
      writeLastScores(cfgPath, new Map([['core', 9.9], ['cli', 8.8]]));
    }).toThrow('injected rename failure');

    expect(readFileSync(cfgPath, 'utf8')).toBe(before);
    expect(existsSync(`${cfgPath}.tmp`)).toBe(false);
  });
});
