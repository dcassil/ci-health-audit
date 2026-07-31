/**
 * ci-health-audit — gate message builders (CIHA-I-0002, Phase 1 / CIHA-T-0009).
 *
 * Renders the human-readable PASS/FAIL strings and the machine-readable `gate`
 * JSON object from a pure {@link GateResult}. Kept separate from the evaluator so
 * the decision logic stays free of presentation concerns. All numbers are shown
 * at one-decimal precision (matching the engine), except the threshold which is
 * an integer offset and rendered verbatim.
 */
import type { GateResult } from './evaluate.js';

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
