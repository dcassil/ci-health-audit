---
id: readme-docs
level: task
title: "README & docs"
short_code: "CIHA-T-0014"
created_at: 2026-07-31T18:26:30.210684+00:00
updated_at: 2026-07-31T20:05:21.098331+00:00
parent: CIHA-I-0002
blocked_by: []
archived: false

tags:
  - "#task"
  - "#phase/completed"


exit_criteria_met: false
strategy_id: NULL
initiative_id: CIHA-I-0002
---

# README & docs

## Parent Initiative **[CONDITIONAL: Assigned Task]**

[[CIHA-I-0002]]

## Objective **[REQUIRED]**

Write the `README.md` that ties the whole tool together: install, the `scc`/`dependency-cruiser` prerequisites, the full config reference, the three usage modes (CLI report, CI report, local gate), and the exit-code contract table. This is documentation synthesis of the finished behavior — it should describe exactly what the shipped CLI (CIHA-T-0010), Action (CIHA-T-0012), and hooks (CIHA-T-0013) do. This is Phase 6, the last task; it depends on all prior tasks being landed so the docs describe real behavior.

## Acceptance Criteria

## Acceptance Criteria

## Acceptance Criteria **[REQUIRED]**

- [ ] README documents install via `npx ci-health-audit` and local install, noting `npx`/`ciha` interchangeability and Node LTS macOS/Linux support (NFR-005).
- [ ] Prerequisites section documents installing `scc` (Go binary) and `dependency-cruiser` (npm), matching the Action's install steps (Goals; Constraints).
- [ ] Full config reference for `ci-health-audit.config.json`: `language`, `srcDir`, `lastScore` (default 0), `threshold` (default −2), `weights.ts`, optional `baselines`, with the default config JSON shown.
- [ ] The three usage modes documented: (1) manual CLI report (`init` then `scan`), (2) CI report via the Action, (3) local gate via the hook — each mapped to Use Cases 1–3.
- [ ] First-run seeding explained (`lastScore: 0` first gate always passes and records the true score) (Use Case 4, REQ-004).
- [ ] Exit-code contract table published: `0` report/pass, `1` gate fail, `2` config/usage error (NFR-004).
- [ ] Terminal output examples (report table, PASS/FAIL messages, `--json` shape) shown.
- [ ] Notes that gate mode writes `lastScore` back and the user should commit it; caveat that gate-in-CI fits push-to-main, not ephemeral PR checkouts.

## Implementation Notes **[CONDITIONAL: Technical Task]**

### Execution profile
Recommended Agent: sonnet + medium

### Dependencies
- **Initiative is BLOCKED BY CIHA-I-0001** (the engine; README notes it provides the score).
- **Intra-initiative ordering:** depends on **all prior tasks** — CIHA-T-0009 (gate semantics / exit contract), CIHA-T-0010 (CLI commands + `--json` shapes), CIHA-T-0011 (verified behavior to describe accurately), CIHA-T-0012 (Action usage), CIHA-T-0013 (hook enablement). Single deliverable synthesizing finished behavior.

### Technical Approach
Deliverable: `README.md`. Structure:
1. **What it is** — one 0–10 score, one config file, three runtimes; no server/DB.
2. **Install** — `npx ci-health-audit init`; local `npm i -D ci-health-audit`; `ciha` alias.
3. **Prerequisites** — `scc` install (`go install github.com/boyter/scc/v3@latest`) and `dependency-cruiser` (`npm i -g dependency-cruiser` or project dep); note both must be on PATH.
4. **Quick start** — `init` → `scan`, with example report output.
5. **Config reference** — table of every field + the default config JSON block (language ts, srcDir ./src, lastScore 0, threshold -2, equal weights, optional baselines override).
6. **Usage mode 1: CLI report** (Use Case 1).
7. **Usage mode 2: GitHub Action** — the example `health.yml`, `mode` input, `score` output, job summary; report vs gate caveat (Use Case 2, CIHA-T-0012).
8. **Usage mode 3: local gate hook** — `.githooks` scripts, `core.hooksPath` enablement, commit-the-config note (Use Case 3, CIHA-T-0013).
9. **First-run seeding** — why the first gate always passes and seeds (Use Case 4).
10. **Exit-code contract** — the table (0/1/2) and what CI/hooks branch on.
11. **Output formats** — human table, PASS/FAIL strings, `--json` object.

Pull exact strings (report table, PASS/FAIL messages, `--json` shape, default config, exit-code table) from the initiative's Detailed Design so docs match shipped behavior byte-for-byte.

### Risk Considerations
- Keep the exit-code table and gate formula authoritative and consistent with CIHA-T-0009/0010 — this is the public contract users script against. Verify against the actual implemented behavior, not just the spec, since this task lands last.

## Test Cases **[CONDITIONAL: Testing Task]**

*Not a testing task. Verification is by review against the shipped CLI/Action/hook behavior (see Verification).*

## Documentation Sections **[CONDITIONAL: Documentation Task]**

### User Guide Content
- **Feature Description**: A zero-infrastructure 0–10 code-health score for JS/TS repos, runnable as CLI, GitHub Action, or git hook from one binary.
- **Prerequisites**: Node LTS; `scc` and `dependency-cruiser` on PATH; a `ci-health-audit.config.json` (via `init`).
- **Step-by-Step Instructions**:
  1. Install prerequisites (`scc`, `dependency-cruiser`), then `npx ci-health-audit init`.
  2. Run `npx ci-health-audit scan` to see the score and per-metric breakdown.
  3. Wire the Action (report) and/or the `.githooks` gate; commit the updated `lastScore` on passes.

### Troubleshooting Guide
- **`scc`/`depcruise` not found**: install them and ensure they are on PATH (exit 2, config/usage error class).
- **Gate fails unexpectedly**: check `lastScore` and `threshold`; the floor is `lastScore + threshold`. First run seeds and always passes.
- **Config not updating**: only a PASS writes `lastScore`; a FAIL (exit 1) intentionally leaves it unchanged.
- **Error messages**: exit 1 = gate regression; exit 2 = missing/invalid config or unknown command; exit 0 = report or pass.

## Status Updates **[REQUIRED]**

*To be added during implementation*