/**
 * Project resolver (CIHA-I-0003, Phase 1).
 *
 * `resolveProjects(config)` turns the unified {@link ConfigFile} into an array of
 * {@link EffectiveProjectConfig} — one per declared project, in declared order
 * (NFR-001) — by deep-merging each project's optional overrides over the shared
 * top-level defaults. Each result is byte-identical in shape to the v0.1
 * single-root config, so the scan engine consumes it with no project awareness.
 *
 * Merge semantics:
 *  - `threshold` — scalar replace (a project's value wins wholesale).
 *  - `weights.ts` — per-metric merge (override one weight, keep the other four).
 *  - `baselines` — per-metric merge (override one baseline, keep the other four).
 *
 * Pure and deterministic: no I/O, no `process.exit`, no Map/Set iteration in the
 * result path.
 */
import type {
  ConfigFile,
  EffectiveProjectConfig,
  ProjectConfig,
} from './schema.js';

type SharedBaselines = ConfigFile['baselines'];
type SharedTsWeights = ConfigFile['weights']['ts'];

/**
 * Per-field merge of a partial override over a fully-specified base, preserving
 * base entries for keys the override omits. Written key-wise (rather than a
 * spread) so the result stays typed as the fully-specified shape under
 * `exactOptionalPropertyTypes`.
 */
function mergeByField<T extends Record<string, unknown>>(
  base: T,
  override: { [K in keyof T]?: T[K] | undefined } | undefined,
): T {
  if (override === undefined) {
    return { ...base };
  }
  const result = { ...base };
  for (const key of Object.keys(base) as (keyof T)[]) {
    const overrideValue = override[key];
    if (overrideValue !== undefined) {
      result[key] = overrideValue;
    }
  }
  return result;
}

/** Deep-merge a project's optional overrides over the shared defaults. */
function resolveOne(
  shared: ConfigFile,
  project: ProjectConfig,
): EffectiveProjectConfig {
  return {
    language: shared.language,
    srcDir: project.srcDir,
    lastScore: project.lastScore,
    threshold: project.threshold ?? shared.threshold,
    weights: {
      ts: mergeByField<SharedTsWeights>(shared.weights.ts, project.weights?.ts),
    },
    baselines: mergeByField<SharedBaselines>(shared.baselines, project.baselines),
  };
}

/**
 * Resolve every project in `config` into an {@link EffectiveProjectConfig},
 * preserving declared config order (NFR-001).
 */
export function resolveProjects(config: ConfigFile): EffectiveProjectConfig[] {
  return config.projects.map((project) => resolveOne(config, project));
}
