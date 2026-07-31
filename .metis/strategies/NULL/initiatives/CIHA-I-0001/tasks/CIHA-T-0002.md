---
id: phase-2-config-schema-loader
level: task
title: "Phase 2: Config schema & loader"
short_code: "CIHA-T-0002"
created_at: 2026-07-31T18:26:15.519467+00:00
updated_at: 2026-07-31T19:01:15.351283+00:00
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

# Phase 2: Config schema & loader

## Parent Initiative **[CONDITIONAL: Assigned Task]**

[[CIHA-I-0001]]

## Objective **[REQUIRED]**

Define and validate the `ci-health-audit.config.json` schema with Zod, expose the inferred `Config` type, and implement `loadConfig(raw)` that parses, applies defaults (`lastScore=0`, `threshold=-2`, `srcDir="./src"`), and rethrows Zod errors as a single readable message. Ship a default config object with equal weights (all five at `1`) and the ported good/bad/direction baseline table so downstream scorer work has real, defensible numbers.

## Acceptance Criteria

## Acceptance Criteria

## Acceptance Criteria **[REQUIRED]**

- [ ] `src/config/schema.ts` exports `configSchema` (Zod) and `export type Config = z.infer<typeof configSchema>` exactly matching the Detailed Design shape. (REQ-001, REQ-002)
- [ ] Schema accepts `language: z.literal("ts")`, `srcDir: z.string().default("./src")`, `lastScore: z.number().min(0).max(10).default(0)`, `threshold: z.number().default(-2)`, `weights: z.object({ ts: tsWeights })` where `tsWeights` has the five keys `locPerModule`, `depDepth`, `circularDeps`, `complexity`, `fanInOut` (each `z.number()`), and `baselines` with those same five keys each a `metricBaseline` `{ good: number, bad: number, direction: enum["lower-better","higher-better"] }`. (REQ-002)
- [ ] `lastScore` default `0` and `threshold` default `-2` are applied when absent. (REQ-001)
- [ ] Unknown/malformed shapes are rejected with a clear, single-string error (not a raw ZodError stack). Objects use `.strict()` so unknown keys are rejected. (REQ-002, NFR-004)
- [ ] `src/config/loadConfig.ts` exports `loadConfig(raw: unknown): Config` that runs `configSchema.parse` and catches `ZodError`, throwing a `new Error(<readable summary>)`.
- [ ] A default config value (equal weights all `1`, ported baseline table below) is exported for CIHA-I-0002's `init` to consume — e.g. `export const defaultConfig: Config`.
- [ ] Unit tests in `test/config.test.ts` cover: valid config round-trip; defaults applied when omitted; `lastScore` out of range (`<0` or `>10`) rejected; unknown key rejected; missing required section (e.g. `baselines`) rejected. (Testing Strategy → Config)

## Implementation Notes **[CONDITIONAL: Technical Task]**

### Execution profile
`Recommended Agent: opus + low`

A couple of files with a clear, fully-specified design. The schema shape and defaults are given verbatim in the Detailed Design.

### Technical Approach
- Copy the schema in `initiative.md` → "Config Schema (`config/schema.ts`)" exactly: `metricBaseline`, `tsWeights`, `configSchema`, `Config`.
- Ship the ported baseline table from the Detailed Design "Baseline Table" as the `baselines` of `defaultConfig` (raw metric units, all `lower-better`):

  | key | good | bad | direction |
  |---|---|---|---|
  | `locPerModule` | 50 | 150 | lower-better |
  | `depDepth` | 5 | 20 | lower-better |
  | `circularDeps` | 0 | 3 | lower-better |
  | `complexity` | 5 | 20 | lower-better |
  | `fanInOut` | 6 | 30 | lower-better |

  These are ported from `baselines.ts:4-17` (see `code-audit-report.md:527-539`); `circularDeps` and `fanInOut` are the two *derived* baselines documented in the initiative (aggregation changed from whole-graph scalar to per-unit distribution).
- `defaultConfig.weights.ts` = `{ locPerModule: 1, depDepth: 1, circularDeps: 1, complexity: 1, fanInOut: 1 }` (equal weights; scorer normalizes by total weight, so magnitude is irrelevant).
- `loadConfig`: `try { return configSchema.parse(raw); } catch (e) { if (e instanceof z.ZodError) throw new Error(<formatted issues>); throw e; }`. Format issues as a joined, path-qualified string so NFR-004 (failure clarity) holds.
- Keep `config/` free of internal-module dependencies (Component Diagram: "Depends on nothing internal").

### Dependencies
Depends on: CIHA-T-0001 (scaffolding/strict tooling). Blocks: CIHA-T-0007 (scorer consumes `baselines` + `weights.ts`) and CIHA-T-0008 (`scan()` runs raw JSON through `loadConfig`). CIHA-T-0003 also imports the `Config` type into `ScanContext`.

### Risk Considerations
- Under `exactOptionalPropertyTypes`, Zod `.default()` + inferred optionality can be subtle; verify `Config` has non-optional `srcDir`/`lastScore`/`threshold` after defaults (they are output-required). Use `z.infer` (output type), not `z.input`.

## Verification Steps **[REQUIRED]**

```
npm run lint && npm run typecheck && npm test
```

Success proof:
- `test/config.test.ts` passes all cases (valid round-trip, defaults applied, out-of-range/unknown-key/missing-section rejected with an `Error` whose message is a readable string).
- Typecheck confirms `Config` fields are correctly required/optional post-default.
- Lint/typecheck exit 0 with no escape hatches.

## Status Updates **[REQUIRED]**

*To be added during implementation*