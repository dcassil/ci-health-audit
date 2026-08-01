/**
 * ci-health-audit CLI — workspace auto-discovery for `init`
 * (CIHA-I-0003, Phase 5 / CIHA-T-0019; REQ-007, NFR-001).
 *
 * `init` becomes monorepo-aware by discovering the repo's workspaces once, at
 * setup time, and persisting one project per workspace. This module is the
 * pure-ish, unit-testable core of that discovery: it reads workspace globs from
 * `package.json` (`workspaces` — either an array of globs, or an object with a
 * `packages` array) and from `pnpm-workspace.yaml` (`packages:`), unions the
 * glob sets, expands them deterministically to directories that contain a
 * `package.json`, and returns a sorted list of discovered packages.
 *
 * All filesystem access goes through an injected {@link DiscoveryFs} seam and a
 * `root` directory, so tests drive it with an in-memory fixture rather than the
 * real repo. Expansion is deterministic (results are sorted) so repeated runs on
 * the same tree always produce an identical config (NFR-001). No new runtime
 * dependency is introduced: the `pnpm-workspace.yaml` `packages:` list is parsed
 * with a minimal, well-tested line reader (the only shape ci-health-audit needs),
 * and glob expansion is implemented directly on top of the fs seam.
 */

/**
 * Minimal filesystem seam consumed by discovery. A subset of `node:fs` chosen so
 * tests can supply an in-memory fixture. All paths passed in are POSIX-style,
 * relative to (and joined under) the discovery `root`.
 */
export interface DiscoveryFs {
  /** Does a file or directory exist at `path`? */
  exists(path: string): boolean;
  /** Read a UTF-8 file. Only called after {@link DiscoveryFs.exists} is true. */
  readFile(path: string): string;
  /** Is `path` a directory? `false` for files or missing paths. */
  isDirectory(path: string): boolean;
  /** List the entry names (not paths) directly under directory `path`. */
  readDir(path: string): readonly string[];
}

/** One discovered workspace package. */
export interface DiscoveredPackage {
  /**
   * The package's declared `name` from its `package.json`, or the directory
   * basename when the manifest has no usable `name`.
   */
  name: string;
  /**
   * The package directory relative to the repo root, POSIX-style with a `./`
   * prefix (e.g. `./packages/core`) — used directly as a project `srcDir`.
   */
  srcDir: string;
}

/**
 * POSIX path join that collapses `.` segments and stray slashes. A leading `/`
 * on the first part is preserved so an absolute root (e.g. `/repo`) stays
 * absolute.
 */
function joinPosix(...parts: readonly string[]): string {
  const absolute = parts.length > 0 && parts[0]?.startsWith('/') === true;
  const segments: string[] = [];
  for (const part of parts) {
    for (const segment of part.split('/')) {
      if (segment === '' || segment === '.') continue;
      segments.push(segment);
    }
  }
  const joined = segments.join('/');
  return absolute ? `/${joined}` : joined;
}

/** The last path segment of a POSIX path (its basename). */
function basename(path: string): string {
  const segments = path.split('/').filter((segment) => segment !== '');
  return segments.at(-1) ?? path;
}

/**
 * Extract the workspace globs declared in a `package.json` object. Supports both
 * the npm/yarn array form (`"workspaces": ["packages/*"]`) and the object form
 * (`"workspaces": { "packages": ["packages/*"] }`). Returns `[]` for any other
 * shape.
 */
function globsFromPackageJson(pkg: unknown): string[] {
  if (typeof pkg !== 'object' || pkg === null) return [];
  const workspaces = (pkg as Record<string, unknown>)['workspaces'];
  if (Array.isArray(workspaces)) {
    return workspaces.filter((entry): entry is string => typeof entry === 'string');
  }
  if (typeof workspaces === 'object' && workspaces !== null) {
    const packages = (workspaces as Record<string, unknown>)['packages'];
    if (Array.isArray(packages)) {
      return packages.filter((entry): entry is string => typeof entry === 'string');
    }
  }
  return [];
}

/**
 * Minimal parse of the `packages:` list in a `pnpm-workspace.yaml`. Reads the
 * top-level `packages:` key, then the immediately following `- "glob"` /
 * `- glob` sequence, stopping at the first non-list, non-blank line. This is a
 * deliberately narrow reader for the one shape the tool needs — it avoids adding
 * a YAML runtime dependency. Quotes (single or double) around a glob are
 * stripped; comments (`#`) and blank lines are ignored.
 */
