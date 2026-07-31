---
id: phase-3-scanner-seam-plugin
level: task
title: "Phase 3: Scanner seam & plugin registry"
short_code: "CIHA-T-0003"
created_at: 2026-07-31T18:26:15.795659+00:00
updated_at: 2026-07-31T19:01:18.368927+00:00
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

# Phase 3: Scanner seam & plugin registry

## Parent Initiative **[CONDITIONAL: Assigned Task]**

[[CIHA-I-0001]]

## Objective **[REQUIRED]**

Port the `ToolPlugin` scanner seam and a language-keyed `PluginRegistry` from the reference, trimmed to what the standalone tool needs. This is the extensibility substrate that delivers the vision's "add a language later = new plugin + weights entry, no core change" promise. Define the shared types (`ToolPlugin`, `ScanContext`, `ToolRunOutput`, `CommandRunner`, `ModuleEntry`, `Edge`, `FileStats`, `Language`, `ToolSupport`) and a registry whose `resolve(language)` returns the first plugin supporting that language.

## Acceptance Criteria

## Acceptance Criteria

## Acceptance Criteria **[REQUIRED]**

- [ ] `src/scanner/types.ts` defines exactly the types from the Detailed Design "Scanner Seam": `Language = "ts" | "js" | "typescript" | "javascript"`, `ToolSupport { languages?: Language[] }`, `CommandRunner { run(command: string, cwd: string): string }`, `ScanContext { srcDir: string; config: Config; runner: CommandRunner }`, `ModuleEntry { source: string; dependencies: string[] }`, `Edge { fromPath: string; toPath: string }`, `FileStats { path: string; loc: number; complexity: number }`, `ToolRunOutput { raw: unknown; fileStats: FileStats[]; modules: ModuleEntry[]; edges: Edge[] }`, and `ToolPlugin { readonly id: string; readonly supports: ToolSupport; run(ctx: ScanContext): Promise<ToolRunOutput> }`. (REQ-003)
- [ ] `src/scanner/registry.ts` implements `PluginRegistry` with `register(plugin: ToolPlugin): void` and `resolve(language: Language): ToolPlugin` returning the first registered plugin whose `supports.languages` includes that language (mirroring reference `registry.ts:55-67`). (REQ-003)
- [ ] `resolve` throws a typed, descriptive error when no plugin supports the language (NFR-004) rather than returning `undefined`.
- [ ] The seam is untouched beyond trimming — no `ProjectType`/`types`, `timeout`, or repo-config fields from the reference (those are dropped per the initiative's trim).
- [ ] Unit tests in `test/scanner` (or `test/registry.test.ts`) prove: a registered plugin with `supports.languages: ["ts","js","typescript","javascript"]` resolves for each of the four aliases; an unsupported language throws; first-match wins when two plugins support the same language. (REQ-004 verification of resolution; the actual TS plugin registration is asserted in Phase 4/8.)

## Implementation Notes **[CONDITIONAL: Technical Task]**

### Execution profile
`Recommended Agent: opus + medium`

The extensibility seam is load-bearing for the vision's "add a language" promise; getting the interface shape right avoids a later cross-cutting refactor, but the surface is small and the design is fully specified.

### Technical Approach
- Port from reference `apps/runner/src/plugins/tools/interface.ts:9-22` and `registry.ts:55-67` (see `code-audit-report.md:62-135`), trimming to the initiative's Scanner Seam block.
- `CommandRunner.run` returns stdout as a string synchronously — this is the injectable seam (NFR-006) that Phase 4 mocks and Phase 8 backs with a real `execSync` implementation. Do NOT put `execSync` in the core seam here; only the interface.
- Registry stores plugins in registration order (array), `resolve` does `find(p => p.supports.languages?.includes(language))`.
- Import the `Config` type from `../config/schema.js` (NodeNext `.js` extension) for `ScanContext`.
- `scanner/` depends on nothing internal except the `Config` type (Component Diagram).

### Dependencies
Depends on: CIHA-T-0001 (tooling), CIHA-T-0002 (`Config` type for `ScanContext`). Blocks: CIHA-T-0004 (TS plugin implements `ToolPlugin`, produces `ToolRunOutput`), CIHA-T-0005 (graph builder consumes `ModuleEntry`/`Edge`/`FileStats`), CIHA-T-0008 (registry wired in `scan()`).

### Risk Considerations
- Keep `run` returning `Promise<ToolRunOutput>` even though `CommandRunner.run` is sync — the plugin body does sync exec but its async signature keeps the seam open for future async tools without a breaking change.

## Verification Steps **[REQUIRED]**

```
npm run lint && npm run typecheck && npm test
```

Success proof:
- Registry tests pass: four TS/JS aliases resolve to the registered plugin; unknown language throws a descriptive `Error`; first-match ordering verified.
- Typecheck confirms the exact type shapes compile under strict + NodeNext.
- No escape hatches; lint/typecheck exit 0.

## Status Updates **[REQUIRED]**

*To be added during implementation*