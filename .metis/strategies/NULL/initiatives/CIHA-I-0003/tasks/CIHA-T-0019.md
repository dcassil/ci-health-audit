---
id: phase-5-init-auto-discovery-prompt
level: task
title: "Phase 5: init auto-discovery + prompt fallback"
short_code: "CIHA-T-0019"
created_at: 2026-08-01T00:13:08.772192+00:00
updated_at: 2026-08-01T00:58:34.248333+00:00
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

# Phase 5: init auto-discovery + prompt fallback

*This template includes sections for various types of tasks. Delete sections that don't apply to your specific use case.*

## Parent Initiative **[CONDITIONAL: Assigned Task]**

[[CIHA-I-0003]]

## Objective **[REQUIRED]**

Make `ciha init` monorepo-aware. Auto-discover workspaces from `package.json` `workspaces` (array or object form) and `pnpm-workspace.yaml`, expand globs to directories containing a `package.json`, and write one project per workspace with shared default weights/baselines/threshold and `lastScore: 0`. When no workspaces are found, fall back to a single root project, or to an interactive TTY prompt to confirm/add projects. Discovery runs once at setup so the persisted `projects` list is the sole runtime source of truth.

## Acceptance Criteria

## Acceptance Criteria

## Acceptance Criteria **[REQUIRED]**

- [ ] `cli/commands/init.ts` reads `package.json` `workspaces` in both forms — an array, or an object with a `packages` array — and `pnpm-workspace.yaml` `packages:` (REQ-007).
- [ ] Globs from both sources are unioned and expanded to directories that contain a `package.json` (REQ-007).
- [ ] Each discovered workspace becomes one project: `name` is that package's `name` (fallback to the directory basename), `srcDir` is the package directory, `lastScore` is 0, with shared default weights/baselines/threshold from `DEFAULT_CONFIG` (REQ-007).
- [ ] When no workspaces are found, fall back to a single project named `.` with `srcDir` `./src` and `lastScore` 0; when `stdout.isTTY`, instead prompt interactively to confirm or add projects (REQ-007).
- [ ] `--force` overwrites an existing config; without it an existing config is not clobbered.
- [ ] Discovery is a setup-time action only — no discovery runs during `scan`/`gate` (NFR-001).
- [ ] Unit tests cover: npm array workspaces, npm object workspaces, pnpm-workspace.yaml, and the none→single-root fallback, with filesystem and TTY seams injected/faked.

## Implementation Notes **[CONDITIONAL: Technical Task]**

### Execution profile
Recommended Agent: opus + medium

### Technical Approach
In `cli/commands/init.ts`, add a discovery step: parse `package.json` `workspaces` (array or object-with-`packages`) and `pnpm-workspace.yaml` `packages:`, union the glob lists, expand globs to directories, and keep only those containing a `package.json`. For each, read the package `name` (fallback to dir basename) and set `srcDir` to the package directory so scc/depcruise walk the whole package. Assemble a config with shared `DEFAULT_CONFIG` weights/baselines/threshold and one project per workspace at `lastScore` 0. When discovery yields nothing, write a single root project (`.`, `./src`, 0), or — when `stdout.isTTY` — prompt to confirm/add projects. Respect `--force` for overwrite. Keep filesystem reads and TTY/prompt behind injectable seams so tests avoid real IO. See the initiative's Detailed Design (`init` discovery).

### Dependencies
Depends on Phase 1 (CIHA-T-0015) for the `projects` schema and `DEFAULT_CONFIG` shared defaults so the written config validates. Independent of Phases 2 through 4 at the code level, but ordered after them per the initiative's dependency sequencing.

### Verification steps
- Run the `init` discovery unit tests (npm array, npm object, pnpm yaml, none→single root); confirm all pass.
- Run `ciha init` in a scratch npm workspaces repo and confirm one project per package with correct `name`/`srcDir`.
- Run `ciha init` in a scratch pnpm-workspace repo and confirm the same.
- Run `ciha init` in a non-monorepo and confirm the single-root fallback; confirm `--force` overwrites and the default (no force) does not clobber.
- Run repo lint and typecheck with zero errors.

### Risk Considerations
- Glob expansion pulling in dirs without a `package.json` (e.g. build output); mitigate by filtering strictly on `package.json` presence.
- Non-determinism from filesystem iteration order; mitigate by sorting discovered directories before writing so repeated runs produce identical configs.
- TTY prompt hanging in CI; mitigate by gating the prompt on `stdout.isTTY` and defaulting to the single-root fallback otherwise.

## Status Updates **[REQUIRED]**

- **Completed** (opus + medium agent): Replaced the `init` scaffold shim with real discovery. New `src/cli/discoverWorkspaces.ts` (`discoverWorkspaces(fs, root)`, fs-injected/pure) reads npm `workspaces` (array + object forms) and `pnpm-workspace.yaml` `packages:` (minimal line parser, no new dep), unions + expands globs (exact, `*`, `**`) to dirs containing a `package.json`, resolves `name` from manifest (basename fallback), sorted for determinism. `init.ts` gained an `InitDeps` seam (fs/root/isTty/prompt): discovered workspaces → one project each; none found → silent single-root `.`/`./src` fallback, with a TTY-gated prompt only when interactive + prompt seam present (CI/tests never block). Overwrite/`--force` exit codes preserved.
- **Gates:** lint + typecheck clean; `npm test` 193 passed / 17 files; new module ~100% covered. No new dependency. No rule weakening; no `any`/ts-ignore.