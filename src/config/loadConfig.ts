/**
 * Config loader (CIHA-I-0001 Phase 2; extended for CIHA-I-0003 Phase 1).
 *
 * `loadConfig(raw)` validates an unknown value against {@link configFileSchema},
 * applies defaults (shared `threshold=-2`), and rethrows any Zod validation
 * failure as a single readable `Error` (REQ-001 / REQ-002).
 *
 * Before schema validation it detects the dropped v0.1 flat single-root shape
 * (top-level `srcDir`/`lastScore`, no `projects`) and throws an explicit
 * migration error, so users of a MAJOR-bump breaking change get actionable
 * guidance instead of a generic Zod failure (REQ-002 / NFR-004).
 */
import type { ZodError } from 'zod';
import { configFileSchema, type ConfigFile } from './schema.js';

/** Format all Zod issues into one multi-line, human-readable message. */
function formatIssues(error: ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `  - ${path}: ${issue.message}`;
  });
  return `Invalid ci-health-audit config:\n${lines.join('\n')}`;
}

/**
 * The v0.1→v0.2.0 migration error message. Shown when a config still uses the
 * dropped flat single-root shape.
 */
const MIGRATION_MESSAGE =
  'ci-health-audit v0.2.0 dropped the flat single-root config. This config has a ' +
  'top-level "srcDir"/"lastScore" and no "projects" array.\n' +
  'Migrate to the per-project model: provide a "projects" array where each entry ' +
  'has "name", "srcDir", and "lastScore" (shared "threshold"/"weights"/"baselines" ' +
  'stay at the top level as defaults), or run `ciha init` to scaffold it.\n' +
  'See the v0.2.0 migration notes for details.';

/** `true` when `raw` is the dropped v0.1 flat shape (has srcDir/lastScore, no projects). */
function isLegacyFlatConfig(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) {
    return false;
  }
  const obj = raw as Record<string, unknown>;
  const hasLegacyField = 'srcDir' in obj || 'lastScore' in obj;
  return hasLegacyField && !('projects' in obj);
}

/**
 * Parse and validate a raw config value into a typed {@link ConfigFile}.
 *
 * @throws Error with the v0.2.0 migration guidance when `raw` is the dropped
 *   flat single-root shape, or with a readable aggregated message when schema
 *   validation fails.
 */
export function loadConfig(raw: unknown): ConfigFile {
  if (isLegacyFlatConfig(raw)) {
    throw new Error(MIGRATION_MESSAGE);
  }

  const result = configFileSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(formatIssues(result.error));
  }
  return result.data;
}
