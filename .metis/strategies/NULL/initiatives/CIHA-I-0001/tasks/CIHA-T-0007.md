---
id: phase-7-0-10-scorer
level: task
title: "Phase 7: 0-10 scorer"
short_code: "CIHA-T-0007"
created_at: 2026-07-31T18:26:20.746707+00:00
updated_at: 2026-07-31T19:10:13.232786+00:00
parent: CIHA-I-0001
blocked_by: []
archived: false

tags:
  - "#task"
  - "#phase/completed"


exit_criteria_met: false
strategy_id: NULL
initiative_id: CIHA-I-0001
---

# Phase 7: 0-10 scorer

## Parent Initiative **[CONDITIONAL: Assigned Task]**

[[CIHA-I-0001]]

## Objective **[REQUIRED]**

Implement the deterministic 0–10 scorer: direction-aware normalization functions (`scoreLowerBetter`/`scoreHigherBetter`, rescaled to 0–10 with a single rounding step) and the equal-weight, total-weight-normalized combination that emits an overall 0–10 score plus a per-metric breakdown (raw p75 + sub-score + weight) for explainability. This is small but determinism-critical: the rounding/normalization must be exact so identical inputs yield bit-identical scores (NFR-001).

## Acceptance Criteria

## Acceptance Criteria

## Acceptance Criteria **[REQUIRED]**

- [ ] `src/scorer/normalize.ts` exports `scoreLowerBetter(value, good, bad)` and `scoreHigherBetter(value, good, bad)` returning 0–10 with 2-decimal rounding, exactly as the Detailed Design "Normalization" block: `clamp01`, `t=(value-good)/(bad-good)`, `Math.round((1-clamp01(t))*1000)/100` (lower); `t=(value-bad)/(good-bad)`, `Math.round(clamp01(t)*1000)/100` (higher). (REQ-011; reference `scoringFns.ts:7-17` with `/10` folded in)
- [ ] `src/scorer/score.ts` exports `score(m: Metrics, baselines, weights: TsWeights): ScanResult` where `MetricScore = { metric, rawP75, subScore, weight }` and `ScanResult = { score, breakdown }`. It builds the five `MetricScore`s (locPerModule, depDepth, circularDeps, complexity, fanInOut), applies `scoreLowerBetter`/`scoreHigherBetter` by each baseline's `direction`, and combines as a total-weight-normalized weighted mean: `score = Σ(weight*subScore)/Σweight`, rounded `Math.round(score*100)/100`. (REQ-012; Detailed Design "Scorer Combination")
- [ ] Under equal weights the overall equals the plain mean of the five sub-scores (asserted in tests). Normalizing by `totalW` keeps non-equal weights possible via config only. (REQ-012)
- [ ] Values at/below `good` → sub-score 10; at/above `bad` → 0; mid-range interpolates linearly (for `lower-better`). (REQ-011)
- [ ] Determinism: no `Map`/`Set` iteration affecting the result; fixed metric ordering; single rounding step per value (NFR-001).
- [ ] Golden tests in `test/scorer.test.ts`: fixed metrics + fixed baselines/weights → exact 0–10 score and breakdown; boundary cases at/below good (→10) and at/above bad (→0); mid-range interpolation; assert overall == plain mean under equal weights. (Testing Strategy → Scorer determinism)

## Implementation Notes **[CONDITIONAL: Technical Task]**

### Execution profile
`Recommended Agent: opus + medium`

Small surface but the determinism-critical rounding/normalization must be exact. The formulas are given verbatim; the risk is a rounding or normalization-order mistake.

### Technical Approach
- Copy the normalization functions from the Detailed Design "Normalization (`scorer/normalize.ts`)" verbatim, including the `*1000/100` constant (the 0–100 `*10000/100` with the `/10` rescale folded in for a single rounding step — avoids double-rounding drift; see `code-audit-report.md:478-505`).
- All five active metrics are `lower-better`; `scoreHigherBetter` is retained for seam-completeness/future baselines but not exercised by the default five. The logarithmic LOC-scale function and the `roots`/`orphan`/`edges` metrics are explicitly dropped.
- `score.ts`: use the `mk(name, value, baseline, weight)` helper that dispatches on `baseline.direction`. Combine per the Detailed Design "Scorer Combination" block exactly (normalize by `totalW`). Define/import `Metrics`, `Baselines`, `TsWeights` types (from `metrics/` and `config/`).
- `scorer/` depends on `config/` (baselines/weights types) and `metrics/` (values) only.

### Dependencies
Depends on: CIHA-T-0002 (`baselines`/`weights.ts` types + default values), CIHA-T-0006 (`Metrics` shape). Blocks: CIHA-T-0008 (`scan()` calls `score` and returns `ScanResult`).

### Risk Considerations
- Guard the `bad === good` degenerate baseline (division by zero in `t`): with the ported table this never occurs, but a defensive clamp/guard keeps NFR-004/NFR-001 intact if a user supplies equal good/bad.
- Keep exactly one rounding step per sub-score and one for the overall; extra rounding causes cross-machine drift.

## Verification Steps **[REQUIRED]**

```
npm run lint && npm run typecheck && npm test
```

Success proof:
- `test/scorer.test.ts` golden cases pass: exact overall score + breakdown for a fixed metrics/baselines/weights triple; boundaries (→10 / →0); mid-range interpolation; overall == mean of sub-scores under equal weights.
- Re-running the suite yields identical numbers (determinism).
- Lint/typecheck exit 0 with no escape hatches.

## Status Updates **[REQUIRED]**

*To be added during implementation*