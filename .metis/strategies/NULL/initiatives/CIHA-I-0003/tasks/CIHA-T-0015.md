---
id: phase-1-config-schema
level: task
title: "Phase 1: Config schema + resolveProjects"
short_code: "CIHA-T-0015"
created_at: 2026-08-01T00:11:12.921535+00:00
updated_at: 2026-08-01T00:35:50.397274+00:00
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

# Phase 1: Config schema + resolveProjects

## Parent Initiative **[CONDITIONAL: Assigned Task]**

[[CIHA-I-0003]]

## Objective **[REQUIRED]**

Establish the load-bearing config substrate for per-project scoring. This task extends the config schema with a `projects` array plus per-project optional overrides, and implements `resolveProjects`, which deep-merges each project's overrides over the shared top-level defaults to produce an array of effective single-project configs the existing engine can consume unchanged. It also introduces the explicit legacy-config migration error so old flat single-root configs fail loudly instead of silently coercing. Every later phase depends on the types and resolver produced here.

## Acceptance Criteria

## Acceptance Criteria

## Acceptance Criteria **[REQUIRED]**

- [ ] `config/schema.ts` adds a required non-empty `projects` array; each entry has `name`, `srcDir`, `lastScore`, plus optional `threshold`, `weights`, and `baselines` override fields (REQ-001).
- [ ] The top-level shared `threshold`, `weights`, and `baselines` remain valid as defaults; unknown keys are rejected by the schema.
- [ ] Validation enforces: `projects` non-empty; `name` unique and non-empty across projects; `srcDir` required and non-empty; `lastScore` a number in the range 0 through 10 inclusive.
- [ ] `loadConfig` throws a readable migration error when the parsed config has a top-level `srcDir` or `lastScore` and no `projects`, instructing the user to supply a `projects` array (each entry carrying `name`, `srcDir`, `lastScore`) or run `ciha init`, and pointing at the v0.2.0 migration notes (REQ-002, NFR-004).
- [ ] `config/resolveProjects.ts` (new) exports `resolveProjects(config)` returning effective single-project configs in declared config order (NFR-001).
- [ ] Merge semantics: `threshold` is scalar replace; `weights.ts` and `baselines` deep-merge per field so a project may override a single metric baseline without restating the other four; the result is shape-identical to today's single-root `Config` (`EffectiveProjectConfig`).
- [ ] `ProjectConfig` and `EffectiveProjectConfig` types are exported for downstream phases.
- [ ] Unit tests cover: merge precedence, per-field baseline override, unique-name rejection, missing-`srcDir` rejection, `lastScore` range rejection, and the legacy-config migration error. New module lines/branches at the repo's ~100% bar.

## Implementation Notes **[CONDITIONAL: Technical Task]**

### Execution profile
Recommended Agent: opus + high

### Technical Approach
Extend the existing Zod config schema in `config/schema.ts`. Model `ProjectConfig` with required `name`/`srcDir`/`lastScore` and optional `threshold`/`weights`/`baselines` mirroring the shared top-level shapes. Keep top-level `threshold`/`weights`/`baselines` as the shared defaults and add `projects` as a required non-empty array. Use `.strict()` (or equivalent) so unknown keys are rejected.

In `config/resolveProjects.ts`, for each project start from the shared top-level `threshold`, `weights`, and `baselines`, then apply the project's overrides: `threshold` replaces wholesale; `weights.ts` merges per metric key; `baselines` merges per metric so overriding one metric baseline preserves the other four. Emit an `EffectiveProjectConfig` byte-identical in shape to today's single-root `Config` so `scanOne` (Phase 2) needs zero project awareness. Preserve declared order (no Map/Set iteration in the result path) to satisfy NFR-001.

Place the legacy-config detection in the loader (`loadConfig`): after parse, if `srcDir` or `lastScore` is present at top level and `projects` is absent, throw the migration error before schema validation so the user sees the guidance rather than a generic Zod failure. See the initiative's Detailed Design (Merge semantics, Migration error) for exact behavior.

### Dependencies
None — this is the first phase and the substrate every later phase consumes. No sibling task must land first.

### Verification steps
- Run the new unit test files for `resolveProjects` and schema validation; confirm all pass.
- Confirm a fixture legacy flat config (top-level `srcDir`, no `projects`) triggers the migration error with the expected wording.
- Confirm a multi-project config with a single per-metric baseline override resolves with the other four baselines intact.
- Run the repo lint and typecheck (`npm run lint`, `npm run typecheck` or equivalent) with zero errors.
- Confirm a one-project config resolves to a single `EffectiveProjectConfig` equal in shape to a v0.1 single-root `Config`.

### Risk Considerations
- Deep-merge subtlety: a shallow merge of `baselines`/`weights` would silently wipe non-overridden metrics. Mitigate with explicit per-field merge and a dedicated test asserting the other four survive.
- Migration-error placement: validating before detecting the legacy shape yields a confusing Zod error. Mitigate by detecting the legacy shape first in `loadConfig`.
- Schema strictness could reject valid future fields; scope strictly to the v0.2.0 shape defined in the initiative and add fields only when a later phase needs them.

## Status Updates **[REQUIRED]**

- **Completed** (opus + high agent): Unified config model landed. Added `src/config/resolveProjects.ts` (`resolveProjects` → `EffectiveProjectConfig[]`, deep-merge overrides over shared defaults, per-field baseline/weight merge, pure/order-preserving). Rewrote `src/config/schema.ts` to the `projects` model (`configFileSchema`/`ConfigFile`, `projectConfigSchema`/`ProjectConfig`, `EffectiveProjectConfig`, `.strict()`, unique-name refine, `lastScore` range, `DEFAULT_CONFIG` = shared defaults). `loadConfig.ts` rejects legacy flat configs with a migration error. New/updated tests incl. `test/resolveProjects.test.ts` and a full validation matrix in `test/config.test.ts`.
- **Gates:** `npm run lint`, `npm run typecheck`, `npm test` (159 passed / 16 files), and `npm run build` all green. No lint/TS rule weakening; no `any`/ts-ignore.
- **Shims flagged for later phases** (intentional, minimal, must be replaced): (1) `scanWithRawConfig` + `src/cli/loadConfigFile.ts` use only `projects[0]` → replace in Phase 2/4; (2) `init.ts` `SCAFFOLD_CONFIG` emits single default project → replace in Phase 5; (3) `writeConfig.ts` `writeLastScore` writes `projects[0].lastScore` → replace with multi-project `writeLastScores` in Phase 3.