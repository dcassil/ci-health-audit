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
import { runInit } from '../../src/cli/commands/init.js';
import type { DiscoveryFs } from '../../src/cli/discoverWorkspaces.js';

/** In-memory {@link DiscoveryFs} from a path → contents map (see discovery tests). */
function makeFs(files: Record<string, string>): DiscoveryFs {
  const filePaths = new Set(Object.keys(files));
  const dirPaths = new Set<string>();
  for (const path of filePaths) {
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i += 1) dirPaths.add(segments.slice(0, i).join('/'));
  }
  return {
    exists: (p) => filePaths.has(p) || dirPaths.has(p),
    readFile: (p) => {
      const c = files[p];
      if (c === undefined) throw new Error(`no such file: ${p}`);
      return c;
    },
    isDirectory: (p) => dirPaths.has(p),
    readDir: (p) => {
      const prefix = `${p}/`;
      const children = new Set<string>();
      for (const q of [...filePaths, ...dirPaths]) {
        if (q.startsWith(prefix)) {
          const first = q.slice(prefix.length).split('/')[0];
          if (first !== undefined) children.add(first);
        }
      }
      return [...children];
    },
  };
}

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

  it('writes the single-root fallback config (no workspaces), 2-space indent + trailing newline, exit 0', () => {
    const { writer, captured } = makeWriter();
    // Empty fs at an isolated root ⇒ no workspaces discovered ⇒ single root.
    const fs = makeFs({ '/root/package.json': JSON.stringify({ name: 'solo' }) });
    const code = runInit({ configPath, force: false }, writer, { fs, root: '/root', isTty: false });

    expect(code).toBe(0);
    expect(existsSync(configPath)).toBe(true);
    const text = readFileSync(configPath, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('  "language": "ts"');
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      language: 'ts',
      threshold: -2,
      projects: [{ name: '.', srcDir: './src', lastScore: 0 }],
    });
    expect(captured.out.join('\n')).toContain(configPath);
    expect(captured.out.join('\n')).toContain('single root project');
  });

  it('writes one project per discovered workspace (npm + pnpm), exit 0', () => {
    const { writer } = makeWriter();
    const fs = makeFs({
      '/root/package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      '/root/packages/core/package.json': JSON.stringify({ name: '@acme/core' }),
      '/root/packages/cli/package.json': JSON.stringify({ name: '@acme/cli' }),
    });
    const code = runInit({ configPath, force: false }, writer, { fs, root: '/root', isTty: false });

    expect(code).toBe(0);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    expect(parsed['projects']).toEqual([
      { name: '@acme/cli', srcDir: './packages/cli', lastScore: 0 },
      { name: '@acme/core', srcDir: './packages/core', lastScore: 0 },
    ]);
  });

  it('non-TTY never invokes the prompt seam (silent single-root fallback)', () => {
    const { writer } = makeWriter();
    const fs = makeFs({ '/root/package.json': JSON.stringify({ name: 'solo' }) });
    let prompted = false;
    const code = runInit({ configPath, force: false }, writer, {
      fs,
      root: '/root',
      isTty: false,
      prompt: () => {
        prompted = true;
        return [];
      },
    });

    expect(code).toBe(0);
    expect(prompted).toBe(false);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    expect(parsed['projects']).toEqual([{ name: '.', srcDir: './src', lastScore: 0 }]);
  });

  it('TTY prompt seam can supply the projects to write', () => {
    const { writer } = makeWriter();
    const fs = makeFs({ '/root/package.json': JSON.stringify({ name: 'solo' }) });
    const code = runInit({ configPath, force: false }, writer, {
      fs,
      root: '/root',
      isTty: true,
      prompt: () => [{ name: 'custom', srcDir: './lib', lastScore: 0 }],
    });

    expect(code).toBe(0);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    expect(parsed['projects']).toEqual([{ name: 'custom', srcDir: './lib', lastScore: 0 }]);
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
