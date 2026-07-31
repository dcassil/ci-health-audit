/**
 * ci-health-audit CLI — report formatter (CIHA-I-0002, Phase 2 / CIHA-T-0010).
 *
 * Renders a {@link ScanResult} (and, in gate mode, a {@link GateResult}) into the
 * human table or the `--json` object specified in the initiative Detailed Design
 * ("Terminal output formatting"). Pure string/object builders — no I/O; the
 * handlers pass the output to the injected writer.
 */
import {
  gateJson,
  type ScanResult,
  type MetricScore,
  type GateResult,
  type GateJson,
} from '../index.js';

/** Human-readable labels for each metric key, in the fixed breakdown order. */
const METRIC_LABELS: Record<string, string> = {
  locPerModule: 'LOC / module',
  depDepth: 'Dependency depth',
  circularDeps: 'Circular deps',
  complexity: 'Complexity',
  fanInOut: 'Fan-in / fan-out',
};

/** Show a score at one-decimal precision (e.g. `7` → `7.0`, `10` → `10.0`). */
function oneDecimal(value: number): string {
  return value.toFixed(1);
}

/** The machine-readable `--json` shape; `gate` present only in gate mode. */
export interface ReportJson {
  score: number;
  breakdown: Record<string, number>;
  gate?: GateJson;
}

/** Render one breakdown row: right-padded label + right-aligned one-decimal sub-score. */
function formatRow(entry: MetricScore): string {
  const label = METRIC_LABELS[entry.metric] ?? entry.metric;
  const paddedLabel = label.padEnd(18, ' ');
  const paddedScore = oneDecimal(entry.subScore).padStart(4, ' ');
  return `  ${paddedLabel}${paddedScore}`;
}

/**
 * Build the human report (Detailed Design):
 *
 *   ci-health-audit — health score: 7.4 / 10
 *
 *     LOC / module        8.1
 *     ...
 */
export function formatHumanReport(result: ScanResult): string {
  const header = `ci-health-audit — health score: ${oneDecimal(result.score)} / 10`;
  const rows = result.breakdown.map(formatRow).join('\n');
  return `${header}\n\n${rows}`;
}

/**
 * Build the `--json` object: `{ score, breakdown, gate? }`. `breakdown` maps each
 * metric key to its sub-score. The `gate` key is included only when a
 * {@link GateResult} is supplied (gate mode).
 */
export function formatJson(result: ScanResult, gate?: GateResult): ReportJson {
  const breakdown: Record<string, number> = {};
  for (const entry of result.breakdown) {
    breakdown[entry.metric] = entry.subScore;
  }
  const json: ReportJson = { score: result.score, breakdown };
  if (gate !== undefined) {
    json.gate = gateJson(gate);
  }
  return json;
}