function globsFromPnpmWorkspace(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const globs: string[] = [];
  let inPackages = false;
  for (const rawLine of lines) {
    // Strip trailing comments only when not inside a quoted value; our values
    // are simple globs, so a `#` outside quotes is a comment.
    const line = rawLine.replace(/\s+#.*$/, '').replace(/^#.*$/, '');
    if (!inPackages) {
      if (/^packages\s*:\s*$/.test(line.trim())) {
        inPackages = true;
      }
      continue;
    }
    const listMatch = /^\s*-\s*(.+?)\s*$/.exec(line);
    if (listMatch?.[1] !== undefined) {
      const value = listMatch[1].replace(/^['"]/, '').replace(/['"]$/, '').trim();
      if (value !== '') globs.push(value);
      continue;
    }
    // A blank line does not end the list; any other content (a new key) does.
    if (line.trim() === '') continue;
    break;
  }
  return globs;
}

/**
 * Expand a single workspace glob (relative to `root`) to the set of directories
 * that contain a `package.json`. Supports the common workspace patterns:
 *   - an exact directory path (`packages/core`)
 *   - a single-level wildcard (`packages/*`)
 *   - a recursive wildcard (`packages/**`)
 * The `*` matches one path segment; `**` matches any depth (including zero).
 * Results are POSIX paths relative to `root`. Determinism is guaranteed by
 * sorting directory listings before recursing.
 */
function expandGlob(fs: DiscoveryFs, root: string, glob: string): string[] {
  const trimmed = glob.replace(/\/+$/, '');
  const segments = trimmed.split('/').filter((segment) => segment !== '');
  const results: string[] = [];

  const walk = (relDir: string, remaining: readonly string[]): void => {
    if (remaining.length === 0) {
      results.push(relDir);
      return;
    }
    const [segment, ...rest] = remaining;
    if (segment === undefined) return;
    const absDir = joinPosix(root, relDir);
    if (segment === '**') {
      // `**` matches zero-or-more segments: try consuming it here, and also
      // descend into every child with `**` still active.
      walk(relDir, rest);
      if (!fs.isDirectory(absDir)) return;
      for (const entry of [...fs.readDir(absDir)].sort()) {
        const childRel = joinPosix(relDir, entry);
        if (fs.isDirectory(joinPosix(root, childRel))) {
          walk(childRel, remaining);
        }
      }
      return;
    }
    if (segment === '*') {
      if (!fs.isDirectory(absDir)) return;
      for (const entry of [...fs.readDir(absDir)].sort()) {
        const childRel = joinPosix(relDir, entry);
        if (fs.isDirectory(joinPosix(root, childRel))) {
          walk(childRel, rest);
        }
      }
      return;
    }
    // Literal segment.
    const childRel = joinPosix(relDir, segment);
    if (fs.isDirectory(joinPosix(root, childRel))) {
      walk(childRel, rest);
    }
  };

  walk('', segments);
  // Keep only directories that actually contain a package.json.
  return results.filter((rel) => fs.exists(joinPosix(root, rel, 'package.json')));
}

/** Read the declared package `name` from a directory's `package.json`, if any. */
function packageName(fs: DiscoveryFs, root: string, relDir: string): string | undefined {
  const manifestPath = joinPosix(root, relDir, 'package.json');
  if (!fs.exists(manifestPath)) return undefined;
  try {
    const parsed: unknown = JSON.parse(fs.readFile(manifestPath));
    if (typeof parsed === 'object' && parsed !== null) {
      const name = (parsed as Record<string, unknown>)['name'];
      if (typeof name === 'string' && name.trim() !== '') return name;
    }
  } catch {
    // A malformed manifest falls back to the directory basename.
  }
  return undefined;
}

/**
 * Discover workspace packages under `root` using the injected {@link DiscoveryFs}.
 *
 * Reads globs from `package.json` `workspaces` (array or object-with-`packages`)
 * and `pnpm-workspace.yaml` `packages:`, unions them, expands each to the
 * directories containing a `package.json`, and returns one
 * {@link DiscoveredPackage} per unique directory. Each package's `name` is its
 * manifest `name` (fallback: directory basename) and its `srcDir` is the package
 * directory relative to `root` with a `./` prefix. The result is de-duplicated
 * and sorted by `srcDir` for determinism (NFR-001). Returns `[]` when no
 * workspaces are declared or none expand to a package directory.
 */
export function discoverWorkspaces(fs: DiscoveryFs, root: string): DiscoveredPackage[] {
  const globs: string[] = [];

  const pkgJsonPath = joinPosix(root, 'package.json');
  if (fs.exists(pkgJsonPath)) {
    try {
      globs.push(...globsFromPackageJson(JSON.parse(fs.readFile(pkgJsonPath))));
    } catch {
      // A malformed root package.json contributes no globs.
    }
  }

  const pnpmPath = joinPosix(root, 'pnpm-workspace.yaml');
  if (fs.exists(pnpmPath)) {
    globs.push(...globsFromPnpmWorkspace(fs.readFile(pnpmPath)));
  }

  // Union the glob sets and expand. De-duplicate directories by relative path.
  const byRel = new Map<string, DiscoveredPackage>();
  for (const glob of globs) {
    for (const rel of expandGlob(fs, root, glob)) {
      if (byRel.has(rel)) continue;
      const name = packageName(fs, root, rel) ?? basename(rel);
      byRel.set(rel, { name, srcDir: `./${rel}` });
    }
  }

  return [...byRel.values()].sort((a, b) => a.srcDir.localeCompare(b.srcDir));
}
