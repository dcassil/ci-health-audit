/**
 * ci-health-audit CLI — `scan` / `gate` handler (CIHA-I-0002, Phase 2 / CIHA-T-0010;
 * rewired onto the multi-project engine in CIHA-I-0003, Phase 4 / CIHA-T-0018).
 *
 * One implementation serves both `scan` (report mode) and `gate` /
 * `scan --gate` (gate mode) — `gate` is `scan` with `gate: true`, so the two
 * entry points never duplicate logic (Alternatives Considered: "both, one
 * implementation").
 *
 * - Report mode: load {@link ConfigFile} → `scanProjects(config)` → print the
 *   per-project report (or JSON) → exit 0. NEVER mutates the config (REQ-002).
 * - Gate mode: `scanProjects(config)` → per-project {@link evaluateGateAll} against
 *   each project's own effective `lastScore`/`threshold` → on overall PASS
 *   {@link writeLastScores} atomically (every project's new score) + PASS message →
 *   exit 0; on overall FAIL print the report + a FAIL message naming each failing
 *   project to stderr, **no write** → exit 1 (REQ-005, REQ-006).
 *
 * The command stays thin: formatting lives in `format.ts`, decision logic in the
 * gate module. The multi-project engine scan is injected (default: the real
 * engine) so unit tests supply a fake and never shell out to `scc`/`depcruise`.
 */
import {
  scanProjects as engineScanProjects,
  evaluateGateAll,
  resolveProjects,
  writeLastScores,
  passAllMessage,
  failAllMessage,
  type ConfigFile,
  type ProjectsResult,
  type ProjectGateInput,
} from '../../index.js';
import { loadConfigFile } from '../loadConfigFile.js';
import { formatHumanReport, formatJson } from '../format.js';
import type { Writer } from '../writer.js';

/** The engine scan seam: any function producing a {@link ProjectsResult} from a {@link ConfigFile}. */
export type ScanFn = (config: ConfigFile) => Promise<ProjectsResult>;

/** Options for {@link runScan}, already resolved by the dispatcher. */
export interface ScanOptions {
  /** Absolute path to the config file. */
  configPath: string;
  /** `true` for gate mode (evaluate + write-back); `false` for report mode. */
  gate: boolean;
  /** `true` to emit the machine-readable `--json` object instead of the table. */
  json: boolean;
}

/**
 * Run report or gate mode. Returns the exit code (`0` report/PASS, `1` gate FAIL).
 * Throws {@link ConfigError} (→ exit 2) via {@link loadConfigFile} on config
 * problems. `scan` defaults to the real engine; tests inject a fake.
 */
export async function runScan(
  opts: ScanOptions,
  writer: Writer,
  scan: ScanFn = engineScanProjects,
): Promise<number> {
  const config = loadConfigFile(opts.configPath);
  const result = await scan(config);

  if (!opts.gate) {
    writer.out(
      opts.json ? JSON.stringify(formatJson(result)) : formatHumanReport(result),
    );
    return 0;
  }

  // Build per-project gate inputs from each project's just-computed score plus its
  // OWN effective baseline/threshold. `resolveProjects` preserves declared config
  // order (NFR-001), so it is index-aligned with `result.projects` and
  // `config.projects` — recover each project's name from `result.projects[i]`.
  const effective = resolveProjects(config);
  const gateInputs: ProjectGateInput[] = result.projects.map((project, index) => {
    const eff = effective[index];
    if (eff === undefined) {
      // Unreachable: scanProjects and resolveProjects walk the same ordered list.
      throw new Error(`no effective config for project "${project.name}"`);
    }
    return {
      name: project.name,
      newScore: project.result.score,
      lastScore: eff.lastScore,
      threshold: eff.threshold,
    };
  });

  const gate = evaluateGateAll(gateInputs);

  if (gate.decision === 'fail') {
    if (opts.json) {
      writer.out(JSON.stringify(formatJson(result, gate)));
    } else {
      writer.out(formatHumanReport(result));
      writer.err(failAllMessage(gate));
    }
    return 1;
  }

  const scoresByName = new Map(
    result.projects.map((project) => [project.name, project.result.score]),
  );
  writeLastScores(opts.configPath, scoresByName);

  if (opts.json) {
    writer.out(JSON.stringify(formatJson(result, gate)));
  } else {
    writer.out(formatHumanReport(result));
    writer.out(passAllMessage(gate));
  }
  return 0;
}
