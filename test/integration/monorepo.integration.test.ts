/**
 * End-to-end monorepo CLI integration tests (CIHA-I-0003, Phase 7 / CIHA-T-0021).
 *
 * Spawns the REAL built `dist/cli/main.js` as a child process against a committed
 * two-project fixture monorepo (`packages/a`, `apps/b`) with the real
 * `scc` + `dependency-cruiser` pipeline, asserting the per-project report, the
 * mean headline, the `--json` shape, and gate exit codes / write-back behavior.
 *
 * Skip guards (mirror `cli.integration.test.ts`):
 *   - `scc` and/or `depcruise` not on PATH → entire suite is `.skip`ped.
 *   - `dist/cli/main.js` not built → entire suite is `.skip`ped.
 *
 * Each test copies the fixture monorepo + its config into a fresh temp dir so no
 * test mutates committed files, and runs the CLI with cwd = that temp dir so the
 * relative per-project `srcDir`s (`./packages/a/src`, `./apps/b/src`) resolve.
 *
 * Fixture overview (deterministic; pinned scc 3.6.0 / depcruise 16.10.x):
 *   packages/a/src — healthy, acyclic (utils <- math)          → score 10.0
 *   apps/b/src     — deliberate alpha <-> beta import cycle     → score 8.67
 *   mean = round((10.0 + 8.67) / 2, 2)                          → 9.34
 *
 * Test matrix (TC = task acceptance criteria CIHA-T-0021):
 *   TC-001  scan: exit 0, BOTH project blocks + mean headline, config untouched
 *   TC-001b scan --json: exit 0, projects[] length 2, numeric scores, mean == avg
 *   TC-002  gate all-pass: exit 0, every project's lastScore written back
 *   TC-003  gate one-regressed: exit 1, failing project named on stderr, no writes
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const cliBin = join(root, 'dist', 'cli', 'main.js');
const fixtureMonorepo = join(root, 'test', 'fixtures', 'sample-monorepo');

/** Probe whether a binary is runnable. */
function hasBinary(probe: string): boolean {
  const r = spawnSync(probe, { shell: true, stdio: 'ignore' });
  return r.status === 0;
}

const binExists = existsSync(cliBin);
const toolsAvailable = hasBinary('scc --version') && hasBinary('depcruise --version');
const canRun = binExists && toolsAvailable;

if (!binExists) {
  console.warn(
    '[integration/monorepo] SKIPPED: dist/cli/main.js not found. Run `npm run build` first.',
  );
} else if (!toolsAvailable) {
  console.warn(
    '[integration/monorepo] SKIPPED: `scc` and/or `depcruise` not found on PATH. ' +
      'Install both to run the real end-to-end monorepo CLI tests.',
  );
}

/** Run the CLI via node and return { status, stdout, stderr }. Never throws. */
function runCli(
  args: string[],
  options: { cwd?: string } = {},
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cliBin, ...args], {
    encoding: 'utf8',
    cwd: options.cwd ?? root,
    timeout: 120_000,
  });
  const status: number = result.status ?? 1;
  const stdout: string = result.stdout;
  const stderr: string = result.stderr;
  return { status, stdout, stderr };
}

interface ScanJson {
  score: number;
  projects: { name: string; score: number; breakdown: Record<string, number> }[];
}

interface ConfigProjects {
  projects: { name: string; lastScore: number; threshold?: number }[];
}

const describeOrSkip = canRun ? describe : describe.skip;

