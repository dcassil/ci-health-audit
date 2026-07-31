---
id: phase-8-scan-orchestrator
level: task
title: "Phase 8: scan() orchestrator & integration test"
short_code: "CIHA-T-0008"
created_at: 2026-07-31T18:26:21.537569+00:00
updated_at: 2026-07-31T19:30:05.728042+00:00
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

# Phase 8: scan() orchestrator & integration test

## Parent Initiative **[CONDITIONAL: Assigned Task]**

[[CIHA-I-0001]]

## Objective **[REQUIRED]**

Wire every stage into the single top-level `scan()` entrypoint (config → resolve plugin → run plugin → build graph → compute metrics → score → `ScanResult`), provide the real `execSync`-backed `CommandRunner`, register `TsToolPlugin`, and re-export the public API from `src/index.ts`. Add the end-to-end integration test on a committed fixture repo with a pinned expected score. Exit criterion: a real JS/TS repo yields a stable, reproducible 0–10 score with a full per-metric breakdown, entirely as a library — ready for CIHA-I-0002 to add runtimes.

## Acceptance Criteria

## Acceptance Criteria

## Acceptance Criteria **[REQUIRED]**

- [ ] `src/index.ts` exports `scan(config, opts?)` that: accepts an already-validated `Config` or raw JSON (running raw through `loadConfig` first); resolves the plugin via `registry.resolve(config.language)`; builds `ScanContext { srcDir, config, runner }` (default runner = real `execSync` runner, overridable via `opts.commandRunner` for tests, NFR-006); calls `plugin.run(ctx)`; `buildGraph`; `computeMetrics`; `score`; returns `ScanResult { score, breakdown }` (plus raw metric values). No writes, no exits, no network (NFR-002). (REQ-014)
- [ ] `TsToolPlugin` is registered in the default registry and is the plugin resolved for `language: "ts"`. (REQ-004)
- [ ] A real `CommandRunner` implementation using `execSync` (returning stdout, throwing on non-zero exit) is provided; its failures for missing `scc`/`depcruise` surface as typed, descriptive errors (NFR-004).
- [ ] `src/index.ts` re-exports the public surface: `scan`, `ScanResult`/`MetricScore`, `Config`/`configSchema`/`loadConfig`/`defaultConfig`, the `ToolPlugin`/registry types, and the `TsToolPlugin`.
- [ ] `test/integration/fixture-repo/` is a committed tiny TS repo (~5–8 modules) including one deliberate 2-module cycle and one deep chain. An integration test runs the REAL `TsToolPlugin` (real `scc` + real `depcruise`) end-to-end and asserts the overall score is within a tight tolerance of a pinned expected value and that breakdown raw p75 values match expected. (Testing Strategy → Integration Testing)
- [ ] The integration test `skip`s (not fails) with a clear message when `scc`/`depcruise` are not on `PATH`; CI installs both so it actually runs there. Tool versions are pinned/recorded for snapshot stability (NFR-001).
- [ ] Empty/degenerate real inputs (empty srcDir, single-file repo) do not throw and yield documented degrade values end-to-end (NFR-005).

## Implementation Notes **[CONDITIONAL: Technical Task]**

### Execution profile
`Recommended Agent: opus + medium`

Wires all stages and validates against the real tools. Each piece is already built and tested; the risk is in the wiring and the integration-test snapshot, which is integration work following the established sequence.

### Technical Approach
- Follow the initiative's "Sequence of a single scan" (steps 1–10) exactly.
- Real runner: `class ExecCommandRunner implements CommandRunner { run(command, cwd) { return execSync(command, { cwd, encoding: "utf8", ... }); } }`. Wrap in try/catch to rethrow a descriptive error naming the binary when exec fails (NFR-004). This is the ONLY impure default; tests inject a canned runner (NFR-006).
- `scan(config, opts)`: `const cfg = isRawJson(config) ? loadConfig(config) : config;` build registry (register `TsToolPlugin`), resolve, run, `buildGraph(output.modules, output.edges, output.fileStats)`, `computeMetrics(graph)`, `score(metrics, cfg.baselines, cfg.weights.ts)`, return.
- Fixture repo: hand-author 5–8 `.ts` modules with a known structure (2-module cycle `a.ts↔b.ts`, a 3–4 deep import chain, one hub). Commit the expected-score snapshot; regenerating it is a deliberate reviewed action (guards against rubber-stamping a scoring regression). Pin `dependency-cruiser` (already in Phase 1) and record the `scc` version.
- Guard skip: check `scc`/`depcruise` on PATH (e.g. `which`/`--version`) and `test.skip` with a clear message if absent.

### Dependencies
Depends on: ALL prior phases — CIHA-T-0002 (`loadConfig`), CIHA-T-0003 (registry), CIHA-T-0004 (`TsToolPlugin` + real runner target), CIHA-T-0005 (`buildGraph`), CIHA-T-0006 (`computeMetrics`), CIHA-T-0007 (`score`). Blocks: nothing in this initiative — this is the exit gate; CIHA-I-0002 consumes `scan()` as a library.

### Risk Considerations
- The integration snapshot must be stable across machines given pinned tool versions (NFR-001). If `scc` version drift changes complexity numbers, the recorded version + tolerance are the mitigation; document the recorded `scc` version alongside the snapshot.
- Keep `scan()` free of side effects — no `lastScore` write-back, no exit codes (those are CIHA-I-0002). Assert absence of writes in a unit test with a mocked runner.

## Verification Steps **[REQUIRED]**

```
npm run lint && npm run typecheck && npm test && npm run build
```

With `scc` + `dependency-cruiser` installed (as CI does), also:
```
npm run test:coverage
```

Success proof:
- Unit tests pass with a mocked runner (scan wiring, no side effects, degenerate inputs).
- The integration test runs against `test/integration/fixture-repo/` with real tools and the overall score matches the pinned expected value within tolerance; breakdown raw p75 values match. Without the binaries it cleanly `skip`s with a message.
- Coverage meets the initiative targets (100% of graph/metrics/scorer/parsers; ≥90% overall).
- `npm run build` produces the library `dist/` with the public re-exports.
- Lint/typecheck exit 0 with no escape hatches.

## Status Updates **[REQUIRED]**

*To be added during implementation*