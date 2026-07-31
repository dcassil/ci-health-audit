/**
 * Config loader (CIHA-I-0001, Phase 2).
 *
 * `loadConfig(raw)` validates an unknown value against `configSchema`, applies
 * defaults (`srcDir`, `lastScore=0`, `threshold=-2`), and rethrows any Zod
 * validation failure as a single readable `Error` (REQ-001 / REQ-002).
 */
import type { ZodError } from 'zod';
import { configSchema, type Config } from './schema.js';

/** Format all Zod issues into one multi-line, human-readable message. */
function formatIssues(error: ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `  - ${path}: ${issue.message}`;
  });
  return `Invalid ci-health-audit config:\n${lines.join('\n')}`;
}

/**
 * Parse and validate a raw config value into a typed {@link Config}.
 *
 * @throws Error with a readable, aggregated message when validation fails.
 */
export function loadConfig(raw: unknown): Config {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(formatIssues(result.error));
  }
  return result.data;
}
