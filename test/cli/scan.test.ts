/**
 * CLI `scan` / `gate` handler tests (CIHA-T-0010, generalized to multi-project in
 * CIHA-I-0003 Phase 4 / CIHA-T-0018).
 *
 * Drives the dispatcher {@link run} with an injected fake multi-project engine
 * `scanProjects` (never shells out to scc/depcruise) and a temp-dir config,
 * asserting the exit-code contract (0 report/PASS, 1 gate FAIL, 2 config error),
 * the per-project report/JSON shapes, and the config write-back side-effects
 * (report never writes; gate PASS writes every project's lastScore; gate FAIL
 * leaves config untouched and names the failing project).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_CONFIG,
  type ConfigFile,
  type ProjectsResult,
  type ScanResult,
} from '../../src/index.js';
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

/** A fixed per-project breakdown; only the score varies between projects. */
function breakdown(): ScanResult['breakdown'] {
  return [
    { metric: 'locPerModule', rawP75: 40, subScore: 8.1, weight: 1 },
    { metric: 'depDepth', rawP75: 7, subScore: 6.9, weight: 1 },
    { metric: 'circularDeps', rawP75: 0, subScore: 10, weight: 1 },
    { metric: 'complexity', rawP75: 9, subScore: 6.2, weight: 1 },
    { metric: 'fanInOut', rawP75: 12, subScore: 5.9, weight: 1 },
  ];
}

/**
 * A fake `scanProjects` seam yielding one `ProjectResult` per config project, in
 * declared order, each with the score from `scoresByName` (or `0` if absent). The
 * headline `score` is the mean of the per-project scores.
 */
function fakeScanProjects(
  scoresByName: Record<string, number>,
): (config: ConfigFile) => Promise<ProjectsResult> {
  return (config): Promise<ProjectsResult> => {
    const projects = config.projects.map((p) => ({
      name: p.name,
      srcDir: p.srcDir,
      result: { score: scoresByName[p.name] ?? 0, breakdown: breakdown() },
    }));
    const sum = projects.reduce((acc, p) => acc + p.result.score, 0);
    const score = Math.round((sum / projects.length) * 100) / 100;
    return Promise.resolve({ projects, score });
  };
}

/**
 * Write a v0.2.0 (per-project) config to `path`. `projects` is a list of
 * `{ name, srcDir?, lastScore?, threshold? }`; defaults keep tests terse.
 */
