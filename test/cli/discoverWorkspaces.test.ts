/**
 * Workspace discovery tests (CIHA-T-0019, REQ-007, NFR-001).
 *
 * Drives {@link discoverWorkspaces} through an in-memory {@link DiscoveryFs}
 * fixture (no real filesystem), covering: npm array workspaces, npm object
 * `{ packages: [] }` workspaces, `pnpm-workspace.yaml` `packages:`, a mixed
 * repo, glob expansion (`*`/`**`, filtering to dirs with a `package.json`),
 * name-from-manifest vs directory-basename fallback, determinism (sorted +
 * de-duplicated), and none-found → empty result.
 */
import { describe, it, expect } from 'vitest';
import {
  discoverWorkspaces,
  type DiscoveryFs,
} from '../../src/cli/discoverWorkspaces.js';

/** Build an in-memory {@link DiscoveryFs} from a flat map of path → contents. */
function makeFs(files: Record<string, string>): DiscoveryFs {
  const filePaths = new Set(Object.keys(files));
  const dirPaths = new Set<string>();
  for (const path of filePaths) {
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i += 1) {
      dirPaths.add(segments.slice(0, i).join('/'));
    }
  }
  return {
    exists: (path) => filePaths.has(path) || dirPaths.has(path),
    readFile: (path) => {
      const content = files[path];
      if (content === undefined) throw new Error(`no such file: ${path}`);
      return content;
    },
    isDirectory: (path) => dirPaths.has(path),
    readDir: (path) => {
      const prefix = `${path}/`;
      const children = new Set<string>();
      for (const p of [...filePaths, ...dirPaths]) {
        if (p.startsWith(prefix)) {
          const first = p.slice(prefix.length).split('/')[0];
          if (first !== undefined) children.add(first);
        }
      }
      return [...children];
    },
  };
}

const ROOT = '/repo';

describe('discoverWorkspaces', () => {
  it('reads npm array workspaces and expands packages/*', () => {
    const fs = makeFs({
      '/repo/package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      '/repo/packages/core/package.json': JSON.stringify({ name: '@acme/core' }),
      '/repo/packages/cli/package.json': JSON.stringify({ name: '@acme/cli' }),
    });
    expect(discoverWorkspaces(fs, ROOT)).toEqual([
      { name: '@acme/cli', srcDir: './packages/cli' },
      { name: '@acme/core', srcDir: './packages/core' },
    ]);
  });

  it('reads npm object workspaces ({ packages: [...] })', () => {
    const fs = makeFs({
      '/repo/package.json': JSON.stringify({ workspaces: { packages: ['apps/*'] } }),
      '/repo/apps/web/package.json': JSON.stringify({ name: 'web' }),
    });
    expect(discoverWorkspaces(fs, ROOT)).toEqual([
      { name: 'web', srcDir: './apps/web' },
    ]);
  });

  it('reads pnpm-workspace.yaml packages globs', () => {
    const fs = makeFs({
      '/repo/pnpm-workspace.yaml': ['packages:', '  - "packages/*"', "  - 'apps/*'"].join('\n'),
      '/repo/packages/a/package.json': JSON.stringify({ name: 'a' }),
      '/repo/apps/b/package.json': JSON.stringify({ name: 'b' }),
    });
    expect(discoverWorkspaces(fs, ROOT)).toEqual([
      { name: 'b', srcDir: './apps/b' },
      { name: 'a', srcDir: './packages/a' },
    ]);
  });

  it('unions npm + pnpm globs and de-duplicates directories', () => {
    const fs = makeFs({
      '/repo/package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      '/repo/pnpm-workspace.yaml': ['packages:', '  - packages/*', '  - libs/x'].join('\n'),
      '/repo/packages/core/package.json': JSON.stringify({ name: 'core' }),
      '/repo/libs/x/package.json': JSON.stringify({ name: 'x' }),
    });
    expect(discoverWorkspaces(fs, ROOT)).toEqual([
      { name: 'x', srcDir: './libs/x' },
      { name: 'core', srcDir: './packages/core' },
    ]);
  });

  it('expands ** recursively and keeps only dirs with a package.json', () => {
    const fs = makeFs({
      '/repo/package.json': JSON.stringify({ workspaces: ['packages/**'] }),
      '/repo/packages/core/package.json': JSON.stringify({ name: 'core' }),
      '/repo/packages/group/nested/package.json': JSON.stringify({ name: 'nested' }),
      // A dir with no package.json must be excluded even though it matches the glob.
      '/repo/packages/build-output/index.js': 'export {}',
    });
    expect(discoverWorkspaces(fs, ROOT)).toEqual([
      { name: 'core', srcDir: './packages/core' },
      { name: 'nested', srcDir: './packages/group/nested' },
    ]);
  });

  it('expands an exact directory path glob', () => {
    const fs = makeFs({
      '/repo/package.json': JSON.stringify({ workspaces: ['packages/only'] }),
      '/repo/packages/only/package.json': JSON.stringify({ name: 'only' }),
      '/repo/packages/other/package.json': JSON.stringify({ name: 'other' }),
    });
    expect(discoverWorkspaces(fs, ROOT)).toEqual([
      { name: 'only', srcDir: './packages/only' },
    ]);
  });

  it('falls back to the directory basename when package.json has no name', () => {
    const fs = makeFs({
      '/repo/package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      '/repo/packages/widget/package.json': JSON.stringify({ version: '1.0.0' }),
    });
    expect(discoverWorkspaces(fs, ROOT)).toEqual([
      { name: 'widget', srcDir: './packages/widget' },
    ]);
  });

  it('returns [] when no workspaces are declared', () => {
    const fs = makeFs({
      '/repo/package.json': JSON.stringify({ name: 'solo' }),
      '/repo/src/index.ts': 'export {}',
    });
    expect(discoverWorkspaces(fs, ROOT)).toEqual([]);
  });

  it('returns [] when globs match no directory with a package.json', () => {
    const fs = makeFs({
      '/repo/package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      '/repo/packages/tool/index.js': 'export {}',
    });
    expect(discoverWorkspaces(fs, ROOT)).toEqual([]);
  });

  it('tolerates a malformed root package.json (no globs from it)', () => {
    const fs = makeFs({
      '/repo/package.json': '{ not valid json',
      '/repo/pnpm-workspace.yaml': ['packages:', '  - packages/*'].join('\n'),
      '/repo/packages/a/package.json': JSON.stringify({ name: 'a' }),
    });
    expect(discoverWorkspaces(fs, ROOT)).toEqual([
      { name: 'a', srcDir: './packages/a' },
    ]);
  });

  it('ignores comments and blank lines in pnpm-workspace.yaml and stops at the next key', () => {
    const fs = makeFs({
      '/repo/pnpm-workspace.yaml': [
        '# workspace config',
        'packages:',
        '  - "packages/*"',
        '',
        '  - apps/* # inline comment',
        'catalog:',
        '  react: ^18',
      ].join('\n'),
      '/repo/packages/a/package.json': JSON.stringify({ name: 'a' }),
      '/repo/apps/b/package.json': JSON.stringify({ name: 'b' }),
    });
    expect(discoverWorkspaces(fs, ROOT)).toEqual([
      { name: 'b', srcDir: './apps/b' },
      { name: 'a', srcDir: './packages/a' },
    ]);
  });
});
