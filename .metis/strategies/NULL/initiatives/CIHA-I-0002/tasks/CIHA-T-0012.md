---
id: github-action-example-workflow
level: task
title: "GitHub Action + example workflow"
short_code: "CIHA-T-0012"
created_at: 2026-07-31T18:26:27.660956+00:00
updated_at: 2026-07-31T20:01:04.972617+00:00
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

# GitHub Action + example workflow

## Parent Initiative **[CONDITIONAL: Assigned Task]**

[[CIHA-I-0002]]

## Objective **[REQUIRED]**

Author the composite GitHub Action (`action.yml`) that installs the `scc` and `dependency-cruiser` prerequisites, runs `ciha scan`/`gate` via `npx`, writes the score to the job summary, and exposes it as a `score` step output — plus an example workflow and a smoke workflow. The Action is a thin wrapper over the already-tested binary (no build/publish of action internals). This is Phase 4; it depends on the CLI from CIHA-T-0010.

## Acceptance Criteria

## Acceptance Criteria

## Acceptance Criteria **[REQUIRED]**

- [ ] `action.yml` is a **composite** action with inputs `config` (default `ci-health-audit.config.json`) and `mode` (default `report`), and output `score` (REQ-007).
- [ ] It installs `scc` (via `go install …/scc/v3@latest`, adding GOPATH bin to `$GITHUB_PATH`) and `dependency-cruiser` (`npm i -g dependency-cruiser`) (REQ-007).
- [ ] It runs `npx --yes ci-health-audit <scan|gate> --config <config> --json`, extracts `score`, writes `score=<n>` to `$GITHUB_OUTPUT` and a `### CI Health Audit: <n> / 10` line to `$GITHUB_STEP_SUMMARY` (REQ-007).
- [ ] `mode: gate` selects the `gate` command (job fails on regression via exit 1); `mode: report` (default) selects `scan` and never fails the build (Use Case 2; Component Diagram runtime table).
- [ ] An example workflow `.github/workflows/health.yml` triggers on `pull_request`, checks out code, sets up Node + Go, and uses the action in default (report) mode.
- [ ] A smoke workflow asserts the job summary contains a score line and the `score` output is a parseable number in both `report` and `gate` modes (Testing Strategy "Note on testing the Action").

## Implementation Notes **[CONDITIONAL: Technical Task]**

### Execution profile
Recommended Agent: sonnet + medium

### Dependencies
- **Initiative is BLOCKED BY CIHA-I-0001** (the engine the binary calls).
- **Intra-initiative ordering:** depends on **CIHA-T-0010** (the published/runnable `npx ci-health-audit` binary with `--json`). Reuses the install steps that CIHA-T-0011's CI job also relies on. Pure YAML wiring — shape fully specified below.

### Technical Approach
`action.yml` (composite):
```yaml
name: "CI Health Audit"
description: "Compute and (optionally) gate a 0–10 code health score."
inputs:
  config:
    description: "Path to ci-health-audit.config.json"
    default: "ci-health-audit.config.json"
  mode:
    description: "report | gate"
    default: "report"
outputs:
  score:
    description: "The computed 0–10 health score"
    value: ${{ steps.run.outputs.score }}
runs:
  using: "composite"
  steps:
    - name: Install scc
      shell: bash
      run: go install github.com/boyter/scc/v3@latest && echo "$(go env GOPATH)/bin" >> "$GITHUB_PATH"
    - name: Install dependency-cruiser
      shell: bash
      run: npm i -g dependency-cruiser
    - name: Run ci-health-audit
      id: run
      shell: bash
      run: |
        if [ "${{ inputs.mode }}" = "gate" ]; then CMD=gate; else CMD=scan; fi
        SCORE=$(npx --yes ci-health-audit "$CMD" --config "${{ inputs.config }}" --json | node -e 'process.stdin.on("data",d=>{const j=JSON.parse(d);process.stdout.write(String(j.score))})')
        echo "score=$SCORE" >> "$GITHUB_OUTPUT"
        echo "### CI Health Audit: $SCORE / 10" >> "$GITHUB_STEP_SUMMARY"
```

Example workflow `.github/workflows/health.yml`:
```yaml
on: [pull_request]
jobs:
  health:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: actions/setup-go@v5
        with: { go-version: "1.22" }
      - uses: your-org/ci-health-audit@v1   # mode: report by default
```

**Report vs gate in CI:** `mode: report` on PRs surfaces the number without blocking; `mode: gate` fails CI on regression. Note gate mode writes `lastScore` back, so it fits a push-to-main workflow that commits the updated config — not an ephemeral PR checkout (document this caveat).

**Smoke workflow:** on a tiny sample repo, run the action in both modes and assert (a) `$GITHUB_STEP_SUMMARY` contains a `/ 10` line and (b) the `score` output matches a number regex. Because a composite action is just shell + the tested binary, no unit-level Action test is needed — its logic lives in the CLI (Testing Strategy note).

### Risk Considerations
- `go env GOPATH` bin must be on PATH for the `scc` step to resolve in later steps — verify with `scc --version` in the smoke workflow.
- Keep the JSON extraction resilient: the `node -e` reader reads the first `data` chunk; if output grows, prefer buffering all stdin. Note for the implementer to buffer rather than assume a single chunk.

## Test Cases **[CONDITIONAL: Testing Task]**

### Test Case 1: Report mode smoke
- **Test ID**: TC-001
- **Preconditions**: smoke workflow on a sample repo; runner installs Node + Go.
- **Steps**: run action with `mode: report`.
- **Expected Results**: job succeeds; summary has `### CI Health Audit: <n> / 10`; `score` output parses as a number.
- **Status**: Pass/Fail/Blocked

### Test Case 2: Gate mode output
- **Test ID**: TC-002
- **Preconditions**: sample repo whose config is seeded so gate passes.
- **Steps**: run action with `mode: gate`.
- **Expected Results**: `score` output is a number; job exit reflects gate PASS (0); on a seeded-then-worsened repo, gate exit 1 fails the job.
- **Status**: Pass/Fail/Blocked

## Status Updates **[REQUIRED]**

*To be added during implementation*