describeOrSkip('monorepo CLI end-to-end integration', () => {
  let tmpDir: string;
  let repoDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ciha-monorepo-e2e-'));
    repoDir = join(tmpDir, 'repo');
    cpSync(fixtureMonorepo, repoDir, { recursive: true });
    configPath = join(repoDir, 'ci-health-audit.config.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // TC-001: scan report — both project blocks + mean headline
  // -------------------------------------------------------------------------

  it('TC-001: scan prints BOTH project blocks and the mean headline, config untouched', () => {
    const before = readFileSync(configPath, 'utf8');
    const { status, stdout } = runCli(['scan', '--config', configPath], { cwd: repoDir });

    expect(status).toBe(0);
    // Both project blocks present, each with its own health score line.
    expect(stdout).toMatch(/^a — health score: \d+\.\d+ \/ 10/m);
    expect(stdout).toMatch(/^b — health score: \d+\.\d+ \/ 10/m);
    // The mean headline line.
    expect(stdout).toMatch(/mean health score: \d+\.\d+ \/ 10/);
    // Report mode NEVER writes the config.
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  });

  it('TC-001b: scan --json emits a projects[] of length 2 with a mean top-level score', () => {
    const { status, stdout } = runCli(['scan', '--json', '--config', configPath], {
      cwd: repoDir,
    });

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as ScanJson;

    expect(Array.isArray(parsed.projects)).toBe(true);
    expect(parsed.projects).toHaveLength(2);

    const byName = new Map(parsed.projects.map((p) => [p.name, p]));
    const a = byName.get('a');
    const b = byName.get('b');
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(typeof a?.score).toBe('number');
    expect(typeof b?.score).toBe('number');
    expect(a?.breakdown).toBeDefined();
    expect(b?.breakdown).toBeDefined();

    // Top-level score is the rounded arithmetic mean of the per-project scores.
    const expectedMean =
      Math.round(((a?.score ?? 0) + (b?.score ?? 0)) / 2 * 100) / 100;
    expect(typeof parsed.score).toBe('number');
    expect(parsed.score).toBe(expectedMean);

    // Pinned deterministic values for this fixture (scc 3.6.0 / depcruise 16.10.x):
    //   a (acyclic) = 10.0 ; b (alpha<->beta cycle) = 8.67 ; mean = 9.34.
    expect(a?.score).toBe(10);
    expect(b?.score).toBe(8.67);
    expect(parsed.score).toBe(9.34);
  });

  // -------------------------------------------------------------------------
  // TC-002: gate all-pass — writes every project's lastScore
  // -------------------------------------------------------------------------

  it('TC-002: gate all-pass exits 0 and writes back every project lastScore', () => {
    // Both projects seeded at lastScore 0 → first run seeds and passes.
    const before = JSON.parse(readFileSync(configPath, 'utf8')) as ConfigProjects;
    expect(before.projects.every((p) => p.lastScore === 0)).toBe(true);

    const { status, stdout } = runCli(['gate', '--config', configPath], { cwd: repoDir });

    expect(status).toBe(0);
    expect(stdout).toContain('PASS');

    const after = JSON.parse(readFileSync(configPath, 'utf8')) as ConfigProjects;
    const afterByName = new Map(after.projects.map((p) => [p.name, p.lastScore]));
    // Every project's lastScore is written back to its measured score.
    expect(afterByName.get('a')).toBe(10);
    expect(afterByName.get('b')).toBe(8.7); // 8.67 rounded to one decimal on write-back
    // No project left at the seed value.
    expect(after.projects.every((p) => p.lastScore > 0)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // TC-003: gate one-regressed — fails, names project, writes nothing
  // -------------------------------------------------------------------------

  it('TC-003: gate one regressed project exits 1, names it on stderr, leaves config untouched', () => {
    // Seed project `b` above its own floor: lastScore 10 with threshold -1 → floor 9.0.
    // `b`'s real score (8.67) < 9.0 → FAIL. `a` stays at lastScore 0 → seeds & passes.
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as ConfigProjects;
    const projB = parsed.projects.find((p) => p.name === 'b');
    if (projB === undefined) {
      throw new Error('fixture must declare project "b"');
    }
    projB.lastScore = 10;
    projB.threshold = -1;
    const artificialConfig = `${JSON.stringify(parsed, null, 2)}\n`;
    writeFileSync(configPath, artificialConfig);
    const before = readFileSync(configPath, 'utf8');

    const { status, stderr } = runCli(['gate', '--config', configPath], { cwd: repoDir });

    expect(status).toBe(1);
    expect(stderr).toContain('FAIL');
    // The FAIL output names the regressed project `b`.
    expect(stderr).toMatch(/^ {2}b — score /m);
    // No write on FAIL — config byte-identical for EVERY project.
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  });
});
