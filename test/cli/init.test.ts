/**
 * CLI `init` handler tests (CIHA-T-0010, TC-002).
 *
 * Exercises the dispatcher end-to-end (via {@link run}) with an in-memory writer
 * and a temp dir: default scaffold + formatting, refusal without `--force`
 * (exit 2, file untouched), and `--force` overwrite.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../../src/cli/program.js';

interface Captured {
  out: string[];
  err: string[];
}

function makeWriter(): { writer: { out(l: string): void; err(l: string): void }; captured: Captured } {
  const captured: Captured = { out: [], err: [] };
  return {
    captured,
    writer: {
      out: (l): void => void captured.out.push(l),
      err: (l): void => void captured.err.push(l),
    },
  };
}

describe('cli init', () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ciha-init-'));
    configPath = join(dir, 'ci-health-audit.config.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the default config with 2-space indent + trailing newline, exit 0', async () => {
    const { writer, captured } = makeWriter();
    const code = await run(['init', '--config', configPath], { writer });

    expect(code).toBe(0);
    expect(existsSync(configPath)).toBe(true);
    const text = readFileSync(configPath, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('  "language": "ts"');
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed).toMatchObject({ language: 'ts', srcDir: './src', lastScore: 0, threshold: -2 });
    expect(captured.out.join('\n')).toContain(configPath);
  });

  it('refuses to overwrite an existing config without --force (exit 2, file untouched)', async () => {
    writeFileSync(configPath, '{"language":"ts"}\n');
    const { writer, captured } = makeWriter();
    const code = await run(['init', '--config', configPath], { writer });

    expect(code).toBe(2);
    expect(readFileSync(configPath, 'utf8')).toBe('{"language":"ts"}\n');
    expect(captured.err.join('\n')).toContain(configPath);
  });

  it('overwrites an existing config with --force (exit 0)', async () => {
    writeFileSync(configPath, '{"language":"ts"}\n');
    const { writer } = makeWriter();
    const code = await run(['init', '--config', configPath, '--force'], { writer });

    expect(code).toBe(0);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    expect(parsed['threshold']).toBe(-2);
  });
});
