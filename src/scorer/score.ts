/**
 * Weighted 0–10 scorer (CIHA-I-0001, Phase 7 / CIHA-T-0007).
 *
 * Combines the five p75 `Metrics` into an overall 0–10 score plus a per-metric
 * breakdown (raw p75 + sub-score + weight) for explainability. Each metric is
 * normalized by `scoreLowerBetter`/`scoreHigherBetter` per its baseline's
 * `direction`; the overall is a total-weight-normalized weighted mean
 * (`Σ(weight*subScore)/Σweight`) so equal weights reduce to the plain mean of
 * the five sub-scores, while non-equal weights remain possible via config alone
 * (REQ-012; Detailed Design "Scorer Combination").
 *
 * Determinism (NFR-001): fixed metric ordering, no Map/Set iteration affecting
 * the result, exactly one rounding step per sub-score and one for the overall.
 */
import type { Metrics } from '../metrics/computeMetrics.js';
import type { Config } from '../config/schema.js';
import { scoreHigherBetter, scoreLowerBetter } from './normalize.js';

type Baseline = Config['baselines']['locPerModule'];
type Baselines = Config['baselines'];
type TsWeights = Config['weights']['ts'];

/** One metric's contribution: its raw p75, normalized sub-score, and weight. */
export interface MetricScore {
  metric: string;
  rawP75: number;
  subScore: number;
  weight: number;
}

/** Overall 0–10 score plus the per-metric breakdown that produced it. */
export interface ScanResult {
  score: number;
  breakdown: MetricScore[];
}

/** Build one `MetricScore`, dispatching normalization on the baseline direction. */
function mk(metric: string, value: number, baseline: Baseline, weight: number): MetricScore {
  const subScore =
    baseline.direction === 'higher-better'
      ? scoreHigherBetter(value, baseline.good, baseline.bad)
      : scoreLowerBetter(value, baseline.good, baseline.bad);
  return { metric, rawP75: value, subScore, weight };
}

/**
 * Score the five p75 metrics into an overall 0–10 value plus breakdown.
 * Metric order is fixed (locPerModule, depDepth, circularDeps, complexity,
 * fanInOut) for deterministic output.
 */
export function score(m: Metrics, baselines: Baselines, weights: TsWeights): ScanResult {
  const breakdown: MetricScore[] = [
    mk('locPerModule', m.locPerModule, baselines.locPerModule, weights.locPerModule),
    mk('depDepth', m.depDepth, baselines.depDepth, weights.depDepth),
    mk('circularDeps', m.circularDeps, baselines.circularDeps, weights.circularDeps),
    mk('complexity', m.complexity, baselines.complexity, weights.complexity),
    mk('fanInOut', m.fanInOut, baselines.fanInOut, weights.fanInOut),
  ];
  const totalW = breakdown.reduce((s, p) => s + p.weight, 0);
  const weighted = breakdown.reduce((s, p) => s + p.weight * p.subScore, 0) / totalW;
  return { score: Math.round(weighted * 100) / 100, breakdown };
}
