---
id: phase-4-js-ts-plugin-parsers
level: task
title: "Phase 4: JS/TS plugin parsers & runners"
short_code: "CIHA-T-0004"
created_at: 2026-07-31T18:26:16.879125+00:00
updated_at: 2026-07-31T19:05:31.511446+00:00
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

# Phase 4: JS/TS plugin parsers & runners

## Parent Initiative **[CONDITIONAL: Assigned Task]**

[[CIHA-I-0001]]

## Objective **[REQUIRED]**

Implement the JS/TS `ToolPlugin` (`id: "ts"`, `supports.languages: ["ts","js","typescript","javascript"]`). Build the pure parsers first (`parseScc`, `parseDepcruise`) unit-tested against canned JSON, then wire the runners (`runScc`, `runDepcruise`) through the injected `CommandRunner`, including the upward `tsconfig.json` search. The plugin returns a fully-typed `ToolRunOutput { raw, fileStats, modules, edges }` with externals filtered and edges deduped exactly as the reference does.

## Acceptance Criteria

## Acceptance Criteria

## Acceptance Criteria **[REQUIRED]**

- [ ] `src/plugins/ts/scc.ts` exports `parseScc(json): FileStats[]` (pure) and `runScc(ctx): FileStats[]`. `parseScc` keeps only recognized code languages (JavaScript, TypeScript, JSX, TSX, TypeScript Typings — reference `scc.ts:124-130`, retained broader set OK, only JS/TS relevant) and records `{ path, loc: Code, complexity: Complexity }` per file (reference `scc.ts:101-107`). `runScc` shells `scc --by-file --format json "<srcDir>"` via `ctx.runner.run`. (REQ-005)
- [ ] `src/plugins/ts/depcruise.ts` exports `parseDepcruise(json): { modules: ModuleEntry[]; edges: Edge[] }` (pure) and `runDepcruise(ctx)`. `parseDepcruise` parses `output.modules`, normalizes source/dependency paths, filters externals with the reference predicate `filePath.includes("node_modules") || filePath.startsWith("node:") || !filePath.includes("/")` (reference `depcruise.ts:162-164`), and dedupes edges by `sourcePath|normalizedDep`. (REQ-006)
- [ ] `runDepcruise` searches upward from `srcDir` for `tsconfig.json` (reference `depcruise.ts:141-153`) and shells `depcruise --no-config --ts-pre-compilation-deps <tsConfigArg> --exclude "node_modules" --output-type json "<srcDir>/**/*.ts" "<srcDir>/**/*.tsx" "<srcDir>/**/*.js" "<srcDir>/**/*.jsx"` (reference `depcruise.ts:50-63`). (REQ-006)
- [ ] `src/plugins/ts/plugin.ts` exports `TsToolPlugin` implementing `ToolPlugin`; `run(ctx)` composes `runScc` + `runDepcruise` into `ToolRunOutput`. (REQ-004)
- [ ] All external tool JSON is parsed through typed, validated parsers (no `any`/`unknown` cast-through). Malformed/unparseable tool output and non-zero exits surface as typed, descriptive errors, not silent zeros. (NFR-003, NFR-004)
- [ ] Empty/degenerate inputs (no files, no modules, no edges) produce empty `FileStats[]`/`modules`/`edges` without throwing. (NFR-005)
- [ ] Unit tests in `test/plugins` feed canned `scc` and `depcruise` JSON through the parsers via a mocked `CommandRunner` (NFR-006), asserting `FileStats`, code-language filtering, external filtering, path normalization, and edge dedup. Fixtures live under `test/fixtures/`. (Testing Strategy → Plugin parsers)

## Implementation Notes **[CONDITIONAL: Technical Task]**

### Execution profile
`Recommended Agent: opus + medium`

Integration with two external tool JSON formats plus external-filter/dedup correctness. Mechanical once the formats are understood, but the filtering/dedup edge cases are easy to get subtly wrong.

### Technical Approach
- Parsers-first (TDD-friendly): write `parseScc`/`parseDepcruise` as pure functions taking already-parsed JSON (or a string they `JSON.parse` and validate), so they are unit-testable without the binaries.
- Validate external JSON shape with a small Zod schema (or hand-written type guards) rather than casting — NFR-003 forbids `any`/`unknown` cast-through. Parse `scc` language groups and per-file `Code`/`Complexity`; parse `depcruise` `output.modules[].source` + `.dependencies[].resolved`.
- Path normalization + external filter: reference `depcruise.ts:95-139` and predicate at `:162-164` (see `code-audit-report.md:211-226`). Dedup edges with a `Set` keyed `sourcePath|normalizedDep`.
- `tsconfig.json` upward search: walk parent dirs from `srcDir` until found or filesystem root; pass `--ts-config <path>` (the `tsConfigArg`) when found, empty otherwise (reference `depcruise.ts:141-153`).
- The real `execSync`-backed `CommandRunner` is created in Phase 8's `scan()` wiring; here the plugin only *uses* `ctx.runner`. Wrap `ctx.runner.run` failures (thrown by exec) into descriptive typed errors naming the missing binary (`scc`/`depcruise`) per NFR-004.
- Reference command/parse details: `scc.ts:41-50`, `scc.ts:101-107`, `depcruise.ts:50-63` (see `code-audit-report.md:159-226`).

### Dependencies
Depends on: CIHA-T-0001 (tooling), CIHA-T-0003 (`ToolPlugin`/`ScanContext`/`ToolRunOutput`/`CommandRunner`/`FileStats`/`ModuleEntry`/`Edge` types). Blocks: CIHA-T-0008 (`scan()` calls `TsToolPlugin.run`, integration test uses real runners). Produces the `ToolRunOutput` that CIHA-T-0005's `buildGraph` consumes.

### Risk Considerations
- `depcruise` dependency entries can be `resolved`, `module`, or coreModule flags — normalize on `resolved` and apply the external predicate; do not accidentally keep `node:`/bare-specifier deps.
- Keep the code-language filter exact so non-code files (config, markdown) never enter `FileStats`.

## Verification Steps **[REQUIRED]**

```
npm run lint && npm run typecheck && npm test
```

Success proof:
- Parser tests pass against committed `test/fixtures/` `scc`/`depcruise` JSON: correct `FileStats`, language filtering, external filtering, path normalization, deduped edges.
- Degenerate-input tests (empty JSON) return empty arrays without throwing.
- A malformed-JSON test asserts a descriptive `Error` is thrown (NFR-004).
- Lint/typecheck exit 0 with no escape hatches; external JSON is validated, not cast.

## Status Updates **[REQUIRED]**

*To be added during implementation*