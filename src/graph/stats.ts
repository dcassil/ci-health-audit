/**
 * The standard percentile set every distribution metric exposes.
 */
export interface PercentileSet {
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
}

/**
 * Linear-interpolation percentile over an already-sorted-ascending array.
 * `index = (p/100)*(n-1)`, interpolating between floor and ceil. Empty → 0,
 * single element → that element for any `p`.
 */
function percentileSorted(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) {
    return 0;
  }
  if (n === 1) {
    return sorted[0] ?? 0;
  }
  const index = (p / 100) * (n - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  const lowValue = sorted[lower] ?? 0;
  const highValue = sorted[upper] ?? 0;
  return lowValue * (1 - weight) + highValue * weight;
}

/**
 * Percentile of an unsorted `values` array using linear interpolation. Sorts a
 * copy ascending first, so the input order does not affect the result
 * (NFR-001). Empty → 0.
 */
export function percentile(values: number[], p: number): number {
  return percentileSorted([...values].sort((a, b) => a - b), p);
}

/**
 * Compute the standard percentile set (p25/p50/p75/p90/p95/p99) for `values`
 * using linear interpolation. Empty array → all zeros; single element → that
 * element for every percentile.
 */
export function computePercentiles(values: number[]): PercentileSet {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p25: percentileSorted(sorted, 25),
    p50: percentileSorted(sorted, 50),
    p75: percentileSorted(sorted, 75),
    p90: percentileSorted(sorted, 90),
    p95: percentileSorted(sorted, 95),
    p99: percentileSorted(sorted, 99),
  };
}

/**
 * Summary statistics for a numeric distribution.
 */
export interface DistributionStats {
  count: number;
  sum: number;
  mean: number;
  min: number;
  max: number;
  percentiles: PercentileSet;
}

/**
 * Compute count/sum/mean/min/max plus the standard percentile set. Empty input
 * yields zeros throughout (no throw, NFR-005).
 */
export function computeDistributionStats(values: number[]): DistributionStats {
  const count = values.length;
  if (count === 0) {
    return {
      count: 0,
      sum: 0,
      mean: 0,
      min: 0,
      max: 0,
      percentiles: computePercentiles([]),
    };
  }
  const sum = values.reduce((acc, v) => acc + v, 0);
  return {
    count,
    sum,
    mean: sum / count,
    min: Math.min(...values),
    max: Math.max(...values),
    percentiles: computePercentiles(values),
  };
}
