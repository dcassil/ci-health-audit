/**
 * End-to-end integration test (CIHA-I-0001, Phase 8 / CIHA-T-0008).
 *
 * Runs the REAL `TsToolPlugin` (real `scc` + real `dependency-cruiser`) via
 * `scan()` against the committed `fixture-repo/` and asserts the overall score
 * and per-metric raw p75s against pinned expected values. This is the exit-gate
 * proof that the whole pipeline (plugin → graph → metrics → scorer) produces a
 * stable, reproducible 0–10 score on a real JS/TS repo.
 *
 * Guarded: if `scc` or `depcruise` are not on PATH the whole suite is `skip`ped
 * (never failed) with a clear message, so contributors without the binaries
 * still pass the unit suite. CI installs both, so it runs there.
 *
 * Pinned tool versions (record on any snapshot regeneration — NFR-001):
 *   - scc 3.6.0
 *   - dependency-cruiser 16.10.4 (pinned in package.json)
 *
 * The fixture is deliberately structured (test/integration/fixture-repo/src/lib):
 *   - a.ts <-> b.ts : a 2-module import cycle (drives circularDeps).
 *   - chain1 -> chain2 -> chain3 -> chain4 : a deep import chain (drives depDepth).
 *   - hub.ts : imported by a, b, chain1, chain4 (raises fan-in coupling).
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scan, DEFAULT_CONFIG, type Config } from '../../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureSrc = join(here, 'fixture-repo', 'src');

/** Probe whether a binary is runnable; returns false on any failure. */
function hasBinary(probe: string): boolean {
  try {
    execSync(probe, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const toolsAvailable = hasBinary('scc --version') && hasBinary('depcruise --version');

const describeOrSkip = toolsAvailable ? describe : describe.skip;

if (!toolsAvailable) {
  console.warn(
    '[integration/scan] SKIPPED: `scc` and/or `depcruise` not found on PATH. ' +
      'Install both to run the real end-to-end scan (CI installs them).',
  );
}

const config: Config = { ...DEFAULT_CONFIG, srcDir: fixtureSrc };

describeOrSkip('scan() end-to-end against fixture-repo (real scc + depcruise)', () => {
  it('produces the pinned overall score within tolerance', async () => {
    const result = await scan(config);
    // Pinned expected overall score for the fixture (scc 3.6.0 / depcruise 16.10.4).
    expect(result.score).toBeCloseTo(8.67, 2);
  });

  it('produces the pinned per-metric raw p75 breakdown', async () => {
    const result = await scan(config);
    const raw = Object.fromEntries(
      result.breakdown.map((b) => [b.metric, b.rawP75]),
    );
    // Deliberate structure: a real cycle, a deep chain, a hub. Pinned values.
    expect(raw).toEqual({
      locPerModule: 5,
      depDepth: 3.5,
      circularDeps: 2,
      complexity: 1,
      fanInOut: 3,
    });
  });

  it('works with a RELATIVE srcDir and yields the same structural result', async () => {
    // Regression: a relative srcDir (like the documented default "./src") must
    // not become srcDir/srcDir. Build a path relative to process.cwd() pointing
    // at the fixture and assert the score/breakdown match the absolute run.
    const relSrc = relative(process.cwd(), fixtureSrc);
    expect(relSrc.startsWith('/')).toBe(false); // sanity: it is relative
    const result = await scan({ ...DEFAULT_CONFIG, srcDir: relSrc });

    // Non-degenerate: node identities matched, so real metrics attached.
    const raw = Object.fromEntries(
      result.breakdown.map((b) => [b.metric, b.rawP75]),
    );
    expect(raw['circularDeps']).toBeGreaterThan(0); // cycle detected
    expect(raw['depDepth']).toBeGreaterThan(0); // deep chain measured
    expect(raw['locPerModule']).toBeGreaterThan(0); // scc LOC attached to nodes
    // Identical structural breakdown + score to the absolute-srcDir run.
    expect(raw).toEqual({
      locPerModule: 5,
      depDepth: 3.5,
      circularDeps: 2,
      complexity: 1,
      fanInOut: 3,
    });
    expect(result.score).toBeCloseTo(8.67, 2);
  });

  it('is deterministic across repeated scans (NFR-001)', async () => {
    const first = await scan(config);
    const second = await scan(config);
    expect(second).toEqual(first);
  });

  it('does not throw and yields a degenerate result on an empty srcDir (NFR-005)', async () => {
    const emptyDir = join(here, 'fixture-repo', 'empty-src');
    const result = await scan({ ...DEFAULT_CONFIG, srcDir: emptyDir });
    // No files → all five metrics collapse to 0 → each maps to a perfect 10.
    expect(result.breakdown.map((b) => b.rawP75)).toEqual([0, 0, 0, 0, 0]);
    expect(result.score).toBe(10);
  });
});
