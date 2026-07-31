---
id: pre-commit-pre-push-hook-scripts
level: task
title: "Pre-commit/pre-push hook scripts"
short_code: "CIHA-T-0013"
created_at: 2026-07-31T18:26:29.217469+00:00
updated_at: 2026-07-31T20:01:08.086291+00:00
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

# Pre-commit/pre-push hook scripts

## Parent Initiative **[CONDITIONAL: Assigned Task]**

[[CIHA-I-0002]]

## Objective **[REQUIRED]**

Ship the native git hook scripts (`.githooks/pre-commit` and `.githooks/pre-push`) that run `ciha gate`, blocking a commit/push on a regression beyond threshold and letting a pass update `lastScore`, plus the `core.hooksPath` enablement instructions. These are dependency-free scripts (no husky) that wrap the already-tested binary — the third runtime from one binary. This is Phase 5; it depends on the `ciha gate` command from CIHA-T-0010.

## Acceptance Criteria

## Acceptance Criteria

## Acceptance Criteria **[REQUIRED]**

- [ ] `.githooks/pre-commit` runs `ciha gate` and aborts the commit with a non-zero exit on gate FAIL (REQ-008, Use Case 3).
- [ ] `.githooks/pre-push` is an equivalent variant placed at that path (recommended when per-commit scan time is too slow) (REQ-008, Detailed Design "Hook script").
- [ ] Both scripts start with `#!/bin/sh` and print a clear message to stderr on failure.
- [ ] Enablement documented: `git config core.hooksPath .githooks && chmod +x .githooks/pre-commit .githooks/pre-push`.
- [ ] On gate PASS the config's `lastScore` is updated (by the binary); the docs note the user should commit that config change, with the optional advanced `git add` step called out.
- [ ] No husky or hook-manager dependency introduced (Alternatives Considered: native hooks).

## Implementation Notes **[CONDITIONAL: Technical Task]**

### Execution profile
Recommended Agent: haiku + low

### Dependencies
- **Initiative is BLOCKED BY CIHA-I-0001** (the binary the hook calls ultimately runs the engine).
- **Intra-initiative ordering:** depends on **CIHA-T-0010** (the `ciha gate` command and its exit-code contract, especially exit 1 = FAIL, which is what aborts the git operation). Copy the specified script; no cross-file invariants.

### Technical Approach
`.githooks/pre-commit`:
```sh
#!/bin/sh
# Block commits that regress code health beyond the configured threshold.
npx --no-install ci-health-audit gate || {
  echo "ci-health-audit gate failed — commit blocked. Fix regressions or adjust threshold." >&2
  exit 1
}
```
`.githooks/pre-push` is identical (same body; the comment/message may say "push" instead of "commit").

**Enablement (documented in this task's output and later cross-linked from the README, CIHA-T-0014):**
```
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/pre-push
```

**Exit-code reliance:** the hook relies solely on the CLI exit code — exit 1 (gate FAIL) aborts git; exit 0 (PASS/seed) allows it; exit 2 (config error) also aborts, correctly, since a broken config should not silently pass a gate. The `||` block adds an explanatory stderr line but preserves the non-zero exit.

**Write-back note:** on PASS the binary updates `lastScore`. For pre-commit, that change lands in the working tree; document that the user should commit it (or, as an optional advanced step, `git add` the config inside the hook to fold the baseline update into the same commit). Husky users can call `ciha gate` from their existing hook — document the mechanism, not a lock-in.

### Risk Considerations
- `npx --no-install` requires the package to be installed locally (so hooks don't silently download on every commit); note this prerequisite. Contrast with the Action which uses `npx --yes`.
- Keep scripts POSIX `sh`-compatible (no bashisms) for portability across dev machines (NFR-005).

## Test Cases **[CONDITIONAL: Testing Task]**

### Test Case 1: Commit blocked on regression
- **Test ID**: TC-001
- **Preconditions**: repo with `core.hooksPath .githooks`, executable hook, seeded config, and a staged change that worsens the score beyond threshold.
- **Steps**: `git commit`.
- **Expected Results**: gate exits 1, stderr shows the block message, commit is aborted, `lastScore` unchanged.
- **Status**: Pass/Fail/Blocked

### Test Case 2: Passing commit updates baseline
- **Test ID**: TC-002
- **Preconditions**: same setup; a staged change within threshold (or improving).
- **Steps**: `git commit`.
- **Expected Results**: gate exits 0, commit proceeds, `lastScore` updated in the config working-tree file.
- **Status**: Pass/Fail/Blocked

## Status Updates **[REQUIRED]**

*To be added during implementation*