/**
 * ci-health-audit CLI — config file resolver/loader (CIHA-I-0002, Phase 2).
 *
 * Resolves the `--config` path (default `./ci-health-audit.config.json`), reads
 * and JSON-parses it, and delegates schema validation to the engine's
 * {@link loadConfig}. Every failure mode — missing file, unreadable file,
 * malformed JSON, or schema-invalid content — is rethrown as a {@link ConfigError}
 * naming the file and the problem, so the dispatcher can map it to exit code 2
 * (REQ-006, NFR-004). This keeps commander thin and the engine a black box.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, type ConfigFile } from '../index.js';
import { ConfigError } from './errors.js';

/** The default config path, relative to the current working directory. */
export const DEFAULT_CONFIG_PATH = './ci-health-audit.config.json';

/** Resolve a (possibly relative) `--config` value against cwd to an absolute path. */
export function resolveConfigPath(configPath: string | undefined): string {
  return resolve(configPath ?? DEFAULT_CONFIG_PATH);
}

/**
 * Read, parse, and validate the config at `absPath`. Throws {@link ConfigError}
 * (→ exit 2) naming the file on any failure. Never shells out; pure file I/O +
 * the engine's pure {@link loadConfig}.
 */
export function loadConfigFile(absPath: string): ConfigFile {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    throw new ConfigError(`Cannot read config file: ${absPath} (missing or unreadable).`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Config file is not valid JSON: ${absPath} — ${detail}`);
  }

  try {
    // Validate and return the full multi-project ConfigFile. The CLI's scan/gate
    // handler drives the multi-project engine (`scanProjects`) and gate
    // (`evaluateGateAll`) directly; no single-project reduction happens here
    // (CIHA-I-0003 Phase 4 / CIHA-T-0018).
    return loadConfig(parsed);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Invalid config file: ${absPath}\n${detail}`);
  }
}
