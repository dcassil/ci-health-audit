/**
 * Config schema (CIHA-I-0001, Phase 2).
 *
 * Zod v4 schema for `ci-health-audit.config.json`, plus the inferred `Config`
 * type and a `DEFAULT_CONFIG` seeded with equal weights and the ported
 * good/bad baseline table. Owns the `lastScore=0` and `threshold=-2` defaults
 * (REQ-001 / REQ-002).
 */
import { z } from 'zod';

/** Direction a metric is scored in: lower raw values better, or higher better. */
const metricDirection = z.enum(['lower-better', 'higher-better']);

/** Per-metric good/bad thresholds (raw metric units) plus scoring direction. */
const metricBaseline = z.object({
  good: z.number(),
  bad: z.number(),
  direction: metricDirection,
});

/** Equal-weight keys for the five JS/TS metrics. */
const tsWeights = z.object({
  locPerModule: z.number(),
  depDepth: z.number(),
  circularDeps: z.number(),
  complexity: z.number(),
  fanInOut: z.number(),
});

/** The full config schema. Only `language: "ts"` is supported for now. */
export const configSchema = z.object({
  language: z.literal('ts'),
  srcDir: z.string().default('./src'),
  lastScore: z.number().min(0).max(10).default(0),
  threshold: z.number().default(-2),
  weights: z.object({ ts: tsWeights }),
  baselines: z.object({
    locPerModule: metricBaseline,
    depDepth: metricBaseline,
    circularDeps: metricBaseline,
    complexity: metricBaseline,
    fanInOut: metricBaseline,
  }),
});

/** Fully-validated, defaults-applied config object. */
export type Config = z.infer<typeof configSchema>;

/**
 * Default config: equal weights (all `1`) and the ported baseline table.
 * All five metrics are lower-better. See the initiative Detailed Design
 * "Baseline Table" for the reference-defaults provenance of each row.
 */
export const DEFAULT_CONFIG: Config = {
  language: 'ts',
  srcDir: './src',
  lastScore: 0,
  threshold: -2,
  weights: {
    ts: {
      locPerModule: 1,
      depDepth: 1,
      circularDeps: 1,
      complexity: 1,
      fanInOut: 1,
    },
  },
  baselines: {
    locPerModule: { good: 50, bad: 150, direction: 'lower-better' },
    depDepth: { good: 5, bad: 20, direction: 'lower-better' },
    circularDeps: { good: 0, bad: 3, direction: 'lower-better' },
    complexity: { good: 5, bad: 20, direction: 'lower-better' },
    fanInOut: { good: 6, bad: 30, direction: 'lower-better' },
  },
};
