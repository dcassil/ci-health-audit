/**
 * Config schema (CIHA-I-0001 Phase 2; extended for CIHA-I-0003 Phase 1).
 *
 * Zod v4 schema for `ci-health-audit.config.json`. As of v0.2.0 the config is a
 * **unified per-project model**: a top-level `projects` array (each entry naming
 * a codebase piece to score independently) plus shared top-level
 * `threshold`/`weights`/`baselines` defaults that each project inherits and may
 * override. The flat single-root shape (top-level `srcDir`/`lastScore`) is
 * intentionally dropped — the loader rejects it with a migration error
 * (REQ-001 / REQ-002 / NFR-004).
 *
 * Two shapes live here:
 *  - {@link ConfigFile} — the on-disk shape produced by {@link configFileSchema}
 *    (shared defaults + a `projects` array of {@link ProjectConfig}).
 *  - {@link EffectiveProjectConfig} (aliased as {@link Config}) — one project's
 *    overrides deep-merged over the shared defaults; byte-identical in shape to
 *    the v0.1 single-root config so the scan engine consumes it unchanged.
 *    Produced by `resolveProjects` (see `./resolveProjects.ts`).
 */
import { z } from 'zod';

/** Direction a metric is scored in: lower raw values better, or higher better. */
const metricDirection = z.enum(['lower-better', 'higher-better']);

/** Per-metric good/bad thresholds (raw metric units) plus scoring direction. */
const metricBaseline = z
  .object({
    good: z.number(),
    bad: z.number(),
    direction: metricDirection,
  })
  .strict();

/** Equal-weight keys for the five JS/TS metrics. */
const tsWeights = z
  .object({
    locPerModule: z.number(),
    depDepth: z.number(),
    circularDeps: z.number(),
    complexity: z.number(),
    fanInOut: z.number(),
  })
  .strict();

/** The `weights` block. Only the `ts` plugin is supported for now. */
const weights = z.object({ ts: tsWeights }).strict();

/** The five per-metric baselines. */
const baselines = z
  .object({
    locPerModule: metricBaseline,
    depDepth: metricBaseline,
    circularDeps: metricBaseline,
    complexity: metricBaseline,
    fanInOut: metricBaseline,
  })
  .strict();

/**
 * One project to score independently. `name`/`srcDir`/`lastScore` are required;
 * `threshold`/`weights`/`baselines` are optional per-project overrides that
 * deep-merge over the shared top-level defaults (see `resolveProjects`).
 */
/** Per-project weight override: any subset of the five metric weights. */
const partialTsWeights = tsWeights.partial();
const partialWeights = z.object({ ts: partialTsWeights }).strict();

/** Per-project baseline override: any subset of the five metric baselines. */
const partialBaselines = baselines.partial();

export const projectConfigSchema = z
  .object({
    name: z.string().min(1, 'project name must be non-empty'),
    srcDir: z.string().min(1, 'srcDir is required and must be non-empty'),
    lastScore: z.number().min(0).max(10),
    threshold: z.number().optional(),
    weights: partialWeights.optional(),
    baselines: partialBaselines.optional(),
  })
  .strict();

/** A single project entry (input shape, before defaults are merged in). */
export type ProjectConfig = z.infer<typeof projectConfigSchema>;

/**
 * The on-disk config file (v0.2.0). Carries shared `threshold`/`weights`/
 * `baselines` defaults and a non-empty `projects` array whose `name`s must be
 * unique. Unknown keys are rejected.
 */
export const configFileSchema = z
  .object({
    language: z.literal('ts'),
    threshold: z.number().default(-2),
    weights,
    baselines,
    projects: z
      .array(projectConfigSchema)
      .min(1, 'projects must contain at least one project'),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>();
    cfg.projects.forEach((project, index) => {
      if (seen.has(project.name)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate project name "${project.name}" (names must be unique)`,
          path: ['projects', index, 'name'],
        });
      }
      seen.add(project.name);
    });
  });

/** Fully-validated on-disk config file with shared defaults + `projects`. */
export type ConfigFile = z.infer<typeof configFileSchema>;

/**
 * One project resolved against the shared defaults: byte-identical in shape to
 * the v0.1 single-root config, so the scan engine (`scan`) consumes it with zero
 * project awareness. Produced by `resolveProjects`.
 */
export interface EffectiveProjectConfig {
  language: 'ts';
  srcDir: string;
  lastScore: number;
  threshold: number;
  weights: z.infer<typeof weights>;
  baselines: z.infer<typeof baselines>;
}

/**
 * The shape the scan engine consumes. Aliased to {@link EffectiveProjectConfig}
 * because the engine operates on one resolved project at a time.
 */
export type Config = EffectiveProjectConfig;

/**
 * Default shared config values (`init` scaffolding + resolver fallbacks): equal
 * weights (all `1`) and the ported baseline table. All five metrics are
 * lower-better. Carries the shared `threshold`/`weights`/`baselines` only — a
 * usable file also needs a `projects` array (added by `init`).
 */
export const DEFAULT_CONFIG: Pick<
  ConfigFile,
  'language' | 'threshold' | 'weights' | 'baselines'
> = {
  language: 'ts',
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
