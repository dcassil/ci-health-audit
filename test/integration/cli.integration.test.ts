/**
 * End-to-end CLI integration tests (CIHA-T-0011).
 *
 * Spawns the REAL built `dist/cli/main.js` as a child process against committed
 * fixture source trees, asserting exit codes, stdout/stderr content, and
 * config write-back side-effects.
 *
 * Skip guards:
 *   - `scc` and/or `depcruise` not on PATH → entire suite is `.skip`ped.
 *   - `dist/cli/main.js` not built → entire suite is `.skip`ped.
 *
 * Each test copies the fixture + its config into a fresh temp dir so no test
 * mutates committed files.
 *
 * Fixture overview:
 *   test/fixtures/sample-src/       — healthy, acyclic, ~4 modules; lastScore: 0
 *   test/fixtures/sample-src-worse/ — same layout + 2 deliberate import cycles;
 *                                     used to force a score regression.
 *
 * Test matrix (TC = task acceptance criteria):
 *   TC-001  scan: exit 0, prints score, config byte-identical after
 *   TC-001b scan --json: exit 0, parseable { score, breakdown }
 *   TC-002a gate first-run (lastScore 0): exit 0, writes lastScore
 *   TC-002b gate second-run at seeded score: exit 0
 *   TC-002c gate fail (worsened fixture vs seeded baseline): exit 1, no write
 *   TC-003  init: creates file; re-run without --force exits 2; --force overwrites
 *   TC-004  bad/missing config: exit 2 with message
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
const fixtureGood = join(root, 'test', 'fixtures', 'sample-src');
const fixtureWorse = join(root, 'test', 'fixtures', 'sample-src-worse');

/** Probe whether a binary is runnable. */
function hasBinary(probe: string): boolean {
  const r = spawnSync(probe, { shell: true, stdio: 'ignore' });
  return r.status === 0;
}

const binExists = existsSync(cliBin);
const toolsAvailable = hasBinary('scc --version') && hasBinary('depcruise --version');

const canRun = binExists && toolsAvailable;

if (!binExists) {
  console.warn('[integration/cli] SKIPPED: dist/cli/main.js not found. Run `npm run build` first.');
} else if (!toolsAvailable) {
  console.warn(
    '[integration/cli] SKIPPED: `scc` and/or `depcruise` not found on PATH. ' +
      'Install both to run the real end-to-end CLI tests.',
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
    timeout: 60_000,
  });
  const status: number = result.status ?? 1;
  const stdout: string = result.stdout;
  const stderr: string = result.stderr;
  return { status, stdout, stderr };
}

const describeOrSkip = canRun ? describe : describe.skip;

