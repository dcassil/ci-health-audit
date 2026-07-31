/**
 * CLI `scan` / `gate` handler tests (CIHA-T-0010, TC-001 + TC-002 --json).
 *
 * Drives the dispatcher {@link run} with an injected fake engine `scan` (never
 * shells out to scc/depcruise) and a temp-dir config, asserting the exit-code
 * contract (0 report/PASS, 1 gate FAIL, 2 config error), the report/JSON shapes,
 * and the config write-back side-effects (report never writes; gate PASS writes
 * lastScore; gate FAIL leaves config untouched).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, type Config, type ScanResult } from '../../src/index.js';
import { run } from '../../src/cli/program.js';

interface Captured {
  out: string[];
  err: string[];
}
function makeWriter(): { writer: { out(l: string): void; err(l: string): void }; captured: Captured } {
  const captured: Captured = { out: [], err: [] };
  return {
    captured,
    writer: {
      out: (l): void => void captured.out.push(l),
      err: (l): void => void captured.err.push(l),
    },
  };
}

function fakeScan(score: number): (config: Config) => Promise<ScanResult> {
  return (): Promise<ScanResult> =>
    Promise.resolve({
      score,
      breakdown: [
        { metric: 'locPerModule', rawP75: 40, subScore: 8.1, weight: 1 },
        { metric: 'depDepth', rawP75: 7, subScore: 6.9, weight: 1 },
        { metric: 'circularDeps', rawP75: 0, subScore: 10, weight: 1 },
        { metric: 'complexity', rawP75: 9, subScore: 6.2, weight: 1 },
        { metric: 'fanInOut', rawP75: 12, subScore: 5.9, weight: 1 },
      ],
    });
}

function writeConfig(path: string, overrides: Partial<Config> = {}): void {
  const cfg = { ...DEFAULT_CONFIG, ...overrides };
  writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`);
}

describe('cli scan / gate', () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ciha-scan-'));
    configPath = join(dir, 'ci-health-audit.config.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('scan: prints score + breakdown, exit 0, config unchanged', async () => {
    writeConfig(configPath, { lastScore: 5 });
    const before = readFileSync(configPath, 'utf8');
    const { writer, captured } = makeWriter();

    const code = await run(['scan', '--config', configPath], { writer, scan: fakeScan(7.4) });

    expect(code).toBe(0);
    const out = captured.out.join('\n');
    expect(out).toContain('health score: 7.4 / 10');
    expect(out).toContain('LOC / module');
    expect(readFileSync(configPath, 'utf8')).toBe(before); // never mutated
  });

  it('scan --json: emits { score, breakdown } with no gate key', async () => {
    writeConfig(configPath);
    const { writer, captured } = makeWriter();

    const code = await run(['scan', '--json', '--config', configPath], { writer, scan: fakeScan(7.4) });

    expect(code).toBe(0);
    const parsed = JSON.parse(captured.out.join('')) as Record<string, unknown>;
    expect(parsed['score']).toBe(7.4);
    expect(parsed).not.toHaveProperty('gate');
    expect(parsed['breakdown']).toMatchObject({ locPerModule: 8.1, circularDeps: 10 });
  });

  it('gate FAIL: score below floor → exit 1, stderr FAIL, config unchanged', async () => {
    writeConfig(configPath, { lastScore: 7.4, threshold: -2 }); // floor 5.4
    const before = readFileSync(configPath, 'utf8');
    const { writer, captured } = makeWriter();

    const code = await run(['gate', '--config', configPath], { writer, scan: fakeScan(3.0) });

    expect(code).toBe(1);
    expect(captured.err.join('\n')).toContain('FAIL');
    expect(readFileSync(configPath, 'utf8')).toBe(before); // no write on FAIL
  });

  it('gate PASS (within threshold): exit 0, lastScore updated', async () => {
    writeConfig(configPath, { lastScore: 7.4, threshold: -2 }); // floor 5.4
    const { writer, captured } = makeWriter();

    const code = await run(['gate', '--config', configPath], { writer, scan: fakeScan(7.1) });

    expect(code).toBe(0);
    expect(captured.out.join('\n')).toContain('PASS');
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    expect(parsed['lastScore']).toBe(7.1); // persisted
  });

  it('gate seeding (lastScore 0): always PASS + writes true score, exit 0', async () => {
    writeConfig(configPath, { lastScore: 0 });
    const { writer } = makeWriter();

    const code = await run(['gate', '--config', configPath], { writer, scan: fakeScan(2.5) });

    expect(code).toBe(0);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    expect(parsed['lastScore']).toBe(2.5);
  });

  it('scan --gate behaves like gate (shared impl): FAIL → exit 1', async () => {
    writeConfig(configPath, { lastScore: 7.4, threshold: -2 });
    const before = readFileSync(configPath, 'utf8');
    const { writer } = makeWriter();

    const code = await run(['scan', '--gate', '--config', configPath], { writer, scan: fakeScan(1.0) });

    expect(code).toBe(1);
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  });

  it('gate --json: includes gate key with decision/floor/lastScore/threshold', async () => {
    writeConfig(configPath, { lastScore: 7.4, threshold: -2 });
    const { writer, captured } = makeWriter();

    const code = await run(['gate', '--json', '--config', configPath], { writer, scan: fakeScan(7.1) });

    expect(code).toBe(0);
    const parsed = JSON.parse(captured.out.join('')) as { gate?: Record<string, unknown> };
    expect(parsed.gate).toMatchObject({ decision: 'pass', floor: 5.4, lastScore: 7.4, threshold: -2 });
  });

  it('missing config → exit 2, message names the file, no crash', async () => {
    const { writer, captured } = makeWriter();
    const code = await run(['scan', '--config', configPath], { writer, scan: fakeScan(7.4) });

    expect(code).toBe(2);
    expect(captured.err.join('\n')).toContain(configPath);
  });

  it('schema-invalid config → exit 2, names the file', async () => {
    writeFileSync(configPath, '{"language":"python"}\n');
    const { writer, captured } = makeWriter();
    const code = await run(['scan', '--config', configPath], { writer, scan: fakeScan(7.4) });

    expect(code).toBe(2);
    expect(captured.err.join('\n')).toContain(configPath);
  });

  it('unknown command → exit 2', async () => {
    const { writer } = makeWriter();
    const code = await run(['frobnicate'], { writer, scan: fakeScan(7.4) });
    expect(code).toBe(2);
  });
});
