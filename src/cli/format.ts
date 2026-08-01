/**
 * ci-health-audit CLI — report formatter (CIHA-I-0002, Phase 2 / CIHA-T-0010;
 * generalized to multi-project in CIHA-I-0003, Phase 4 / CIHA-T-0018).
 *
 * Renders a {@link ProjectsResult} (and, in gate mode, a {@link GateAllResult})
 * into the human table or the `--json` object specified in the initiative Detailed
 * Design ("Reporting"). Output shows one block per project — its `name`, its
 * `score`, and the existing metric breakdown table — followed by the mean headline
 * line; `--json` emits a `projects` array (each element carrying `name`, `score`,
 * `breakdown`, and, in gate mode, `gate`) plus a top-level `score` equal to the
 * arithmetic mean.
 *
 * Pure string/object builders — no I/O; the handlers pass the output to the
 * injected writer.
 */
import {
  gateJson,
  type ProjectsResult,
  type MetricScore,
  type GateAllResult,
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

/** The per-project `--json` element: `name`, `score`, `breakdown`, and (gate mode) `gate`. */
export interface ProjectReportJson {
  name: string;
  score: number;
  breakdown: Record<string, number>;
  gate?: GateJson;
}

/**
 * The machine-readable `--json` shape: a `projects` array plus a top-level `score`
 * equal to the arithmetic mean. The GitHub Action (Phase 6) reads `score` and
 * iterates `projects`; this shape is a stable contract.
 */
export interface ReportJson {
  score: number;
  projects: ProjectReportJson[];
}

/** Render one breakdown row: right-padded label + right-aligned one-decimal sub-score. */
function formatRow(entry: MetricScore): string {
  const label = METRIC_LABELS[entry.metric] ?? entry.metric;
  const paddedLabel = label.padEnd(18, ' ');
  const paddedScore = oneDecimal(entry.subScore).padStart(4, ' ');
  return `  ${paddedLabel}${paddedScore}`;
}

/**
 * Build one project's human block:
 *
 *   core — health score: 7.4 / 10
 *
 *     LOC / module        8.1
 *     ...
 */
function formatProjectBlock(project: ProjectsResult['projects'][number]): string {
  const header = `${project.name} — health score: ${oneDecimal(project.result.score)} / 10`;
  const rows = project.result.breakdown.map(formatRow).join('\n');
  return `${header}\n\n${rows}`;
}

/**
 * Build the human report: one block per project (name, score, breakdown table)
 * separated by blank lines, followed by the mean headline line:
 *
 *   core — health score: 7.4 / 10
 *
 *     LOC / module        8.1
 *     ...
 *
 *   cli — health score: 6.1 / 10
 *
 *     ...
 *
 *   ci-health-audit — mean health score: 6.8 / 10
 */
export function formatHumanReport(result: ProjectsResult): string {
  const blocks = result.projects.map(formatProjectBlock).join('\n\n');
  const headline = `ci-health-audit — mean health score: ${oneDecimal(result.score)} / 10`;
  return `${blocks}\n\n${headline}`;
}

/** Flatten a project's breakdown array into a `{ metric: subScore }` map. */
function breakdownMap(project: ProjectsResult['projects'][number]): Record<string, number> {
  const breakdown: Record<string, number> = {};
  for (const entry of project.result.breakdown) {
    breakdown[entry.metric] = entry.subScore;
  }
  return breakdown;
}

/**
 * Build the `--json` object: a `projects` array (each element `{ name, score,
 * breakdown, gate? }`) plus a top-level mean `score`. When a {@link GateAllResult}
 * is supplied (gate mode), each project's element carries its per-project `gate`
 * object, matched by `name`; otherwise `gate` is omitted.
 */
export function formatJson(result: ProjectsResult, gate?: GateAllResult): ReportJson {
  const gateByName = new Map(gate?.projects.map((p) => [p.name, p.gate]) ?? []);
  const projects: ProjectReportJson[] = result.projects.map((project) => {
    const element: ProjectReportJson = {
      name: project.name,
      score: project.result.score,
      breakdown: breakdownMap(project),
    };
    const projectGate = gateByName.get(project.name);
    if (projectGate !== undefined) {
      element.gate = gateJson(projectGate);
    }
    return element;
  });
  return { score: result.score, projects };
}
