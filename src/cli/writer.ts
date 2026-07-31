/**
 * ci-health-audit CLI — output writer seam (CIHA-I-0002, Phase 2 / CIHA-T-0010).
 *
 * The CLI legitimately needs stdout/stderr, but the codebase forbids `console`
 * in `src/` (`no-console: error`) and forbids blanket eslint disables. Rather
 * than weaken that rule, all handler output is routed through this small
 * injected {@link Writer} abstraction. The default writer wraps
 * `process.stdout`/`process.stderr`; unit tests inject an in-memory writer and
 * assert on the captured lines without spawning a process or touching the real
 * streams.
 */

/** A minimal sink for CLI output. Handlers write only through this seam. */
export interface Writer {
  /** Print a line to standard output (report/PASS messages, `--json`). */
  out(line: string): void;
  /** Print a line to standard error (FAIL messages, config errors). */
  err(line: string): void;
}

/** Default {@link Writer} backed by the real process streams. */
export const processWriter: Writer = {
  out(line: string): void {
    process.stdout.write(`${line}\n`);
  },
  err(line: string): void {
    process.stderr.write(`${line}\n`);
  },
};
