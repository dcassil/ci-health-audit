/**
 * Direction-aware normalization (CIHA-I-0001, Phase 7 / CIHA-T-0007).
 *
 * Ported from the reference `scoringFns.ts:7-17` with the report's
 * `score0to10 = score0to100 / 10` rescale folded into the constant so there is
 * exactly one rounding step per sub-score (`*1000/100` is the 0–100 formula's
 * `*10000/100` with the `/10` applied). Keeping a single rounding step avoids
 * double-rounding drift and preserves bit-identical output across machines
 * (NFR-001). See the initiative Detailed Design "Normalization".
 */

/** Clamp to the closed unit interval [0, 1]. */
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * Lower-is-better sub-score in `[0, 10]` (2-decimal rounded): `value` at/below
 * `good` → 10, at/above `bad` → 0, linear in between.
 *
 * Degenerate guard: when `good === bad` the divisor is 0, so we short-circuit to
 * `value <= good ? 10 : 0` (at/below the threshold is perfect, anything strictly
 * worse is zero). This keeps NaN/Infinity out of the score (NFR-004) if a user
 * supplies equal good/bad; the ported default table never triggers it.
 */
export function scoreLowerBetter(value: number, good: number, bad: number): number {
  if (bad === good) {
    return value <= good ? 10 : 0;
  }
  const t = (value - good) / (bad - good);
  return Math.round((1 - clamp01(t)) * 1000) / 100; // 0..10, 2 decimals
}

/**
 * Higher-is-better sub-score in `[0, 10]` (2-decimal rounded): `value` at/above
 * `good` → 10, at/below `bad` → 0, linear in between. Retained for
 * seam-completeness / future baselines; the default five metrics are all
 * lower-better.
 *
 * Degenerate guard: when `good === bad` the divisor is 0, so we short-circuit to
 * `value >= good ? 10 : 0`.
 */
export function scoreHigherBetter(value: number, good: number, bad: number): number {
  if (good === bad) {
    return value >= good ? 10 : 0;
  }
  const t = (value - bad) / (good - bad);
  return Math.round(clamp01(t) * 1000) / 100; // 0..10, 2 decimals
}
