/**
 * `dependency-cruiser` runner + parser (CIHA-I-0001, Phase 4).
 *
 * `parseDepcruise` is a PURE function that turns already-parsed `depcruise
 * … --output-type json` output into normalized `{ modules, edges }`, filtering
 * externals and deduplicating edges exactly as the reference does. `runDepcruise`
 * performs the upward `tsconfig.json` search, shells the command through the
 * injected {@link CommandRunner}, and feeds its stdout to the parser.
 *
 * Reference: `apps/runner/src/plugins/tools/depcruise.ts:50-63` (command),
 * `:95-139` (parse/normalize/dedup), `:141-153` (tsconfig search),
 * `:162-164` (external predicate).
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import type { Edge, ModuleEntry, ScanContext } from '../../scanner/types.js';

/** Thrown when `depcruise` output is missing, non-zero-exit, or unparseable (NFR-004). */
export class DepcruiseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DepcruiseError';
  }
}

/** One dependency of a module in `depcruise` output. */
const dependencySchema = z.object({
  resolved: z.string(),
});

/** One module in `output.modules`. */
const moduleSchema = z.object({
  source: z.string(),
  dependencies: z.array(dependencySchema),
});

const depcruiseOutputSchema = z.object({
  modules: z.array(moduleSchema),
});

/**
 * External predicate ported verbatim from `depcruise.ts:162-164`: a path is
 * external if it lives in `node_modules`, is a `node:` builtin, or has no `/`
 * (a bare specifier).
 */
function isExternal(filePath: string): boolean {
  return (
    filePath.includes('node_modules') ||
    filePath.startsWith('node:') ||
    !filePath.includes('/')
  );
}

/**
 * Parse already-decoded `depcruise` JSON into normalized internal modules and
 * deduplicated edges. External dependencies are filtered out; edges are deduped
 * by `sourcePath|normalizedDep`. Degenerate input (no modules) yields empty
 * arrays without throwing (NFR-005).
 */
export function parseDepcruise(json: unknown): {
  modules: ModuleEntry[];
  edges: Edge[];
} {
  const result = depcruiseOutputSchema.safeParse(json);
  if (!result.success) {
    throw new DepcruiseError(
      `Unable to parse depcruise output: ${result.error.message}`,
      { cause: result.error },
    );
  }

  const modules: ModuleEntry[] = [];
  const edges: Edge[] = [];
  const seenEdges = new Set<string>();

  for (const mod of result.data.modules) {
    const sourcePath = mod.source;
    if (isExternal(sourcePath)) {
      continue;
    }

    const deps: string[] = [];
    for (const dep of mod.dependencies) {
      const normalizedDep = dep.resolved;
      if (isExternal(normalizedDep)) {
        continue;
      }

      const key = `${sourcePath}|${normalizedDep}`;
      if (seenEdges.has(key)) {
        continue;
      }
      seenEdges.add(key);

      deps.push(normalizedDep);
      edges.push({ fromPath: sourcePath, toPath: normalizedDep });
    }

    modules.push({ source: sourcePath, dependencies: deps });
  }

  return { modules, edges };
}

/**
 * Search upward from `startDir` for a `tsconfig.json`, stopping at the
 * filesystem root. Returns the absolute path if found, else `undefined`.
 * Reference: `depcruise.ts:141-153`.
 */
export function findTsConfig(startDir: string): string | undefined {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, 'tsconfig.json');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * Build the JS body of a generated depcruise config. Carries `tsConfig` (when
 * found) and — critically — `enhancedResolveOptions.extensions` with `.ts`/`.tsx`
 * ahead of `.js`/`.jsx`. NodeNext ESM code imports its siblings with `.js`
 * specifiers (`import './x.js'`) that physically resolve to `./x.ts`; without
 * this extension order depcruise leaves those specifiers unresolved, producing
 * dangling `./x.js` edge targets that never match the real `.ts` module nodes
 * and silently disconnecting the whole dependency graph.
 */
function buildDepcruiseConfig(tsConfigPath: string | undefined): string {
  const tsConfigLine =
    tsConfigPath === undefined
      ? ''
      : `    tsConfig: { fileName: ${JSON.stringify(tsConfigPath)} },\n`;
  const lines = [
    'module.exports = {',
    '  options: {',
    '    tsPreCompilationDeps: true,',
    tsConfigLine.replace(/\n$/, ''),
    "    exclude: 'node_modules',",
    '    enhancedResolveOptions: {',
    "      extensions: ['.ts', '.tsx', '.js', '.jsx'],",
    '    },',
    '  },',
    '};',
    '',
  ];
  return lines.filter((line) => line.length > 0).join('\n');
}

/**
 * Shell `depcruise` via the injected runner, JSON-decode the stdout, and parse
 * it. Runs with cwd = the resolved (absolute) `srcDir` and scans `srcDir`-relative
 * globs (`**\/*.ts`, …) rather than embedding `srcDir` in the glob, so a relative
 * `srcDir` (e.g. the default `"./src"`) works and does not become
 * `srcDir/srcDir`. Because cwd is `srcDir`, module `source` strings come back
 * relative to `srcDir` — identical to `scc`'s relativized paths, so graph nodes
 * match. Searches upward from `srcDir` for a `tsconfig.json` and threads it (plus
 * TS-aware extension resolution) through a generated, throwaway depcruise config
 * so `.js` ESM import specifiers resolve to their real `.ts` files. Runner
 * failures (missing binary / non-zero exit) and unparseable stdout surface as
 * {@link DepcruiseError} (NFR-004).
 */
export function runDepcruise(ctx: ScanContext): {
  modules: ModuleEntry[];
  edges: Edge[];
} {
  const absSrcDir = resolve(ctx.srcDir);
  const tsConfigPath = findTsConfig(absSrcDir);

  const globs = ['"**/*.ts"', '"**/*.tsx"', '"**/*.js"', '"**/*.jsx"'].join(' ');

  const configDir = mkdtempSync(join(tmpdir(), 'ciha-depcruise-'));
  const configPath = join(configDir, 'depcruise.config.cjs');
  let stdout: string;
  try {
    writeFileSync(configPath, buildDepcruiseConfig(tsConfigPath), 'utf8');
    const command = `depcruise --config "${configPath}" --output-type json ${globs}`;
    stdout = ctx.runner.run(command, absSrcDir);
  } catch (cause) {
    throw new DepcruiseError(
      'Failed to run depcruise. Is the "depcruise" binary installed and on PATH?',
      { cause },
    );
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }

  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch (cause) {
    throw new DepcruiseError(
      'depcruise produced output that is not valid JSON.',
      { cause },
    );
  }

  return parseDepcruise(json);
}
