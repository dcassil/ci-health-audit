---
id: phase-8-release-v0-2-0-migrate
level: task
title: "Phase 8: Release v0.2.0 + migrate consumer configs/workflows"
short_code: "CIHA-T-0022"
created_at: 2026-08-01T00:13:10.103972+00:00
updated_at: 2026-08-01T01:19:29.014401+00:00
parent: CIHA-I-0003
blocked_by: []
archived: false

tags:
  - "#task"
  - "#phase/active"


exit_criteria_met: false
strategy_id: NULL
initiative_id: CIHA-I-0003
---

# Phase 8: Release v0.2.0 + migrate consumer configs/workflows

*This template includes sections for various types of tasks. Delete sections that don't apply to your specific use case.*

## Parent Initiative **[CONDITIONAL: Assigned Task]**

[[CIHA-I-0003]]

## Objective **[REQUIRED]**

Ship the breaking change and migrate every live consumer. Cut the v0.2.0 MAJOR release, then rewrite the 8 deployed consumer configs to the `projects` shape — `colab` and `code-audit` become multi-project and are re-baselined (code-audit now covering its `apps/` half), the other 6 become single-project — and bump each consumer workflow to reference the action at `@v0.2.0`. This completes the rollout so the unified model is what runs in production.

## Acceptance Criteria

## Acceptance Criteria **[REQUIRED]**

- [ ] Version is bumped to v0.2.0 (MAJOR) and a `v0.2.0` git tag is cut for the published action and npm package (NFR-004).
- [ ] All 8 deployed consumer configs are rewritten to the `projects` shape: `colab` and `code-audit` become multi-project (code-audit now also covering its `apps/` half) and are re-baselined; the other 6 become single-project.
- [ ] Each consumer workflow is bumped to reference the action at `@v0.2.0`.
- [ ] Each migrated consumer config validates under the v0.2.0 loader (no migration error) and a first `scan`/`gate` seeds/updates baselines as expected.
- [ ] A short release/changelog entry records the breaking change and points at the migration notes.

## Implementation Notes **[CONDITIONAL: Technical Task]**

### Execution profile
Recommended Agent: sonnet + medium

### Technical Approach
Cut the release first: bump the package version to 0.2.0, update the changelog with the breaking-change note, and tag `v0.2.0` so the composite action and npm package resolve to the new shape. Then migrate consumers one repo at a time: rewrite each config from the flat single-root shape to the `projects` array. For `colab` (three workspaces) and `code-audit` (add the `apps/*` projects: `cli`, `dashboard`, `mcp`, `runner`, `server` alongside `packages`), define one project per package and re-baseline by running a local `scan` to seed each `lastScore`. For the other 6 repos, wrap the existing single root as a one-project list preserving the current baseline. Bump each consumer workflow reference to `@v0.2.0`. Validate every migrated config against the v0.2.0 loader. See the initiative's Context and Alternatives (the unify decision and the 8 live configs).

### Dependencies
Depends on all engine/CLI/action phases landing first: Phases 1 through 7 (CIHA-T-0015 through CIHA-T-0021) and Phase 6 (CIHA-T-0020). Do not tag until integration tests (Phase 7) are green. Docs (CIHA-T-0023) should ideally land alongside so the migration notes referenced by the loader error exist at release.

### Verification steps
- Confirm `v0.2.0` tag exists and the action/package resolve to it.
- For each of the 8 consumers: run `ciha scan`/`gate` against the migrated config and confirm no migration error, expected per-project output, and baseline seeding.
- Confirm `code-audit` now reports scores for `apps/` projects it previously ignored.
- Trigger one consumer PR and confirm the action runs at `@v0.2.0` with the per-project summary.

### Risk Considerations
- Re-baselining could mask a genuine current regression; mitigate by reviewing seeded scores against expectations before committing each consumer config.
- Mis-mapped `srcDir` for a workspace produces a wrong/empty score; mitigate by validating each project path resolves to real source before seeding.
- Tagging before integration tests are green ships a broken action; mitigate by gating the tag on Phase 7 passing.
- Coordinating 8 repos is error-prone; mitigate by migrating and verifying one repo at a time with a checklist.

## Status Updates **[REQUIRED]**

*To be added during implementation*