interface ProjectSpec {
  name: string;
  srcDir?: string;
  lastScore?: number;
  threshold?: number;
}
function writeConfig(path: string, projects: ProjectSpec[]): void {
  const projectJson = projects.map((p) => {
    const entry: Record<string, unknown> = {
      name: p.name,
      srcDir: p.srcDir ?? './src',
      lastScore: p.lastScore ?? 0,
    };
    if (p.threshold !== undefined) {
      entry['threshold'] = p.threshold;
    }
    return entry;
  });
  const cfg = { ...DEFAULT_CONFIG, projects: projectJson };
  writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`);
}

describe('cli scan / gate (multi-project)', () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ciha-scan-'));
    configPath = join(dir, 'ci-health-audit.config.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('scan: prints a block per project + the mean line, exit 0, config unchanged', async () => {
    writeConfig(configPath, [{ name: 'core', lastScore: 5 }, { name: 'cli', lastScore: 5 }]);
    const before = readFileSync(configPath, 'utf8');
    const { writer, captured } = makeWriter();

    const code = await run(['scan', '--config', configPath], {
      writer,
      scan: fakeScanProjects({ core: 8.0, cli: 6.0 }),
    });

    expect(code).toBe(0);
    const out = captured.out.join('\n');
    expect(out).toContain('core — health score: 8.0 / 10');
    expect(out).toContain('cli — health score: 6.0 / 10');
    expect(out).toContain('mean health score: 7.0 / 10');
    expect(out).toContain('LOC / module');
    expect(readFileSync(configPath, 'utf8')).toBe(before); // never mutated
  });

  it('scan --json: emits projects array + top-level mean score, no gate key', async () => {
    writeConfig(configPath, [{ name: 'core' }, { name: 'cli' }]);
    const { writer, captured } = makeWriter();

    const code = await run(['scan', '--json', '--config', configPath], {
      writer,
      scan: fakeScanProjects({ core: 8.0, cli: 6.0 }),
    });

    expect(code).toBe(0);
    const parsed = JSON.parse(captured.out.join('')) as {
      score: number;
      projects: { name: string; score: number; breakdown: Record<string, number>; gate?: unknown }[];
    };
    expect(parsed.score).toBe(7.0);
    expect(parsed.projects.map((p) => p.name)).toEqual(['core', 'cli']);
    expect(parsed.projects[0]?.score).toBe(8.0);
    expect(parsed.projects[0]?.breakdown).toMatchObject({ locPerModule: 8.1, circularDeps: 10 });
    expect(parsed.projects[0]).not.toHaveProperty('gate');
  });

  it('gate PASS (all within threshold): exit 0, every lastScore updated', async () => {
    writeConfig(configPath, [
      { name: 'core', lastScore: 7.4, threshold: -2 },
      { name: 'cli', lastScore: 7.0, threshold: -2 },
    ]);
    const { writer, captured } = makeWriter();

    const code = await run(['gate', '--config', configPath], {
      writer,
      scan: fakeScanProjects({ core: 8.1, cli: 6.0 }),
    });

    expect(code).toBe(0);
    expect(captured.out.join('\n')).toContain('PASS');
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as {
      projects: { name: string; lastScore: number }[];
    };
    expect(parsed.projects.find((p) => p.name === 'core')?.lastScore).toBe(8.1);
    expect(parsed.projects.find((p) => p.name === 'cli')?.lastScore).toBe(6.0);
  });

  it('gate FAIL: one project regresses → exit 1, names it on stderr, NO writes', async () => {
    writeConfig(configPath, [
      { name: 'core', lastScore: 7.4, threshold: -2 },
      { name: 'cli', lastScore: 7.0, threshold: -2 }, // floor 5.0
    ]);
    const before = readFileSync(configPath, 'utf8');
    const { writer, captured } = makeWriter();

    const code = await run(['gate', '--config', configPath], {
      writer,
      scan: fakeScanProjects({ core: 8.1, cli: 4.5 }),
    });

    expect(code).toBe(1);
    const err = captured.err.join('\n');
    expect(err).toContain('FAIL');
    expect(err).toContain('cli'); // names the failing project
    expect(err).toContain('floor 5.0');
    expect(err).not.toContain('  core —'); // passing project not listed as failing
    expect(readFileSync(configPath, 'utf8')).toBe(before); // no write on FAIL
  });

  it('gate seeding (lastScore 0): always PASS + writes true scores, exit 0', async () => {
    writeConfig(configPath, [{ name: 'core', lastScore: 0 }, { name: 'cli', lastScore: 0 }]);
    const { writer } = makeWriter();

    const code = await run(['gate', '--config', configPath], {
      writer,
      scan: fakeScanProjects({ core: 2.5, cli: 3.0 }),
    });

    expect(code).toBe(0);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as {
      projects: { name: string; lastScore: number }[];
    };
    expect(parsed.projects.find((p) => p.name === 'core')?.lastScore).toBe(2.5);
    expect(parsed.projects.find((p) => p.name === 'cli')?.lastScore).toBe(3.0);
  });

  it('scan --gate behaves like gate (shared impl): FAIL → exit 1, no write', async () => {
    writeConfig(configPath, [{ name: 'core', lastScore: 7.4, threshold: -2 }]);
    const before = readFileSync(configPath, 'utf8');
    const { writer } = makeWriter();

    const code = await run(['scan', '--gate', '--config', configPath], {
      writer,
      scan: fakeScanProjects({ core: 1.0 }),
    });

    expect(code).toBe(1);
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  });

  it('gate --json: each project carries a gate object', async () => {
    writeConfig(configPath, [{ name: 'core', lastScore: 7.4, threshold: -2 }]);
    const { writer, captured } = makeWriter();

    const code = await run(['gate', '--json', '--config', configPath], {
      writer,
      scan: fakeScanProjects({ core: 7.1 }),
    });

    expect(code).toBe(0);
    const parsed = JSON.parse(captured.out.join('')) as {
      projects: { name: string; gate?: Record<string, unknown> }[];
    };
    expect(parsed.projects[0]?.gate).toMatchObject({
      decision: 'pass',
      floor: 5.4,
      lastScore: 7.4,
      threshold: -2,
    });
  });

  it('missing config → exit 2, message names the file, no crash', async () => {
    const { writer, captured } = makeWriter();
    const code = await run(['scan', '--config', configPath], {
      writer,
      scan: fakeScanProjects({}),
    });

    expect(code).toBe(2);
    expect(captured.err.join('\n')).toContain(configPath);
  });

  it('schema-invalid config → exit 2, names the file', async () => {
    writeFileSync(configPath, '{"language":"python"}\n');
    const { writer, captured } = makeWriter();
    const code = await run(['scan', '--config', configPath], {
      writer,
      scan: fakeScanProjects({}),
    });

    expect(code).toBe(2);
    expect(captured.err.join('\n')).toContain(configPath);
  });

  it('unknown command → exit 2', async () => {
    const { writer } = makeWriter();
    const code = await run(['frobnicate'], { writer, scan: fakeScanProjects({}) });
    expect(code).toBe(2);
  });
});
