/**
 * ci-health-audit CLI — typed config/usage error (CIHA-I-0002, Phase 2).
 *
 * A {@link ConfigError} signals a config or usage problem (missing/unreadable/
 * schema-invalid config, `init` refusing to overwrite without `--force`). The
 * top-level dispatcher maps it to **exit code 2**, distinct from a gate FAIL
 * (exit 1) and a clean run (exit 0) — the public exit-code contract (NFR-004).
 */

/** A config or usage error; maps to exit code 2 in the dispatcher. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}
