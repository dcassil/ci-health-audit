---
id: docs-readme-update-for-projects
level: task
title: "Docs: README update for projects config + migration"
short_code: "CIHA-T-0023"
created_at: 2026-08-01T00:13:10.907582+00:00
updated_at: 2026-08-01T01:04:04.792203+00:00
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

# Docs: README update for projects config + migration

*This template includes sections for various types of tasks. Delete sections that don't apply to your specific use case.*

## Parent Initiative **[CONDITIONAL: Assigned Task]**

[[CIHA-I-0003]]

## Objective **[REQUIRED]**

Document the new projects model for users. Update the README to explain the `projects` config shape and per-project override merge semantics, the fail-if-any gate behavior with the mean headline, and a clear migration guide from the v0.1 flat single-root config to v0.2.0 (including the migration error users will hit and how to resolve it). This is the reference the migration error points at and the first thing new users read.

## Acceptance Criteria

## Acceptance Criteria

## Acceptance Criteria **[REQUIRED]**

- [ ] The README documents the v0.2.0 `projects` config shape: the shared top-level defaults and each project's `name`, `srcDir`, `lastScore`, and optional `threshold`/`weights`/`baselines` overrides (REQ-001).
- [ ] The README explains the per-project override merge semantics: `threshold` scalar replace; `weights`/`baselines` deep-merge per field.
- [ ] The README explains the gate semantics: each project evaluated against its own floor, overall fail-if-any, and the mean as the report-only headline (REQ-005, REQ-004).
- [ ] A migration section walks users from the v0.1 flat single-root config to v0.2.0, shows the exact migration error text they will see, and gives the fix (add a `projects` array or run `ciha init`) (REQ-002, NFR-004).
- [ ] The `init` auto-discovery behavior (npm/pnpm workspaces, single-root fallback) is documented (REQ-007).
- [ ] All README code/config examples are valid against the v0.2.0 schema.

## Documentation Sections **[CONDITIONAL: Documentation Task]**

### User Guide Content
- **Feature Description**: Per-project scoring lets a single config score every package/app in a repo independently, each with its own baseline and regression gate; a non-monorepo is just a one-project list.
- **Prerequisites**: ci-health-audit v0.2.0 or later; a `projects`-shaped config (produced by `ciha init` or hand-written).
- **Step-by-Step Instructions**:
  1. Run `ciha init` to auto-discover workspaces and write a `projects` config, or add a `projects` array by hand.
  2. Run `ciha scan` to see per-project scores and the mean headline.
  3. Wire `ciha gate` (or the action at `@v0.2.0`) into CI to fail on any per-project regression.

### Troubleshooting Guide
- **Legacy config rejected**: A flat single-root config (top-level `srcDir`/`lastScore`, no `projects`) now errors. Add a `projects` array or run `ciha init`.
- **A workspace has no score**: Its `srcDir` likely points at a directory with no source; confirm the path resolves to the package source.
- **Error Messages**: Document the exact migration-error string emitted by the loader and its resolution.

## Implementation Notes **[CONDITIONAL: Technical Task]**

### Execution profile
Recommended Agent: sonnet + low

### Technical Approach
Update the README to reflect the v0.2.0 model. Add a config-reference section with a commented `projects` example (shared defaults plus a project overriding a single metric baseline), an explanation of merge semantics, and a gate-semantics section covering fail-if-any and the mean headline. Add a clearly headed migration section that reproduces the loader's migration-error wording and the two fixes (hand-edit or `ciha init`), matching what the Phase 1 error points at. Document `init` auto-discovery. Keep examples in sync with the actual schema (Phase 1) and CLI/action output (Phases 4 and 6).

### Dependencies
Depends on Phases 1 through 6 (CIHA-T-0015 through CIHA-T-0020) so the documented schema, CLI output, gate semantics, and action behavior are final. Should land alongside Phase 8 (CIHA-T-0022) so the migration notes exist when the release goes out and the loader error can point at them.

### Verification steps
- Copy each README config example into a scratch file and validate it against the v0.2.0 loader with no errors.
- Confirm the documented migration-error text matches the string the Phase 1 loader actually emits.
- Confirm the gate/mean description matches the Phase 3/Phase 4 behavior.
- Run any repo markdown lint/link check if present.

### Risk Considerations
- Docs drifting from the real schema/output; mitigate by validating every example against the shipped loader and cross-checking output snippets against Phases 4 and 6.
- Migration-error text in docs diverging from the code string; mitigate by copying the exact string from the Phase 1 implementation.

## Status Updates **[REQUIRED]**

- **Completed** (sonnet + low agent): README rewritten for v0.2.0 — split config reference into shared top-level defaults vs per-project `projects[*]` fields with merge semantics, two copy-pasteable examples (monorepo w/ override + minimal single-project), per-project scan report + `--json` shape, fail-if-any gate section with per-project seeding/write-back, `init` auto-discovery section, updated score-pipeline diagram, and a "Migrating from v0.1 → v0.2" section (verbatim loader error text + before/after diff + `ciha init --force` path). Action `uses:` refs bumped to `@v0.2.0`.
- **Verification:** every documented config field checked against `src/config/schema.ts`; both example JSON blocks parse. (The `@v0.2.0` tag itself is cut in Phase 8.)