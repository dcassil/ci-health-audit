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
import type { Config } from './config/schema.js';
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
 * Scan a codebase and return its deterministic 0–10 health score plus per-metric
 * breakdown. Accepts an already-validated {@link Config}; resolves the plugin for
 * `config.language`, runs it through the (injectable) {@link CommandRunner},
 * builds the module graph, computes the five p75 metrics, and scores them
 * against `config.baselines`/`config.weights.ts` (REQ-014).
 *
 * Never throws on empty/degenerate inputs (NFR-005): an empty `srcDir` yields a
 * valid {@link ScanResult} whose metrics are 0 (and their corresponding
 * sub-scores), not a crash. Tool/parse failures (missing `scc`/`depcruise`)
 * surface as their typed errors (NFR-004).
 */
export async function scan(config: Config, opts: ScanOptions = {}): Promise<ScanResult> {
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
 * Convenience wrapper that validates raw (unvalidated) config JSON via
 * {@link loadConfig} before delegating to {@link scan}. Callers holding a
 * validated {@link Config} should call {@link scan} directly; the CLI
 * (CIHA-I-0002) uses this to go from parsed JSON straight to a score.
 */
export async function scanWithRawConfig(
  raw: unknown,
  opts: ScanOptions = {},
): Promise<ScanResult> {
  return scan(loadConfig(raw), opts);
}

// ---- Public API re-exports (explicit; no `export *` barrels, NFR eslint) ----

export { configSchema, DEFAULT_CONFIG, type Config } from './config/schema.js';
export { loadConfig } from './config/loadConfig.js';

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
export { evaluateGate, type GateInput, type GateResult } from './gate/evaluate.js';
export { writeLastScore } from './gate/writeConfig.js';
export { passMessage, failMessage, gateJson, type GateJson } from './gate/messages.js';
