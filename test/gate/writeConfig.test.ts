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
const { writeLastScore } = await import('../../src/gate/writeConfig.js');

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
