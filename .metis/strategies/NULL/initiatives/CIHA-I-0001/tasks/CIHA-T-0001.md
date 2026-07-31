---
id: phase-1-project-scaffolding-strict
level: task
title: "Phase 1: Project scaffolding & strict tooling"
short_code: "CIHA-T-0001"
created_at: 2026-07-31T18:26:15.005901+00:00
updated_at: 2026-07-31T18:58:58.422085+00:00
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

# Phase 1: Project scaffolding & strict tooling

## Parent Initiative **[CONDITIONAL: Assigned Task]**

[[CIHA-I-0001]]

## Objective **[REQUIRED]**

Stand up the single-package (NOT monorepo) TypeScript ESM npm package that every later phase builds inside, with a strict, no-escape-hatch tooling substrate: strict `tsconfig.json` (NodeNext ESM), strict ESLint (guard-rails style, no inline disables), Vitest + v8 coverage, and a build step. Pin `dependency-cruiser` as a dependency and document the `scc` binary requirement. The package must lint, typecheck, and test green on an empty skeleton so that all downstream phases (config, scanner, plugin, graph, metrics, scorer, orchestrator) inherit a working, strict foundation.

This is the load-bearing groundwork task: it establishes the strictness contract (NFR-003) that all other tasks must satisfy, and the file layout from the initiative's Detailed Design.

## Acceptance Criteria

## Acceptance Criteria

## Acceptance Criteria **[REQUIRED]**

- [ ] `package.json` exists with `"type": "module"`, a `name` (`ci-health-audit`), an `exports` map pointing at the built library entry (`./dist/index.js` + types), and `scripts` for `lint`, `typecheck`, `test`, `test:coverage`, and `build`. `bin` is intentionally omitted (owned by CIHA-I-0002). (Maps to Goals: single-package ESM package; supports NFR-003.)
- [ ] `dependency-cruiser` is pinned as a dependency (version `16.10.4`, matching the reference at `code-audit-report.md:879`); `zod`, `typescript`, `vitest`, `@vitest/coverage-v8`, and ESLint + strict-config packages are dev/runtime deps as appropriate.
- [ ] `tsconfig.json` is strict: `"strict": true`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"target": "ES2022"` (or newer), `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `outDir: "dist"`, and declaration output on. (NFR-003)
- [ ] `eslint.config.mjs` is a strict flat config with no escape hatches permitted; the rule set forbids `any`, non-null assertions where avoidable, and does not enable any rule-disabling conveniences. There are ZERO inline `eslint-disable`, `ts-ignore`, or `ts-expect-error` in the repo. (NFR-003)
- [ ] `vitest.config.ts` exists and is configured for ESM + v8 coverage; `test/` is the test root.
- [ ] The `src/` directory tree from the Detailed Design File Layout exists as empty/stub placeholders sufficient to compile: `src/index.ts` (may export nothing yet or a placeholder type), and empty directories `config/`, `scanner/`, `plugins/ts/`, `graph/`, `metrics/`, `scorer/` are created as work lands (a stub `index.ts` is enough for this phase to be green).
- [ ] A CI target (GitHub Actions workflow, e.g. `.github/workflows/ci.yml`) runs `npm ci` then lint + typecheck + unit tests, and installs `scc` + `dependency-cruiser` so later phases' integration test can run. (Supports NFR-001 determinism via pinned tool versions.)
- [ ] `npm run lint && npm run typecheck && npm test` all exit 0 on the empty skeleton.

## Implementation Notes **[CONDITIONAL: Technical Task]**

### Execution profile
`Recommended Agent: opus + high`

Foundational; every downstream task depends on the strictness substrate. A wrong choice here (loose tsconfig, permissive ESLint, wrong module resolution) creates compounding rework across all seven later phases.

### Technical Approach
- Follow the exact File Layout in the initiative's Detailed Design (`initiative.md`, "File Layout (single package, ESM)"). Target package root is `/Users/danielcassil/Code/ci-health-audit`.
- `package.json`: `"type": "module"`, `"exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }`. Scripts: `"lint": "eslint ."`, `"typecheck": "tsc --noEmit"`, `"test": "vitest run"`, `"test:coverage": "vitest run --coverage"`, `"build": "tsc"`. Do NOT add a `bin` field — the CLI is CIHA-I-0002.
- Prefer reusing the guard-rails strict `eslint.config.mjs` + `tsconfig.json` boilerplate if a Node-library/`node-api` preset is available in this environment (see guardrails skills); otherwise hand-write a strict flat config. Whichever path, the result must satisfy NFR-003 with no escape hatches. Per the user's global rules, ESLint/TS rules may not be loosened.
- Pin `dependency-cruiser` to `16.10.4` (reference: `code-audit-report.md:879`). `scc` is a Go binary the user installs; document it in a short `README`-less note is NOT allowed (README is CIHA-I-0002) — instead document the `scc` requirement as a comment in the CI workflow and in `package.json` `engines`/a `scripts` comment is not possible; put the `scc` install step in the CI workflow so it is self-documenting.
- CI workflow: install `dependency-cruiser` via `npm ci`, install `scc` via `go install github.com/boyter/scc/v3@<pinned>` or a released binary (reference Dockerfile installs scc via Go install, `code-audit-report.md:894-899`). Record the pinned `scc` version in the workflow so NFR-001 (determinism given fixed tool versions) holds.

### Dependencies
Depends on: nothing (first phase). Blocks: ALL of CIHA-T-0002 through CIHA-T-0008 — none can compile/lint/test without this substrate.

### Risk Considerations
- NodeNext ESM + strict + `exactOptionalPropertyTypes` can surface friction later (e.g. Zod inference, `.js` import extensions). Establishing it now, empty, is exactly why this is a separate first phase — surface the friction before real code depends on it.
- Do not weaken any rule to make the skeleton pass; an empty skeleton passing strict rules is the whole acceptance signal.

## Verification Steps **[REQUIRED]**

Run from the package root `/Users/danielcassil/Code/ci-health-audit`:

```
npm install
npm run lint && npm run typecheck && npm test
npm run build
```

Success proof:
- `npm run lint` exits 0 with no warnings/errors and no inline disables anywhere (`grep -rn "eslint-disable\|ts-ignore\|ts-expect-error" src test` returns nothing).
- `npm run typecheck` (`tsc --noEmit`) exits 0.
- `npm test` (Vitest) exits 0 (zero tests or a trivial passing smoke test is acceptable at this phase).
- `npm run build` produces `dist/index.js` + `dist/index.d.ts`.
- The CI workflow file exists and its lint/typecheck/test job is green when pushed (or dry-runnable locally via the same commands), and includes `scc` + `dependency-cruiser` install steps.

## Status Updates **[REQUIRED]**

*To be added during implementation*