---
id: ci-health-audit
level: vision
title: "ci-health-audit"
short_code: "CIHA-V-0001"
created_at: 2026-07-31T18:19:09.986131+00:00
updated_at: 2026-07-31T18:20:20.506084+00:00
archived: false

tags:
  - "#vision"
  - "#phase/published"


exit_criteria_met: false
strategy_id: NULL
initiative_id: NULL
---

# CI Health Audit Vision

## Purpose **[REQUIRED]**

Provide a single, portable command-line tool that computes one **code health score (0–10)** for a JS/TS codebase and can be dropped into three contexts without change: a GitHub Action, a local pre-commit/pre-push hook, and a manual CLI invocation. It distills the multi-package, server-backed scoring engine that exists today in `code-audit`/`shore-guard` down to its load-bearing core: a plugin-based scanner and a deterministic scoring function driven by a small config file.

The existing tools are excellent but heavy — a monorepo with a runner, an API server, a database of scoring profiles and composite definitions, an MCP server, and a dashboard. Most teams that want a health gate on their CI do not want to stand up that infrastructure. This tool captures the 20% of that system that delivers the health number, with zero server and zero database.

## Product/Solution Overview **[CONDITIONAL: Product/Solution Vision]**

A small, dependency-light npm package exposing a CLI (`ci-health-audit` / `ciha`). Given a config file, it scans a source directory, computes five structural metrics at their p75 values, normalizes each to 0–10 against baselines, combines them with equal weights, and prints one health score. It has three modes of operation:

- **Report mode** (GitHub Action, plain CLI): scan, compute, print the score, exit 0.
- **Gate mode** (pre-commit/pre-push): scan, compute, compare against the saved `lastScore` in config; if the new score falls by more than the `threshold` (default −2), fail (non-zero exit); otherwise persist the new score back to config and pass.

Target audience: engineering teams and individual developers who want a lightweight, zero-infrastructure regression gate on architectural health. Key benefit: catch structural decay (growing modules, deepening dependency chains, new cycles, rising complexity, tightening coupling) at commit time or in CI, with a single number and a single config file.

## Current State **[REQUIRED]**

Two reference implementations exist locally and were researched in detail (`research/code-audit-report.md`, `research/shore-guard-report.md`):

- **`code-audit`** — a pnpm/npm monorepo: `packages/scoring` (calculator, baselines, dynamic composites), `packages/core` (shared types), `apps/runner` (plugin-based scanner shelling out to `scc` and `dependency-cruiser`), plus `apps/server`, `apps/cli`, `apps/mcp`, `apps/dashboard`. Scoring is on a 0–100 scale, weights and baselines live in a database, and per-language "profiles" hold baselines (not weights).
- **`shore-guard`/`shore-runner`** — the same scanner/scoring lineage split across a runner and a Next.js web app that recomputes scores server-side and persists them at 0–100 in Postgres.

Both compute the same five structural metrics via a graph built from `depcruise` output plus per-file LOC/complexity from `scc`. Neither ships a standalone, config-file-driven, 0–10 CLI suitable for a pre-commit hook. The default scorers use a mix of avg/max/p90 aggregations — not a uniform p75 — and apply non-uniform weights.

This repo (`ci-health-audit`) is currently empty except for the two research reports.

## Future State **[REQUIRED]**

A published, installable tool where:

- `npx ci-health-audit init` scaffolds a `ci-health-audit.config.json`.
- `npx ci-health-audit scan` prints a 0–10 score for the configured `srcDir`.
- The same binary runs in a GitHub Action (reporting the score, optionally as a check) and as a pre-commit/pre-push hook (gating on regression beyond `threshold`, updating `lastScore` on pass).
- Scanning is plugin-based (the `ToolPlugin` pattern preserved from the reference), with only a JS/TS plugin implemented, but the seam left open for future languages.
- Scoring is simplified: the five metrics (LOC/module, dependency depth, circular deps, cyclomatic complexity, fan-in/fan-out) each at their **p75** value, each normalized to 0–10, combined with **equal weights** under `{ ts: {...} }`.

## Major Features **[CONDITIONAL: Product Vision]**

- **Plugin-based scanner (JS/TS only for now):** preserves the `ToolPlugin { id, supports, run(ctx) }` seam from the reference; the JS/TS plugin shells out to `scc` (LOC + complexity) and `dependency-cruiser` (dependency graph), builds a directed module graph, and computes the five metrics.
- **p75 metric computation:** LOC/module, dependency depth, circular dependencies, cyclomatic complexity, and fan-in/fan-out reduced to a single p75 value each (depth/cycles use whole-graph values where a per-module distribution is not meaningful — resolved during design).
- **Deterministic 0–10 scorer with equal weights:** each metric normalized to 0–10 against good/bad baselines (ported and rescaled from the reference), combined with equal per-language weights `{ ts: { locPerModule: w, depDepth: w, circularDeps: w, complexity: w, fanInOut: w } }`.
- **Config-driven behavior:** `{ language: "ts", srcDir: "./src", lastScore: <0–10, default 0>, threshold: -2, weights, baselines }`.
- **Three runtimes from one binary:** CLI report, GitHub Action report, and local pre-commit/pre-push gate with saved-score comparison and write-back.

## Success Criteria **[REQUIRED]**

- A user can install the tool, run `scan` against a JS/TS repo, and get a stable, reproducible 0–10 score with no server or database.
- Running the same tool in a GitHub Action prints the score to the workflow output/summary.
- Running in gate mode on a repo whose score dropped more than `threshold` below `lastScore` exits non-zero; a repo that held or improved exits zero and persists the new score to config.
- The scorer is deterministic: identical source + identical config ⇒ identical score across runs and machines (given the same `scc`/`depcruise` versions).
- Adding a second language later requires only a new `ToolPlugin` + a `weights` entry, with no change to the scoring core.

## Principles **[REQUIRED]**

- **One number, one config file.** The whole tool is driven by a single config and yields a single score. Resist feature creep back toward the server/dashboard system it was extracted from.
- **Keep the plugin seam, ship one plugin.** Preserve the extensibility pattern that made the reference good; implement only JS/TS now.
- **Deterministic and explainable.** The score must be reproducible and traceable to per-metric sub-scores.
- **Simplify aggressively but faithfully.** Use p75 for all five metrics and equal weights, even where the reference used avg/max/p90 and tuned weights — but port the baselines and graph algorithms faithfully so scores remain meaningful.
- **No lint/type escape hatches.** Fix underlying code rather than disabling rules or casting through `any`.

## Constraints **[REQUIRED]**

- **External tool dependencies:** requires `scc` and `dependency-cruiser` available at runtime (documented; `dependency-cruiser` is an npm dep, `scc` is a Go binary the user installs). No reimplementation of these.
- **JS/TS only** for the first version; other languages are explicitly out of scope but must not be architecturally precluded.
- **0–10 scale** everywhere (the reference uses 0–100; all normalization must target 0–10).
- **Node/TypeScript** implementation, distributable via npm, runnable via `npx`.
- **No network, no persistence beyond the config file.** The only mutable state is `lastScore` written back to the config on a passing gate run.