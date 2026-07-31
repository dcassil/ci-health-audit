/**
 * ci-health-audit CLI — `scan` / `gate` handler (CIHA-I-0002, Phase 2 / CIHA-T-0010).
 *
 * One implementation serves both `scan` (report mode) and `gate` /
 * `scan --gate` (gate mode) — `gate` is `scan` with `gate: true`, so the two
 * entry points never duplicate logic (Alternatives Considered: "both, one
 * implementation").
 *
 * - Report mode: load config → `scan(config)` → print score + breakdown → exit 0.
 *   NEVER mutates the config (REQ-002).
 * - Gate mode: load config → `scan(config)` → {@link evaluateGate} → on PASS
 *   {@link writeLastScore} atomically + PASS message → exit 0; on FAIL print FAIL
 *   message to stderr, **no write** → exit 1 (REQ-003).
 *
 * The engine `scan` is injected (default: the real engine) so unit tests supply a
 * fake and never shell out to `scc`/`depcruise`.
 */
import {
  scan as engineScan,
  evaluateGate,
  writeLastScore,
  passMessage,
  failMessage,
  type Config,
  type ScanResult,
} from '../../index.js';
import { loadConfigFile } from '../loadConfigFile.js';
import { formatHumanReport, formatJson } from '../format.js';
import type { Writer } from '../writer.js';

/** The engine scan seam: any function producing a {@link ScanResult} from a {@link Config}. */
export type ScanFn = (config: Config) => Promise<ScanResult>;

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
  scan: ScanFn = engineScan,
): Promise<number> {
  const config = loadConfigFile(opts.configPath);
  const result = await scan(config);

  if (!opts.gate) {
    writer.out(
      opts.json ? JSON.stringify(formatJson(result)) : formatHumanReport(result),
    );
    return 0;
  }

  const gate = evaluateGate({
    newScore: result.score,
    lastScore: config.lastScore,
    threshold: config.threshold,
  });

  if (gate.decision === 'fail') {
    if (opts.json) {
      writer.out(JSON.stringify(formatJson(result, gate)));
    } else {
      writer.out(formatHumanReport(result));
      writer.err(failMessage(gate));
    }
    return 1;
  }

  writeLastScore(opts.configPath, result.score);
  if (opts.json) {
    writer.out(JSON.stringify(formatJson(result, gate)));
  } else {
    writer.out(formatHumanReport(result));
    writer.out(passMessage(gate));
  }
  return 0;
}