describeOrSkip('CLI end-to-end integration', () => {
  let tmpDir: string;
  let goodDir: string;
  let worseDir: string;
  let goodConfig: string;
  let worseConfig: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ciha-e2e-'));
    goodDir = join(tmpDir, 'good');
    worseDir = join(tmpDir, 'worse');
    cpSync(fixtureGood, goodDir, { recursive: true });
    cpSync(fixtureWorse, worseDir, { recursive: true });
    goodConfig = join(goodDir, 'ci-health-audit.config.json');
    worseConfig = join(worseDir, 'ci-health-audit.config.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // TC-001: scan report
  // -------------------------------------------------------------------------

  it('TC-001: scan exits 0, prints numeric score, leaves config untouched', () => {
    const before = readFileSync(goodConfig, 'utf8');
    const { status, stdout } = runCli(['scan', '--config', goodConfig], { cwd: goodDir });

    expect(status).toBe(0);
    expect(stdout).toMatch(/\d+\.\d+ \/ 10/);
    expect(readFileSync(goodConfig, 'utf8')).toBe(before);
  });

  it('TC-001b: scan --json exits 0 and emits parseable { score, breakdown }', () => {
    const { status, stdout } = runCli(['scan', '--json', '--config', goodConfig], { cwd: goodDir });

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as { score: unknown; breakdown: unknown };
    expect(typeof parsed.score).toBe('number');
    expect(parsed.score).toBeGreaterThan(0);
    expect(parsed.breakdown).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // TC-002a: gate first run seeds lastScore
  // -------------------------------------------------------------------------

  it('TC-002a: gate first-run (lastScore 0) exits 0 and writes lastScore', () => {
    const beforeParsed = JSON.parse(readFileSync(goodConfig, 'utf8')) as { lastScore: number };
    expect(beforeParsed.lastScore).toBe(0);

    const { status, stdout } = runCli(['gate', '--config', goodConfig], { cwd: goodDir });

    expect(status).toBe(0);
    expect(stdout).toContain('PASS');

    const afterParsed = JSON.parse(readFileSync(goodConfig, 'utf8')) as { lastScore: number };
    expect(afterParsed.lastScore).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // TC-002b: gate second-run at seeded score passes
  // -------------------------------------------------------------------------

  it('TC-002b: gate second-run at seeded baseline exits 0', () => {
    // Seed first
    const seed = runCli(['gate', '--config', goodConfig], { cwd: goodDir });
    expect(seed.status).toBe(0);

    // Run again at the same baseline
    const { status } = runCli(['gate', '--config', goodConfig], { cwd: goodDir });
    expect(status).toBe(0);
  });

  // -------------------------------------------------------------------------
  // TC-002c: gate fail on worsened fixture
  // -------------------------------------------------------------------------

  it('TC-002c: gate fails with exit 1 on worse fixture (artificially high lastScore) and leaves config untouched', () => {
    // Step 1: scan the worse fixture to measure its actual score.
    const scanResult = runCli(['scan', '--json', '--config', worseConfig], { cwd: worseDir });
    expect(scanResult.status).toBe(0);
    const { score: worseScore } = JSON.parse(scanResult.stdout) as { score: number };

    // Step 2: artificially set lastScore to force a regression.
    //   Use threshold: -1 (tighter than default) so floor = lastScore - 1.
    //   Set lastScore = worseScore + 1.5 (clamped to ≤ 10) so floor = worseScore + 0.5 > worseScore.
    //   Gate will compare worseScore < worseScore + 0.5 → FAIL.
    const artificialLastScore = Math.min(10, Math.round((worseScore + 1.5) * 100) / 100);
    const worseConfigParsed = JSON.parse(readFileSync(worseConfig, 'utf8')) as Record<string, unknown>;
    worseConfigParsed['lastScore'] = artificialLastScore;
    worseConfigParsed['threshold'] = -1;
    const artificialConfig = `${JSON.stringify(worseConfigParsed, null, 2)}\n`;
    writeFileSync(worseConfig, artificialConfig);
    const beforeWorseConfig = readFileSync(worseConfig, 'utf8');

    // Step 3: run gate — should fail because worseScore < floor (= artificialLastScore - 1).
    const { status, stderr } = runCli(['gate', '--config', worseConfig], { cwd: worseDir });

    expect(status).toBe(1);
    expect(stderr).toContain('FAIL');

    // Config must be byte-identical — no write on FAIL.
    expect(readFileSync(worseConfig, 'utf8')).toBe(beforeWorseConfig);
  });

  // -------------------------------------------------------------------------
  // TC-003: init command
  // -------------------------------------------------------------------------

  it('TC-003a: init creates config, exits 0', () => {
    const initDir = join(tmpDir, 'init-test');
    cpSync(goodDir, initDir, { recursive: true });
    // Remove the config so init can create it fresh
    const initConfig = join(initDir, 'ci-health-audit.config.json');
    rmSync(initConfig, { force: true });

    const { status, stdout } = runCli(['init', '--config', initConfig]);

    expect(status).toBe(0);
    expect(existsSync(initConfig)).toBe(true);
    expect(stdout).toContain(initConfig);

    const parsed = JSON.parse(readFileSync(initConfig, 'utf8')) as Record<string, unknown>;
    expect(parsed['language']).toBe('ts');
    expect(parsed['lastScore']).toBe(0);
  });

  it('TC-003b: init without --force exits 2 when config already exists', () => {
    const initDir = join(tmpDir, 'init-noforce');
    cpSync(goodDir, initDir, { recursive: true });
    const initConfig = join(initDir, 'ci-health-audit.config.json');
    const before = readFileSync(initConfig, 'utf8');

    const { status, stderr } = runCli(['init', '--config', initConfig]);

    expect(status).toBe(2);
    expect(readFileSync(initConfig, 'utf8')).toBe(before);
    expect(stderr).toContain('--force');
  });

  it('TC-003c: init --force overwrites existing config, exits 0', () => {
    const initDir = join(tmpDir, 'init-force');
    cpSync(goodDir, initDir, { recursive: true });
    const initConfig = join(initDir, 'ci-health-audit.config.json');
    // Write sentinel value so we can detect overwrite
    writeFileSync(initConfig, '{"language":"ts","srcDir":"./old","lastScore":99,"threshold":-99,"weights":{"ts":{"locPerModule":1,"depDepth":1,"circularDeps":1,"complexity":1,"fanInOut":1}},"baselines":{"locPerModule":{"good":50,"bad":150,"direction":"lower-better"},"depDepth":{"good":5,"bad":20,"direction":"lower-better"},"circularDeps":{"good":0,"bad":3,"direction":"lower-better"},"complexity":{"good":5,"bad":20,"direction":"lower-better"},"fanInOut":{"good":6,"bad":30,"direction":"lower-better"}}}\n');

    const { status } = runCli(['init', '--force', '--config', initConfig]);

    expect(status).toBe(0);
    const parsed = JSON.parse(readFileSync(initConfig, 'utf8')) as Record<string, unknown>;
    expect(parsed['lastScore']).toBe(0); // reset to default
    expect(parsed['srcDir']).toBe('./src'); // reset to default
  });

  // -------------------------------------------------------------------------
  // TC-004: bad / missing config → exit 2
  // -------------------------------------------------------------------------

  it('TC-004a: missing config → exit 2 with message naming the file', () => {
    const missing = join(tmpDir, 'does-not-exist.json');
    const { status, stderr } = runCli(['scan', '--config', missing]);

    expect(status).toBe(2);
    expect(stderr).toContain(missing);
  });

  it('TC-004b: schema-invalid config → exit 2 with message naming the file', () => {
    const badConfig = join(tmpDir, 'bad.json');
    writeFileSync(badConfig, '{"language":"python"}\n');
    const { status, stderr } = runCli(['scan', '--config', badConfig]);

    expect(status).toBe(2);
    expect(stderr).toContain(badConfig);
  });
});
