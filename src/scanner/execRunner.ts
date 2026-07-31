/**
 * Real {@link CommandRunner} (CIHA-I-0001, Phase 8).
 *
 * The one impure default behind `scan()`: it shells commands synchronously via
 * `child_process.execSync` in a given working directory and returns their
 * stdout. This is the only place `execSync` lives outside tests; the scanner
 * core stays pure and injectable (NFR-006). Non-zero exits (e.g. a missing
 * `scc`/`depcruise` binary) surface as a typed {@link CommandExecutionError}
 * carrying the command, cwd, exit status, and captured stderr (NFR-004).
 */
import { execSync } from 'node:child_process';
import type { CommandRunner } from './types.js';

/** Shape of the error `execSync` throws on a non-zero exit, narrowed safely. */
interface ExecSyncFailure {
  status: number | null;
  stderr: Buffer | string | null;
}

function isExecSyncFailure(value: unknown): value is ExecSyncFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('status' in value || 'stderr' in value)
  );
}

/**
 * Thrown when a shelled command fails to run or exits non-zero. Names the
 * command and cwd so a missing binary or a tool error is immediately
 * diagnosable (NFR-004).
 */
export class CommandExecutionError extends Error {
  readonly command: string;
  readonly cwd: string;
  readonly status: number | null;

  constructor(
    command: string,
    cwd: string,
    status: number | null,
    stderr: string,
    options?: { cause?: unknown },
  ) {
    const detail = stderr.trim().length > 0 ? `\nstderr:\n${stderr.trim()}` : '';
    super(
      `Command failed (exit ${String(status ?? 'unknown')}) in "${cwd}": ${command}${detail}`,
      options,
    );
    this.name = 'CommandExecutionError';
    this.command = command;
    this.cwd = cwd;
    this.status = status;
  }
}

/** Max stdout captured from a single command (64 MiB) — large scc/depcruise JSON. */
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * The real, `execSync`-backed {@link CommandRunner}. Runs `command` in `cwd`
 * and returns stdout as a UTF-8 string. Any failure is rethrown as a
 * {@link CommandExecutionError} preserving the original as `cause`.
 */
export const execCommandRunner: CommandRunner = {
  run(command: string, cwd: string): string {
    try {
      return execSync(command, {
        cwd,
        encoding: 'utf8',
        maxBuffer: MAX_BUFFER,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (cause) {
      const status = isExecSyncFailure(cause) ? cause.status : null;
      const rawStderr = isExecSyncFailure(cause) ? cause.stderr : null;
      const stderr = rawStderr === null ? '' : rawStderr.toString();
      throw new CommandExecutionError(command, cwd, status, stderr, { cause });
    }
  },
};
