import { describe, expect, it } from 'vitest';
import {
  computeDistributionStats,
  computePercentiles,
  percentile,
} from '../src/graph/stats.js';

describe('percentile', () => {
  it('returns 0 for an empty array', () => {
    expect(percentile([], 75)).toBe(0);
  });

  it('returns the single element regardless of p', () => {
    expect(percentile([42], 25)).toBe(42);
    expect(percentile([42], 75)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it('sorts input before interpolating (order-independent)', () => {
    // [1,2,3,4] sorted; p75 index = 0.75*3 = 2.25 → 3*(0.75)+4*(0.25) = 3.25
    expect(percentile([4, 1, 3, 2], 75)).toBeCloseTo(3.25, 10);
    expect(percentile([1, 2, 3, 4], 75)).toBeCloseTo(3.25, 10);
  });

  it('hand-computed p50 median with interpolation', () => {
    // [1,2,3,4] p50 index = 0.5*3 = 1.5 → 2*0.5 + 3*0.5 = 2.5
    expect(percentile([1, 2, 3, 4], 50)).toBeCloseTo(2.5, 10);
  });

  it('exact percentile when index is integral', () => {
    // [10,20,30,40,50] p75 index = 0.75*4 = 3 → 40 exactly
    expect(percentile([10, 20, 30, 40, 50], 75)).toBe(40);
  });
});

describe('computePercentiles', () => {
  it('returns all zeros for empty', () => {
    expect(computePercentiles([])).toEqual({
      p25: 0,
      p50: 0,
      p75: 0,
      p90: 0,
      p95: 0,
      p99: 0,
    });
  });

  it('returns the element for every percentile for a single value', () => {
    expect(computePercentiles([7])).toEqual({
      p25: 7,
      p50: 7,
      p75: 7,
      p90: 7,
      p95: 7,
      p99: 7,
    });
  });

  it('hand-computed set for [1..10]', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const p = computePercentiles(values);
    // n-1 = 9. p25: 2.25 → 3*.75+... idx2=3,idx3=4 → 3.25
    expect(p.p25).toBeCloseTo(3.25, 10);
    // p50: 4.5 → idx4=5, idx5=6 → 5.5
    expect(p.p50).toBeCloseTo(5.5, 10);
    // p75: 6.75 → idx6=7, idx7=8 → 7.75
    expect(p.p75).toBeCloseTo(7.75, 10);
    // p90: 8.1 → idx8=9, idx9=10 → 9.1
    expect(p.p90).toBeCloseTo(9.1, 10);
  });
});

describe('computeDistributionStats', () => {
  it('handles empty input without throwing', () => {
    const s = computeDistributionStats([]);
    expect(s).toEqual({
      count: 0,
      sum: 0,
      mean: 0,
      min: 0,
      max: 0,
      percentiles: computePercentiles([]),
    });
  });

  it('computes count/sum/mean/min/max', () => {
    const s = computeDistributionStats([2, 4, 6]);
    expect(s.count).toBe(3);
    expect(s.sum).toBe(12);
    expect(s.mean).toBe(4);
    expect(s.min).toBe(2);
    expect(s.max).toBe(6);
    expect(s.percentiles.p50).toBe(4);
  });
});
