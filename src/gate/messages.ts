/**
 * ci-health-audit — gate message builders (CIHA-I-0002, Phase 1 / CIHA-T-0009).
 *
 * Renders the human-readable PASS/FAIL strings and the machine-readable `gate`
 * JSON object from a pure {@link GateResult}. Kept separate from the evaluator so
 * the decision logic stays free of presentation concerns. All numbers are shown
 * at one-decimal precision (matching the engine), except the threshold which is
 * an integer offset and rendered verbatim.
 */
import type { GateResult, GateAllResult } from './evaluate.js';

/** Display a score/floor at one-decimal precision (e.g. `7`→`7.0`, `5.4`→`5.4`). */
function oneDecimal(value: number): string {
  return value.toFixed(1);
}

/**
 * Human message for a PASS (stdout):
 * `PASS — score 7.1 ≥ floor 5.4 (last 7.4, threshold -2). Saved 7.1.`
 * The `saved` value reflects what the writer persists (rounded to one decimal).
 */
export function passMessage(result: GateResult): string {
  const score = oneDecimal(result.newScore);
  return (
    `PASS — score ${score} ≥ floor ${oneDecimal(result.floor)} ` +
    `(last ${oneDecimal(result.lastScore)}, threshold ${String(result.threshold)}). ` +
    `Saved ${score}.`
  );
}

/**
 * Human message for a FAIL (stderr):
 * `FAIL — score 3.0 < floor 5.4 (last 7.4, threshold -2). Config not updated.`
 */
export function failMessage(result: GateResult): string {
  return (
    `FAIL — score ${oneDecimal(result.newScore)} < floor ${oneDecimal(result.floor)} ` +
    `(last ${oneDecimal(result.lastScore)}, threshold ${String(result.threshold)}). ` +
    `Config not updated.`
  );
}

/**
 * Human message for an overall multi-project PASS (stdout, CIHA-I-0003 Phase 4):
 * `PASS — all N projects held their floor. Saved N baselines.`
 * Emitted only on overall PASS, when {@link writeLastScores} has persisted every
 * project's new score.
 */
export function passAllMessage(result: GateAllResult): string {
  const count = result.projects.length;
  const noun = count === 1 ? 'project' : 'projects';
  return `PASS — all ${String(count)} ${noun} held their floor. Saved ${String(count)} baselines.`;
}

/**
 * Human message for an overall multi-project FAIL (stderr, CIHA-I-0003 Phase 4).
 * Names each failing project with its floor, actual score, and delta, one per
 * line, under a summary header. Nothing is written on FAIL, so the message says so.
 * `FAIL — 1 project regressed beyond its floor. Config not updated.`
 * `  cli — score 4.5 < floor 5.0 (last 7.0, threshold -2, delta -2.5)`
 */
export function failAllMessage(result: GateAllResult): string {
  const failed = result.projects.filter((p) => p.gate.decision === 'fail');
  const noun = failed.length === 1 ? 'project' : 'projects';
  const header =
    `FAIL — ${String(failed.length)} ${noun} regressed beyond ` +
    `${failed.length === 1 ? 'its floor' : 'their floor'}. Config not updated.`;
  const lines = failed.map((p) => {
    const g = p.gate;
    const delta = Math.round((g.newScore - g.lastScore) * 100) / 100;
    const sign = delta >= 0 ? '+' : '';
    return (
      `  ${p.name} — score ${oneDecimal(g.newScore)} < floor ${oneDecimal(g.floor)} ` +
      `(last ${oneDecimal(g.lastScore)}, threshold ${String(g.threshold)}, delta ${sign}${oneDecimal(delta)})`
    );
  });
  return [header, ...lines].join('\n');
}

/** The `gate` object embedded in `--json` output (Detailed Design). */
export interface GateJson {
  decision: 'pass' | 'fail';
  floor: number;
  lastScore: number;
  threshold: number;
}

/**
 * Machine-readable `gate` object:
 * `{ "decision": "pass", "floor": 5.4, "lastScore": 7.4, "threshold": -2 }`.
 */
export function gateJson(result: GateResult): GateJson {
  return {
    decision: result.decision,
    floor: result.floor,
    lastScore: result.lastScore,
    threshold: result.threshold,
  };
}
