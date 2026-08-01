/**
 * ci-health-audit CLI — `init` handler (CIHA-I-0002, Phase 2 / CIHA-T-0010;
 * extended for CIHA-I-0003, Phase 5 / CIHA-T-0019).
 *
 * Scaffolds a `ci-health-audit.config.json`. As of v0.2.0 `init` is
 * monorepo-aware: it auto-discovers workspaces (npm/yarn `package.json`
 * `workspaces` and `pnpm-workspace.yaml`) via {@link discoverWorkspaces} and
 * writes one project per workspace, sharing the {@link DEFAULT_CONFIG}
 * threshold/weights/baselines and seeding each `lastScore` to 0 (REQ-007).
 *
 * When no workspaces are discovered it falls back to a single root project
 * (`name: "."`, `srcDir: "./src"`, `lastScore: 0`). Fallback is silent in
 * non-interactive contexts (CI, tests); when `stdout.isTTY` the handler MAY
 * prompt the user to confirm/add projects — that prompt lives behind an
 * injectable {@link InitDeps.prompt} seam and a TTY check so non-interactive
 * runs never block (NFR-001 determinism / no-hang in CI).
 *
 * It still refuses to overwrite an existing config unless `--force` (exit 2
 * otherwise, REQ-001), and writes 2-space indent + trailing newline to match the
 * atomic writer's formatting.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { DEFAULT_CONFIG } from '../../index.js';
import { ConfigError } from '../errors.js';
import {
  discoverWorkspaces,
  type DiscoveredPackage,
  type DiscoveryFs,
} from '../discoverWorkspaces.js';
import type { Writer } from '../writer.js';

/** Options for {@link runInit}, already resolved by the dispatcher. */
export interface InitOptions {
  /** Absolute path to write the config to. */
  configPath: string;
  /** Overwrite an existing config when `true`. */
  force: boolean;
}

/**
 * One project entry as written to disk: required `name`/`srcDir`/`lastScore`
 * (per-project overrides are omitted so each inherits the shared defaults).
 */
interface ScaffoldProject {
  name: string;
  srcDir: string;
  lastScore: number;
}

/**
 * Injectable seams for {@link runInit}, so tests avoid real filesystem/TTY IO.
 * Every field is optional; the production defaults wire to `node:fs`,
 * `process.cwd()`, and `process.stdout.isTTY`.
 */
export interface InitDeps {
  /** Filesystem seam used for workspace discovery (default: real `node:fs`). */
  fs?: DiscoveryFs;
  /** Repo root that discovery globs are resolved against (default: `cwd()`). */
  root?: string;
  /** Whether the process is attached to an interactive terminal. */
  isTty?: boolean;
  /**
   * Interactive prompt seam, invoked only when no workspaces are discovered and
   * `isTty` is true. Receives the single-root fallback and returns the projects
   * to write (it may confirm the fallback or return a user-supplied list). When
   * omitted, the fallback is used as-is even in a TTY.
   */
  prompt?(fallback: ScaffoldProject): readonly ScaffoldProject[];
}

/** The single-root fallback project used when no workspaces are discovered. */
const ROOT_FALLBACK: ScaffoldProject = { name: '.', srcDir: './src', lastScore: 0 };

/**
 * A {@link DiscoveryFs} backed by `node:fs`, relative to the process. Paths are
 * POSIX-joined by the discovery module and passed here as-is; `node:path.join`
 * normalizes them for the host platform.
 */
const realDiscoveryFs: DiscoveryFs = {
  exists: (path) => existsSync(path),
  readFile: (path) => readFileSync(path, 'utf8'),
  isDirectory: (path) => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  readDir: (path) => {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },
};

/**
 * Resolve the list of projects `init` should write. Discovers workspaces under
 * `root`; when at least one is found, maps each to a scaffold project seeded at
 * `lastScore: 0`. When none are found, uses the single-root fallback — routed
 * through the interactive `prompt` seam when `isTty` is true, otherwise silent.
 */
function resolveProjects(deps: InitDeps): readonly ScaffoldProject[] {
  const fs = deps.fs ?? realDiscoveryFs;
  const root = deps.root ?? process.cwd();
  const discovered: DiscoveredPackage[] = discoverWorkspaces(fs, root);

  if (discovered.length > 0) {
    return discovered.map((pkg) => ({ name: pkg.name, srcDir: pkg.srcDir, lastScore: 0 }));
  }

  const isTty = deps.isTty ?? process.stdout.isTTY;
  if (isTty && deps.prompt) {
    const chosen = deps.prompt(ROOT_FALLBACK);
    if (chosen.length > 0) return chosen;
  }
  return [ROOT_FALLBACK];
}

/**
 * Assemble the v0.2.0 config object: the shared {@link DEFAULT_CONFIG} defaults
 * (language/threshold/weights/baselines) plus the resolved `projects` array.
 */
function buildConfig(projects: readonly ScaffoldProject[]): Record<string, unknown> {
  return {
    language: DEFAULT_CONFIG.language,
    threshold: DEFAULT_CONFIG.threshold,
    weights: DEFAULT_CONFIG.weights,
    baselines: DEFAULT_CONFIG.baselines,
    projects,
  };
}

/**
 * Write the scaffold config to `configPath`. Discovers workspaces (or falls back
 * to a single root project) and writes the v0.2.0 config shape with 2-space
 * indent + trailing newline. Returns the exit code: `0` on a successful write.
 * Throws {@link ConfigError} (→ exit 2) if the file already exists and `--force`
 * was not passed.
 */
export function runInit(opts: InitOptions, writer: Writer, deps: InitDeps = {}): number {
  if (existsSync(opts.configPath) && !opts.force) {
    throw new ConfigError(
      `Config already exists: ${opts.configPath}. Pass --force to overwrite.`,
    );
  }

  const projects = resolveProjects(deps);
  const config = buildConfig(projects);
  const output = `${JSON.stringify(config, null, 2)}\n`;
  writeFileSync(opts.configPath, output);
  writer.out(`Wrote config: ${opts.configPath}`);
  if (projects.length === 1 && projects[0] === ROOT_FALLBACK) {
    writer.out('No workspaces discovered; scaffolded a single root project.');
  } else {
    writer.out(`Discovered ${String(projects.length)} project(s).`);
  }
  return 0;
}
