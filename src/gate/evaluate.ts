/**
 * ci-health-audit — pure gate evaluator (CIHA-I-0002, Phase 1 / CIHA-T-0009).
 *
 * Decides PASS/FAIL from `{ newScore, lastScore, threshold }` using the exact
 * gate formula and the first-run seeding rule. This module is **pure**: no I/O,
 * no `process.exit`, no clock. It returns data; the CLI (CIHA-T-0010) maps the
 * decision onto the exit-code contract (`1` = fail, `0` = pass/seed).
 *
 *   floor = lastScore + threshold        // threshold is negative, e.g. -2
 *   PASS  ⟺  newScore >= floor           // boundary newScore === floor PASSES
 *   FAIL  ⟺  newScore <  floor
 *
 * First-run seeding: when `lastScore === 0` the run is treated as unseeded and
 * always PASSES (`seeded: true`), regardless of `newScore`. `0` is the `init`
 * placeholder and a functionally impossible steady-state health score; after the
 * first PASS writes a non-zero score, normal comparison applies. A genuine real
 * `0.0` simply re-seeds harmlessly.
 *
 * Floating-point note (Risk): `floor` is compared directly against `newScore`;
 * rounding happens only for display and for the persisted score, never before
 * the comparison.
 */

/** Inputs to {@link evaluateGate}: the engine score and the config baseline. */
export interface GateInput {
  /** The score the engine just produced (0–10, one decimal). */
  newScore: number;
  /** The previously-saved baseline from config (`0` means unseeded). */
  lastScore: number;
  /** The allowed drop, negative (default `-2`). */
  threshold: number;
}

/** The pure decision produced by {@link evaluateGate}. No I/O was performed. */
export interface GateResult {
  /** `"pass"` → hold/seed/within-threshold; `"fail"` → regression beyond floor. */
  decision: 'pass' | 'fail';
  /** `lastScore + threshold` — the lowest score that still passes. */
  floor: number;
  /** Echoed input (0–10) for message/JSON builders. */
  newScore: number;
  /** Echoed input baseline. */
  lastScore: number;
  /** Echoed input threshold. */
  threshold: number;
  /** `true` when this was a first-run seeding pass (`lastScore === 0`). */
  seeded: boolean;
}

/**
 * Evaluate the gate. Pure — same inputs always yield the same result and nothing
 * is written or read. See the module docstring for the formula and seeding rule.
 */
export function evaluateGate({ newScore, lastScore, threshold }: GateInput): GateResult {
  // Compare against the raw sum to keep boundary semantics exact (FP note above);
  // expose a display-rounded `floor` so JSON/messages never leak artifacts like
  // 7.300000000000001. Scores live on a 0–10, 2-decimal scale.
  const rawFloor = lastScore + threshold;
  const floor = Math.round(rawFloor * 100) / 100;

  if (lastScore === 0) {
    return { decision: 'pass', floor, newScore, lastScore, threshold, seeded: true };
  }

  const decision: GateResult['decision'] = newScore >= rawFloor ? 'pass' : 'fail';
  return { decision, floor, newScore, lastScore, threshold, seeded: false };
}

/**
 * One project's input to {@link evaluateGateAll} (CIHA-I-0003, Phase 3 / CIHA-T-0017):
 * the project's unique `name` plus the three raw gate inputs it is judged against —
 * its just-computed `newScore` and its **own effective** `lastScore`/`threshold`
 * (resolved from the shared defaults + per-project overrides in Phase 1).
 */
export interface ProjectGateInput extends GateInput {
  /** The project's unique declared name (matches the config `projects[].name`). */
  name: string;
}

/** One project's slot in a {@link GateAllResult}: its `name` and per-project {@link GateResult}. */
export interface ProjectGateResult {
  /** The project's unique declared name. */
  name: string;
  /** The pure per-project decision (carries `floor`, echoed scores, `seeded`). */
  gate: GateResult;
}

/**
 * The aggregated multi-project gate decision (CIHA-I-0003, REQ-005). Carries an
 * overall `decision` plus a per-project `projects` array in the exact input order
 * (NFR-001). The overall decision is `'fail'` **iff any** project fails; each
 * per-project {@link GateResult} exposes `floor` (and, via `newScore`/`lastScore`,
 * the delta) so the CLI can name every failing project.
 */
export interface GateAllResult {
  /** `'fail'` iff any project fails; otherwise `'pass'`. */
  decision: 'pass' | 'fail';
  /** Per-project results, preserving the input order. */
  projects: ProjectGateResult[];
}

/**
 * Evaluate the gate for every project and aggregate to one overall decision.
 *
 * Pure — reuses the existing {@link evaluateGate} once per project (each judged
 * against its own `lastScore`/`threshold`, so the `lastScore === 0` seeding rule
 * applies independently per project) and performs no I/O, no `process.exit`, and
 * no clock reads. Input order is preserved verbatim (NFR-001), so the same ordered
 * inputs always yield the same ordered result. The overall `decision` is `'fail'`
 * iff **any** project's per-project decision is `'fail'`.
 */
export function evaluateGateAll(perProject: readonly ProjectGateInput[]): GateAllResult {
  const projects: ProjectGateResult[] = perProject.map(({ name, newScore, lastScore, threshold }) => ({
    name,
    gate: evaluateGate({ newScore, lastScore, threshold }),
  }));

  const decision: GateAllResult['decision'] = projects.some((p) => p.gate.decision === 'fail')
    ? 'fail'
    : 'pass';

  return { decision, projects };
}
