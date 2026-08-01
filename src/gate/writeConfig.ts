/**
 * ci-health-audit — atomic config write-back (CIHA-I-0002, Phase 1 / CIHA-T-0009).
 *
 * Persists **only** the `lastScore` field of the config file, preserving every
 * other key, its insertion order, 2-space indentation, and the trailing newline
 * (REQ-005). The write is atomic (NFR-003): the new content is written to a
 * `<config>.tmp` sibling, `fsync`'d, then `rename`'d over the original — a rename
 * is atomic on POSIX, so an interrupted or failing write can never leave a
 * corrupt or partially-written config. On any failure the temp file is removed
 * and the original bytes are left untouched.
 *
 * The score is rounded to one-decimal precision before writing (Detailed Design
 * "Config write-back approach", step 2) to match the engine's precision.
 */
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';

/** Round to the engine's one-decimal precision (e.g. `7.4499` → `7.4`). */
function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Atomically write `output` over `configPath` (NFR-003): write to a `<config>.tmp`
 * sibling, `fsync` it, then `rename` it over the original. A POSIX rename is
 * atomic, so an interrupted or failing write can never leave a corrupt config. On
 * any failure the temp file is removed and the original bytes are left untouched.
 */
function atomicWrite(configPath: string, output: string): void {
  const tmpPath = `${configPath}.tmp`;
  try {
    const fd = openSync(tmpPath, 'w');
    try {
      writeSync(fd, output);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmpPath, configPath);
  } catch (error) {
    rmSync(tmpPath, { force: true });
    throw error;
  }
}

/**
 * Update `lastScore` in the JSON config at `configPath` to `newScore`, atomically.
 *
 * Reads the existing file, mutates only `lastScore`, re-serializes with 2-space
 * indent + trailing newline (insertion order preserved by `JSON.stringify`), and
 * atomically renames a fsync'd temp file into place. Throws if the file is
 * missing, unreadable, or not a JSON object; on any throw the original file is
 * left intact and no `.tmp` remains.
 */
export function writeLastScore(configPath: string, newScore: number): void {
  const text = readFileSync(configPath, 'utf8');
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`Config at ${configPath} is not a JSON object.`);
  }

  const obj = parsed as Record<string, unknown>;
  // PHASE-1 SHIM (CIHA-T-0015): configs are now per-project. Until Phase 3
  // (CIHA-T-0017) introduces multi-project `writeLastScores`, write the score
  // into the FIRST project's `lastScore` when a `projects` array is present so
  // the single-project CLI keeps round-tripping through the strict schema. The
  // legacy top-level branch remains for callers still passing a flat object.
  const projects: unknown = obj['projects'];
  const firstProject =
    Array.isArray(projects) && projects.length > 0
      ? (projects[0] as unknown)
      : undefined;
  if (typeof firstProject === 'object' && firstProject !== null) {
    (firstProject as Record<string, unknown>)['lastScore'] = roundScore(newScore);
  } else {
    obj['lastScore'] = roundScore(newScore);
  }
  const output = `${JSON.stringify(obj, null, 2)}\n`;
  atomicWrite(configPath, output);
}

/**
 * Update **every** project's `lastScore` in the JSON config at `configPath`,
 * atomically (CIHA-I-0003, Phase 3 / CIHA-T-0017; REQ-006, NFR-003).
 *
 * `scoresByName` maps each project's unique `name` to its just-computed new score.
 * The config is read, each `projects[i]` is matched by `name`, and its `lastScore`
 * is set to the score rounded to one decimal (matching {@link writeLastScore}'s
 * precision). Array order and key order survive because only the numeric field is
 * mutated in place and the object is re-serialized with `JSON.stringify(obj, null, 2)`
 * plus a trailing newline (REQ-006). The write is atomic via the shared
 * temp-file + fsync + rename strategy: on any failure the original config is
 * untouched and no `.tmp` remains (NFR-003).
 *
 * Throws if the file is missing/unreadable, is not a config object with a
 * `projects` array, or if any `name` in `scoresByName` has no matching project
 * (fails loudly rather than silently dropping a score).
 */
export function writeLastScores(configPath: string, scoresByName: Map<string, number>): void {
  const text = readFileSync(configPath, 'utf8');
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`Config at ${configPath} is not a JSON object.`);
  }

  const obj = parsed as Record<string, unknown>;
  const projects: unknown = obj['projects'];
  if (!Array.isArray(projects)) {
    throw new TypeError(`Config at ${configPath} has no "projects" array.`);
  }

  // Track which requested names were matched so an unknown name fails loudly.
  const matched = new Set<string>();
  for (const entry of projects) {
    if (typeof entry !== 'object' || entry === null) continue;
    const project = entry as Record<string, unknown>;
    const name: unknown = project['name'];
    if (typeof name !== 'string') continue;
    const score = scoresByName.get(name);
    if (score === undefined) continue;
    project['lastScore'] = roundScore(score);
    matched.add(name);
  }

  for (const name of scoresByName.keys()) {
    if (!matched.has(name)) {
      throw new Error(`No project named "${name}" found in config at ${configPath}.`);
    }
  }

  const output = `${JSON.stringify(obj, null, 2)}\n`;
  atomicWrite(configPath, output);
}
