#!/usr/bin/env node
/**
 * ci-health-audit CLI — executable entry (CIHA-I-0002, Phase 2 / CIHA-T-0010).
 *
 * The `bin` target (`ci-health-audit` / `ciha`). Delegates all logic to
 * {@link run}, which returns the exit code per the public contract (0 pass/report,
 * 1 gate FAIL, 2 config/usage error). We set `process.exitCode` rather than
 * calling `process.exit` so buffered stdout/stderr flush cleanly before the
 * process ends.
 */
import { run } from './program.js';

run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`ci-health-audit: fatal — ${detail}\n`);
    process.exitCode = 2;
  });
