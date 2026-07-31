/**
 * ci-health-audit CLI — commander wiring + dispatcher (CIHA-I-0002, Phase 2).
 *
 * Maps `init`, `scan [--gate]`, and `gate` to the handlers and owns the public
 * exit-code contract (NFR-004):
 *
 *   0  report printed, or gate PASS (held/seeded/within threshold)
 *   1  gate FAIL (`newScore < lastScore + threshold`)
 *   2  config or usage error (missing/unreadable/invalid config, unknown command,
 *      `init` refusing overwrite without `--force`)
 *
 * commander stays thin: it only parses flags and calls a handler. All business
 * logic lives in the handlers and the (Phase-1) gate modules. A single try/catch
 * maps {@link ConfigError} and commander usage errors to exit 2; handlers return
 * 0/1 explicitly. `run` never calls `process.exit` itself — it returns the code,
 * so it is fully unit-testable; the `main` entry applies it to `process.exitCode`.
 */
import { Command, CommanderError } from 'commander';
import { ConfigError } from './errors.js';
import { resolveConfigPath } from './loadConfigFile.js';
import { runInit } from './commands/init.js';
import { runScan, type ScanFn } from './commands/scan.js';
import { processWriter, type Writer } from './writer.js';

/** Injectable seams for {@link run}, so tests avoid real streams and the engine. */
export interface RunDeps {
  /** Output sink (default: the real process streams). */
  writer?: Writer;
  /** Engine scan (default: the real engine); tests inject a fake. */
  scan?: ScanFn;
}

interface ConfigFlag {
  config?: string;
}
interface InitFlags extends ConfigFlag {
  force?: boolean;
}
interface ScanFlags extends ConfigFlag {
  gate?: boolean;
  json?: boolean;
}
interface GateFlags extends ConfigFlag {
  json?: boolean;
}

/**
 * Parse `argv` (without the leading `node`/script entries) and run the matched
 * command. Returns the process exit code; never throws for known errors and
 * never calls `process.exit`.
 */
export async function run(argv: readonly string[], deps: RunDeps = {}): Promise<number> {
  const writer = deps.writer ?? processWriter;
  const scan = deps.scan;

  let exitCode = 0;
  const program = new Command();
  program
    .name('ci-health-audit')
    .description('Deterministic 0–10 code health score for JS/TS codebases.')
    .exitOverride()
    .configureOutput({
      writeOut: (str) => {
        writer.out(str.replace(/\n$/, ''));
      },
      writeErr: (str) => {
        writer.err(str.replace(/\n$/, ''));
      },
    });

  program
    .command('init')
    .description('Scaffold a ci-health-audit.config.json in the current directory.')
    .option('-c, --config <path>', 'Path to the config file')
    .option('-f, --force', 'Overwrite an existing config file')
    .action((flags: InitFlags) => {
      exitCode = runInit(
        { configPath: resolveConfigPath(flags.config), force: flags.force ?? false },
        writer,
      );
    });

  program
    .command('scan')
    .description('Compute and print the health score (report mode; --gate to gate).')
    .option('-c, --config <path>', 'Path to the config file')
    .option('--gate', 'Behave like `gate`: evaluate regression and write back on pass')
    .option('--json', 'Emit machine-readable JSON instead of the human table')
    .action(async (flags: ScanFlags) => {
      exitCode = await runScan(
        { configPath: resolveConfigPath(flags.config), gate: flags.gate ?? false, json: flags.json ?? false },
        writer,
        scan,
      );
    });

  program
    .command('gate')
    .description('Gate mode: fail (exit 1) on a regression beyond threshold; else write back.')
    .option('-c, --config <path>', 'Path to the config file')
    .option('--json', 'Emit machine-readable JSON instead of the human table')
    .action(async (flags: GateFlags) => {
      exitCode = await runScan(
        { configPath: resolveConfigPath(flags.config), gate: true, json: flags.json ?? false },
        writer,
        scan,
      );
    });

  try {
    await program.parseAsync(argv, { from: 'user' });
    return exitCode;
  } catch (error) {
    return handleError(error, writer);
  }
}

/** Map a thrown error to an exit code, writing a message for real failures. */
function handleError(error: unknown, writer: Writer): number {
  if (error instanceof ConfigError) {
    writer.err(error.message);
    return 2;
  }
  if (error instanceof CommanderError) {
    // commander already printed help/version or an unknown-command/usage message.
    // Its `--help`/`--version` paths use exit code 0; usage errors are 2.
    return error.exitCode === 0 ? 0 : 2;
  }
  const detail = error instanceof Error ? error.message : String(error);
  writer.err(`ci-health-audit: unexpected error — ${detail}`);
  return 2;
}
