import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config/schema.js';
import { scoreHigherBetter, scoreLowerBetter } from '../src/scorer/normalize.js';
import { score } from '../src/scorer/score.js';
import type { Metrics } from '../src/metrics/computeMetrics.js';

describe('scoreLowerBetter', () => {
  it('value at good → 10 (perfect)', () => {
    expect(scoreLowerBetter(50, 50, 150)).toBe(10);
  });

  it('value below good → 10 (clamped)', () => {
    expect(scoreLowerBetter(10, 50, 150)).toBe(10);
  });

  it('value at bad → 0', () => {
    expect(scoreLowerBetter(150, 50, 150)).toBe(0);
  });

  it('value above bad → 0 (clamped)', () => {
    expect(scoreLowerBetter(500, 50, 150)).toBe(0);
  });

  it('midpoint interpolates to exactly 5', () => {
    expect(scoreLowerBetter(100, 50, 150)).toBe(5);
  });

  it('quarter-point interpolates exactly', () => {
    // t = 0.25 → (1 - 0.25) * 10 = 7.5
    expect(scoreLowerBetter(75, 50, 150)).toBe(7.5);
  });

  it('bad === good guard: at/below good → 10, else 0', () => {
    expect(scoreLowerBetter(5, 5, 5)).toBe(10);
    expect(scoreLowerBetter(6, 5, 5)).toBe(0);
    expect(Number.isFinite(scoreLowerBetter(6, 5, 5))).toBe(true);
  });
});

describe('scoreHigherBetter', () => {
  it('value at good → 10', () => {
    expect(scoreHigherBetter(10, 10, 0)).toBe(10);
  });

  it('value at bad → 0', () => {
    expect(scoreHigherBetter(0, 10, 0)).toBe(0);
  });

  it('midpoint interpolates to exactly 5', () => {
    expect(scoreHigherBetter(5, 10, 0)).toBe(5);
  });

  it('clamps outside range', () => {
    expect(scoreHigherBetter(20, 10, 0)).toBe(10);
    expect(scoreHigherBetter(-5, 10, 0)).toBe(0);
  });

  it('good === bad guard: at/above good → 10, else 0', () => {
    expect(scoreHigherBetter(5, 5, 5)).toBe(10);
    expect(scoreHigherBetter(4, 5, 5)).toBe(0);
    expect(Number.isFinite(scoreHigherBetter(4, 5, 5))).toBe(true);
  });
});

/**
 * Golden fixture (hand-computed against DEFAULT_CONFIG.baselines, all lower-better):
 *   locPerModule=100  good=50  bad=150 → t=0.5  → subScore 5
 *   depDepth=5        good=5   bad=20  → t=0    → subScore 10
 *   circularDeps=3    good=0   bad=3   → t=1    → subScore 0
 *   complexity=12.5   good=5   bad=20  → t=0.5  → subScore 5
 *   fanInOut=42       good=6   bad=30  → t>1    → subScore 0
 * Equal weights (all 1): overall = mean(5,10,0,5,0) = 20/5 = 4.0
 */
const GOLDEN_METRICS: Metrics = {
  locPerModule: 100,
  depDepth: 5,
  circularDeps: 3,
  complexity: 12.5,
  fanInOut: 42,
};

describe('score (golden)', () => {
  it('produces the exact overall score and breakdown', () => {
    const result = score(
      GOLDEN_METRICS,
      DEFAULT_CONFIG.baselines,
      DEFAULT_CONFIG.weights.ts,
    );

    expect(result.score).toBe(4);
    expect(result.breakdown).toEqual([
      { metric: 'locPerModule', rawP75: 100, subScore: 5, weight: 1 },
      { metric: 'depDepth', rawP75: 5, subScore: 10, weight: 1 },
      { metric: 'circularDeps', rawP75: 3, subScore: 0, weight: 1 },
      { metric: 'complexity', rawP75: 12.5, subScore: 5, weight: 1 },
      { metric: 'fanInOut', rawP75: 42, subScore: 0, weight: 1 },
    ]);
  });

  it('overall equals the plain mean of sub-scores under equal weights', () => {
    const result = score(
      GOLDEN_METRICS,
      DEFAULT_CONFIG.baselines,
      DEFAULT_CONFIG.weights.ts,
    );
    const mean =
      result.breakdown.reduce((s, p) => s + p.subScore, 0) / result.breakdown.length;
    expect(result.score).toBe(Math.round(mean * 100) / 100);
    expect(result.score).toBe(mean);
  });

  it('non-equal weights differ from the plain mean (normalized weighted mean)', () => {
    // Weight locPerModule (subScore 5) heavily; overall shifts toward 5.
    const result = score(GOLDEN_METRICS, DEFAULT_CONFIG.baselines, {
      locPerModule: 6,
      depDepth: 1,
      circularDeps: 1,
      complexity: 1,
      fanInOut: 1,
    });
    // Σ(w*sub) = 6*5 + 10 + 0 + 5 + 0 = 45; Σw = 10 → 4.5
    expect(result.score).toBe(4.5);
  });

  it('all-good metrics score a perfect 10', () => {
    const result = score(
      {
        locPerModule: 50,
        depDepth: 5,
        circularDeps: 0,
        complexity: 5,
        fanInOut: 6,
      },
      DEFAULT_CONFIG.baselines,
      DEFAULT_CONFIG.weights.ts,
    );
    expect(result.score).toBe(10);
  });

  it('all-bad metrics score a floor of 0', () => {
    const result = score(
      {
        locPerModule: 150,
        depDepth: 20,
        circularDeps: 3,
        complexity: 20,
        fanInOut: 30,
      },
      DEFAULT_CONFIG.baselines,
      DEFAULT_CONFIG.weights.ts,
    );
    expect(result.score).toBe(0);
  });

  it('is deterministic across repeated calls', () => {
    const a = score(GOLDEN_METRICS, DEFAULT_CONFIG.baselines, DEFAULT_CONFIG.weights.ts);
    const b = score(GOLDEN_METRICS, DEFAULT_CONFIG.baselines, DEFAULT_CONFIG.weights.ts);
    const c = score(GOLDEN_METRICS, DEFAULT_CONFIG.baselines, DEFAULT_CONFIG.weights.ts);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });
});
