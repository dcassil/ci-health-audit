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
  obj['lastScore'] = roundScore(newScore);
  const output = `${JSON.stringify(obj, null, 2)}\n`;

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
