/**
 * ci-health-audit — core scanning & scoring engine (CIHA-I-0001).
 *
 * Package entrypoint and public API. `scan()` is the single top-level
 * orchestrator that wires every stage together (Phase 8 / CIHA-T-0008):
 *
 *   config → resolve plugin → run plugin → build graph → compute metrics →
 *   score → ScanResult
 *
 * `scan()` performs no writes, no process exits, and no network access
 * (NFR-002); the only impure work is the injected {@link CommandRunner}
 * (default {@link execCommandRunner}). Runtimes/CLI concerns live in
 * CIHA-I-0002, which consumes `scan()` as a library.
 */
import { loadConfig } from './config/loadConfig.js';
import { resolveProjects } from './config/resolveProjects.js';
import type { Config, ConfigFile } from './config/schema.js';
import { buildGraph } from './graph/builder.js';
import { computeMetrics } from './metrics/computeMetrics.js';
import { PluginRegistry } from './scanner/registry.js';
import type { CommandRunner, ScanContext } from './scanner/types.js';
import { execCommandRunner } from './scanner/execRunner.js';
import { TsToolPlugin } from './plugins/ts/plugin.js';
import { score, type ScanResult } from './scorer/score.js';

/** Optional overrides for {@link scan}: a custom runner and/or plugin registry. */
export interface ScanOptions {
  /** Command execution seam (NFR-006). Defaults to {@link execCommandRunner}. */
  runner?: CommandRunner;
  /**
   * Plugin registry to resolve the language plugin from. Defaults to a fresh
   * registry with {@link TsToolPlugin} registered.
   */
  registry?: PluginRegistry;
}

/** Build the default registry: a single {@link TsToolPlugin} for `language: "ts"`. */
function defaultRegistry(): PluginRegistry {
  const registry = new PluginRegistry();
  registry.register(new TsToolPlugin());
  return registry;
}

/**
 * Scan a single resolved project ({@link EffectiveProjectConfig}) and return its
 * deterministic 0–10 health score plus per-metric breakdown. This is the proven
 * single-root engine unit (CIHA-I-0003 Phase 2 / CIHA-T-0016): it resolves the
 * plugin for `config.language`, runs it through the (injectable)
 * {@link CommandRunner}, builds the module graph, computes the five p75 metrics,
 * and scores them against `config.baselines`/`config.weights.ts` (REQ-003, REQ-014).
 *
 * It has zero project awareness — the orchestrating {@link scanProjects} maps it
 * over every declared project.
 *
 * Never throws on empty/degenerate inputs (NFR-005): an empty `srcDir` yields a
 * valid {@link ScanResult} whose metrics are 0 (and their corresponding
 * sub-scores), not a crash. Tool/parse failures (missing `scc`/`depcruise`)
 * surface as their typed errors (NFR-004).
 */
export async function scanOne(config: Config, opts: ScanOptions = {}): Promise<ScanResult> {
  const runner = opts.runner ?? execCommandRunner;
  const registry = opts.registry ?? defaultRegistry();

  const plugin = registry.resolve(config.language);
  const ctx: ScanContext = { srcDir: config.srcDir, config, runner };

  const output = await plugin.run(ctx);
  const graph = buildGraph(output.modules, output.edges, output.fileStats);
  const metrics = computeMetrics(graph);
  return score(metrics, config.baselines, config.weights.ts);
}

/**
 * Backwards-compatible alias for {@link scanOne}. The v0.1 public API name for
 * the single-root scan; retained so existing single-project callers (the CLI's
 * `scan.ts` seam, integration tests) keep working until Phase 4 (CIHA-T-0018)
 * rewires the CLI onto {@link scanProjects}.
 */
export const scan = scanOne;

/** One project's contribution to a {@link ProjectsResult}. */
export interface ProjectResult {
  /** The project's unique declared name. */
  name: string;
  /** The project's source directory (as declared / resolved). */
  srcDir: string;
  /** The single-project {@link ScanResult} produced by {@link scanOne}. */
  result: ScanResult;
}

/**
 * The multi-project scan output (CIHA-I-0003, REQ-004). Carries a per-project
 * {@link ProjectResult} array in declared config order (NFR-001) plus a numeric
 * headline `score` equal to the arithmetic mean of the per-project scores,
 * rounded to two decimals. The mean is report-only; the gate remains strictly
 * per-project (see initiative Alternatives).
 */
export interface ProjectsResult {
  /** Per-project results, in declared config order. */
  projects: ProjectResult[];
  /** Arithmetic mean of the per-project scores, `round(Σ score / n, 2)`. */
  score: number;
}

/**
 * The seam {@link scanProjects} uses to score one project. Defaults to
 * {@link scanOne}; tests inject a fake so nothing shells out to `scc`/`depcruise`.
 */
