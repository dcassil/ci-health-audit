---
id: phase-6-action-yml-per-project
level: task
title: "Phase 6: action.yml per-project summary + mean output"
short_code: "CIHA-T-0020"
created_at: 2026-08-01T00:13:09.853206+00:00
updated_at: 2026-08-01T01:00:24.810855+00:00
parent: CIHA-I-0003
blocked_by: []
archived: false

tags:
  - "#task"
  - "#phase/completed"


exit_criteria_met: false
strategy_id: NULL
initiative_id: CIHA-I-0003
---

# Phase 6: action.yml per-project summary + mean output

*This template includes sections for various types of tasks. Delete sections that don't apply to your specific use case.*

## Parent Initiative **[CONDITIONAL: Assigned Task]**

[[CIHA-I-0003]]

## Objective **[REQUIRED]**

Update the GitHub Action to render per-project results and expose the mean as its headline output. Change the job-summary step in `action.yml` to print a per-project table (name, score, key metrics) and set the action's `score` output to the arithmetic mean of project scores. Refresh the example workflow so consumers see the new shape. This makes the published action surface the same per-project view as the CLI while keeping a single headline number for badges and downstream steps.

## Acceptance Criteria

## Acceptance Criteria

## Acceptance Criteria **[REQUIRED]**

- [ ] `action.yml`'s job-summary step renders a per-project table (name, score, and the key metrics), one row per project (REQ-008).
- [ ] The action's `score` output is set to the arithmetic mean of the project scores, matching the CLI's `--json` top-level `score` (REQ-008, REQ-004).
- [ ] The action reads the CLI's `--json` output as its source of truth rather than re-deriving scores.
- [ ] The example workflow is refreshed to reflect the per-project summary and the mean `score` output usage.
- [ ] `actionlint` passes on `action.yml` and the example workflow with no errors.

## Implementation Notes **[CONDITIONAL: Technical Task]**

### Execution profile
Recommended Agent: sonnet + medium

### Technical Approach
Update the summary step in `action.yml` to consume the `--json` payload produced in Phase 4 (a `projects` array plus a top-level mean `score`) and emit a GitHub job-summary markdown table with one row per project. Set the action's `score` output to the top-level mean `score` from the same JSON so the headline matches the CLI exactly (do not recompute). Update the example workflow to show the new summary and how downstream steps read the `score` output. Keep the composite action structure unchanged otherwise. See the initiative's Detailed Design (Reporting) and REQ-008.

### Dependencies
Depends on Phase 4 (CIHA-T-0018), which produces the `--json` shape (projects array + mean `score`) this step parses. Should land before Phase 8 (CIHA-T-0022) release/consumer migration so the tagged action already renders per-project summaries.

### Verification steps
- Run `actionlint` on `action.yml` and the example workflow; confirm zero errors.
- Run the action locally or in a test workflow against the Phase 7 fixture and confirm the job summary shows one row per project and a mean headline.
- Confirm the `score` output equals the CLI `--json` top-level `score` for the same run.

### Risk Considerations
- Re-deriving the mean in shell would risk drifting from the CLI value; mitigate by reading the top-level `score` straight from the JSON.
- Summary markdown breaking on projects with special characters in names; mitigate by escaping table cell content.
- Example workflow drifting from the real action inputs/outputs; mitigate by validating both with `actionlint` and a smoke run.

## Status Updates **[REQUIRED]**

- **Completed** (sonnet + medium agent + reviewer fix): `action.yml` now renders a per-project job-summary table via a bundled `scripts/summarize.py` (reads the CLI JSON from env), with graceful degradation when `projects` is missing; the `score` output reads the top-level mean `score`. Inputs/outputs/gate exit-code passthrough unchanged. Example workflow bumped to `@v0.2.0` with per-project comments.
- **Reviewer-caught bug FIXED:** the agent resolved the helper path via `BASH_SOURCE[0]`, which in a composite inline `run:` step points at GitHub's temp script, not the action dir — so the table would have silently vanished (guarded by `|| echo ""`). Changed to `${{ github.action_path }}/scripts/summarize.py`, the correct reference to the action's own checkout.
- **Verification:** `summarize.py` produces the correct 2-project table and mean from sample JSON; degrades cleanly with no `projects`. The composite `action.yml` can't be linted by actionlint (workflow-only tool); the example workflow passes actionlint with zero errors. Real end-to-end validation on live repos happens in Phase 8 after the v0.2.0 tag.