/**
 * `scc` runner + parser (CIHA-I-0001, Phase 4).
 *
 * `parseScc` is a PURE function that turns already-parsed `scc --by-file
 * --format json` output into {@link FileStats}[]. `runScc` shells the command
 * through the injected {@link CommandRunner} and feeds its stdout to the parser.
 *
 * Reference: `apps/runner/src/plugins/tools/scc.ts:41-50` (command),
 * `:101-107` (per-file Code/Complexity), `:124-130` (code-language filter).
 */
import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import type { FileStats, ScanContext } from '../../scanner/types.js';

/**
 * Recognized code languages kept from `scc` output. The reference retains a
 * broader set; only the JS/TS members matter here, but the broader set is
 * retained faithfully so non-JS code (if scanned) is not silently dropped.
 */
const CODE_LANGUAGES: ReadonlySet<string> = new Set([
  'JavaScript',
  'TypeScript',
  'JSX',
  'TSX',
  'TypeScript Typings',
  'Python',
  'Rust',
  'Go',
  'Java',
  'C',
  'C++',
  'C#',
]);

/** Thrown when `scc` output is missing, non-zero-exit, or unparseable (NFR-004). */
export class SccError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SccError';
  }
}

/**
 * Per-file record inside an `scc` language group. `Location` is the file's path
 * relative to the invocation cwd (or absolute when the scan root is absolute);
 * `Filename` is the basename only. We prefer `Location` so paths stay
 * directory-qualified and align with `depcruise` module sources for graph
 * node matching (see {@link parseScc}). `Location` is optional so pure callers
 * that only supply `Filename` still parse (back-compat).
 */
const sccFileSchema = z.object({
  Filename: z.string(),
  Location: z.string().optional(),
  Code: z.number(),
  Complexity: z.number(),
});

/** One language group in `scc --by-file --format json` output. */
const sccGroupSchema = z.object({
  Name: z.string(),
  Files: z.array(sccFileSchema),
});

const sccOutputSchema = z.array(sccGroupSchema);

/**
 * Parse already-decoded `scc` JSON into {@link FileStats}[]. Keeps only files
 * whose language group is a recognized code language; each kept file maps to
 * `{ path, loc: Code, complexity: Complexity }`. The path is taken from
 * `Location` (directory-qualified) when present, else `Filename`; when a
 * `baseDir` is given, absolute `Location`s are relativized against it so paths
 * match `depcruise` module sources (both then `srcDir`-relative). Degenerate
 * input (no groups / no files) yields an empty array without throwing (NFR-005).
 */
export function parseScc(json: unknown, baseDir?: string): FileStats[] {
  const result = sccOutputSchema.safeParse(json);
  if (!result.success) {
    throw new SccError(
      `Unable to parse scc output: ${result.error.message}`,
      { cause: result.error },
    );
  }

  const stats: FileStats[] = [];
  for (const group of result.data) {
    if (!CODE_LANGUAGES.has(group.Name)) {
      continue;
    }
    for (const file of group.Files) {
      const rawPath = file.Location ?? file.Filename;
      const path =
        baseDir !== undefined && isAbsolute(rawPath)
          ? relative(baseDir, rawPath)
          : rawPath;
      stats.push({ path, loc: file.Code, complexity: file.Complexity });
    }
  }
  return stats;
}

/**
 * Shell `scc --by-file --format json .` via the injected runner, JSON-decode the
 * stdout, and parse it. The command runs with cwd = the resolved (absolute)
 * `srcDir` and scans `.` (the cwd) rather than re-embedding `srcDir` in the
 * target, so a relative `srcDir` (e.g. the default `"./src"`) works and does not
 * become `srcDir/srcDir`. Parsed paths are relativized against the same resolved
 * dir so they stay identical to `depcruise` module `source` strings (both are
 * relative-to-`srcDir`). Runner failures (missing binary / non-zero exit) and
 * unparseable stdout surface as {@link SccError} (NFR-004).
 */
export function runScc(ctx: ScanContext): FileStats[] {
  const absSrcDir = resolve(ctx.srcDir);
  const command = 'scc --by-file --format json .';

  let stdout: string;
  try {
    stdout = ctx.runner.run(command, absSrcDir);
  } catch (cause) {
    throw new SccError(
      'Failed to run scc. Is the "scc" binary installed and on PATH?',
      { cause },
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch (cause) {
    throw new SccError('scc produced output that is not valid JSON.', {
      cause,
    });
  }

  return parseScc(json, absSrcDir);
}