export type ScanOneFn = (config: Config, opts: ScanOptions) => Promise<ScanResult>;

/** Options for {@link scanProjects}: the {@link ScanOptions} seam plus an injectable `scanOne`. */
export interface ScanProjectsOptions extends ScanOptions {
  /** Per-project scan seam. Defaults to {@link scanOne}; tests inject a fake. */
  scanOne?: ScanOneFn;
}

/**
 * Scan every declared project in a validated {@link ConfigFile} and return a
 * {@link ProjectsResult} (CIHA-I-0003 Phase 2, REQ-003 / REQ-004). Resolves the
 * projects via {@link resolveProjects}, then runs `scanOne` once per project in
 * declared config order (NFR-001 — an ordered array walk, no Map/Set iteration).
 *
 * The headline `score` is the arithmetic mean of the per-project scores rounded
 * to two decimals with exactly one rounding step (`round(Σ score / n, 2)`). The
 * schema guarantees `projects` is non-empty, so `n >= 1` and the mean is always
 * defined; a one-project config yields that project's single score unchanged.
 *
 * Purity preserved (NFR-002): no writes, no `process.exit`, no network — the only
 * impure work is the injected {@link CommandRunner} inside `scanOne`.
 */
export async function scanProjects(
  config: ConfigFile,
  opts: ScanProjectsOptions = {},
): Promise<ProjectsResult> {
  const scanOneImpl = opts.scanOne ?? scanOne;
  const scanOpts: ScanOptions = {};
  if (opts.runner !== undefined) scanOpts.runner = opts.runner;
  if (opts.registry !== undefined) scanOpts.registry = opts.registry;

  // `resolveProjects` preserves declared order (NFR-001), so index-align the
  // resolved effective configs with their source `projects[i]` to recover each
  // project's `name` (which the engine-facing EffectiveProjectConfig drops).
  const effective = resolveProjects(config);
  const projects: ProjectResult[] = [];
  for (let i = 0; i < effective.length; i += 1) {
    const project = effective[i];
    const declared = config.projects[i];
    if (project === undefined || declared === undefined) continue;
    const result = await scanOneImpl(project, scanOpts);
    projects.push({ name: declared.name, srcDir: project.srcDir, result });
  }

  const sum = projects.reduce((acc, p) => acc + p.result.score, 0);
  const score = Math.round((sum / projects.length) * 100) / 100;
  return { projects, score };
}

/**
 * Convenience wrapper that validates raw (unvalidated) config JSON via
 * {@link loadConfig} before delegating to {@link scanProjects}. Callers holding a
 * validated {@link ConfigFile} should call {@link scanProjects} directly. Returns
 * the full multi-project {@link ProjectsResult} — the engine no longer silently
 * drops to `projects[0]` (the Phase-1 shim is gone).
 */
export async function scanWithRawConfig(
  raw: unknown,
  opts: ScanProjectsOptions = {},
): Promise<ProjectsResult> {
  return scanProjects(loadConfig(raw), opts);
}

// ---- Public API re-exports (explicit; no `export *` barrels, NFR eslint) ----

export {
  configFileSchema,
  projectConfigSchema,
  DEFAULT_CONFIG,
  type Config,
  type ConfigFile,
  type ProjectConfig,
  type EffectiveProjectConfig,
} from './config/schema.js';
export { loadConfig } from './config/loadConfig.js';
export { resolveProjects } from './config/resolveProjects.js';

export { score, type ScanResult, type MetricScore } from './scorer/score.js';

export { buildGraph, type ModuleGraph, type NodeStats } from './graph/builder.js';

export { computeMetrics, type Metrics } from './metrics/computeMetrics.js';

export { PluginRegistry, NoPluginForLanguageError } from './scanner/registry.js';
export { execCommandRunner, CommandExecutionError } from './scanner/execRunner.js';
export type {
  CommandRunner,
  ScanContext,
  ToolPlugin,
  ToolSupport,
  ToolRunOutput,
  ModuleEntry,
  Edge,
  FileStats,
  Language,
} from './scanner/types.js';

export { TsToolPlugin } from './plugins/ts/plugin.js';

// ---- Gate semantics (CIHA-I-0002, Phase 1): pure evaluator + atomic writer ----
export {
  evaluateGate,
  evaluateGateAll,
  type GateInput,
  type GateResult,
  type ProjectGateInput,
  type ProjectGateResult,
  type GateAllResult,
} from './gate/evaluate.js';
export { writeLastScore, writeLastScores } from './gate/writeConfig.js';
export {
  passMessage,
  failMessage,
  passAllMessage,
  failAllMessage,
  gateJson,
  type GateJson,
} from './gate/messages.js';
