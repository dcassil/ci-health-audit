/**
 * ci-health-audit CLI — `init` handler (CIHA-I-0002, Phase 2 / CIHA-T-0010).
 *
 * Scaffolds a `ci-health-audit.config.json` from the engine defaults. Refuses to
 * overwrite an existing file unless `--force` (exit 2 otherwise, REQ-001). The
 * scaffolded config omits `baselines` so the engine applies its ported defaults;
 * a user may add a `baselines` block later. Output uses 2-space indent + trailing
 * newline to match the atomic writer's formatting.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { DEFAULT_CONFIG } from '../../index.js';
import { ConfigError } from '../errors.js';
import type { Writer } from '../writer.js';

/** Options for {@link runInit}, already resolved by the dispatcher. */
export interface InitOptions {
  /** Absolute path to write the config to. */
  configPath: string;
  /** Overwrite an existing config when `true`. */
  force: boolean;
}

/**
 * The default config `init` scaffolds (Detailed Design "Default config").
 *
 * The Detailed Design shows a `baselines`-less shape "so the engine applies its
 * ported defaults", but the engine's config schema (CIHA-I-0001) requires an
 * explicit `baselines` block and applies no default for it — a baseline-less
 * config fails validation and `scan`/`gate` can't run. To keep `init` producing a
 * config that is valid and immediately scannable (the whole point of `init`), we
 * write the specified equal `weights` (0.2 each) **plus** the engine's ported
 * baseline table from {@link DEFAULT_CONFIG}. A user may edit the baselines to
 * override. This is the one place this task diverges from the Detailed Design,
 * and it does so to satisfy the engine's actual contract.
 */
const SCAFFOLD_CONFIG = {
  language: 'ts',
  srcDir: './src',
  lastScore: 0,
  threshold: -2,
  weights: {
    ts: {
      locPerModule: 0.2,
      depDepth: 0.2,
      circularDeps: 0.2,
      complexity: 0.2,
      fanInOut: 0.2,
    },
  },
  baselines: DEFAULT_CONFIG.baselines,
};

/**
 * Write the scaffold config to `configPath`. Returns the exit code: `0` on a
 * successful write. Throws {@link ConfigError} (→ exit 2) if the file already
 * exists and `--force` was not passed.
 */
export function runInit(opts: InitOptions, writer: Writer): number {
  if (existsSync(opts.configPath) && !opts.force) {
    throw new ConfigError(
      `Config already exists: ${opts.configPath}. Pass --force to overwrite.`,
    );
  }

  const output = `${JSON.stringify(SCAFFOLD_CONFIG, null, 2)}\n`;
  writeFileSync(opts.configPath, output);
  writer.out(`Wrote config: ${opts.configPath}`);
  return 0;
}
