import { describe, expect, it } from 'vitest';
import {
  NoPluginForLanguageError,
  PluginRegistry,
} from '../src/scanner/registry.js';
import type {
  Language,
  ScanContext,
  ToolPlugin,
  ToolRunOutput,
} from '../src/scanner/types.js';

const emptyOutput: ToolRunOutput = {
  raw: null,
  fileStats: [],
  modules: [],
  edges: [],
};

function makePlugin(id: string, languages: Language[] | undefined): ToolPlugin {
  return {
    id,
    supports: languages === undefined ? {} : { languages },
    run: (_ctx: ScanContext): Promise<ToolRunOutput> =>
      Promise.resolve(emptyOutput),
  };
}

describe('PluginRegistry', () => {
  it('resolves a registered plugin for each of the four TS/JS aliases', () => {
    const registry = new PluginRegistry();
    const plugin = makePlugin('ts', [
      'ts',
      'js',
      'typescript',
      'javascript',
    ]);
    registry.register(plugin);

    const aliases: Language[] = ['ts', 'js', 'typescript', 'javascript'];
    for (const alias of aliases) {
      expect(registry.resolve(alias)).toBe(plugin);
    }
  });

  it('throws a descriptive NoPluginForLanguageError for an unsupported language', () => {
    const registry = new PluginRegistry();
    registry.register(makePlugin('ts', ['ts', 'typescript']));

    expect(() => registry.resolve('js')).toThrow(NoPluginForLanguageError);
    expect(() => registry.resolve('js')).toThrow(/No tool plugin registered/);
    expect(() => registry.resolve('js')).toThrow(/"ts"/);
  });

  it('throws when the registry is empty', () => {
    const registry = new PluginRegistry();
    expect(() => registry.resolve('ts')).toThrow(NoPluginForLanguageError);
    expect(() => registry.resolve('ts')).toThrow(/\(none\)/);
  });

  it('returns the first-registered plugin when two support the same language (first-match wins)', () => {
    const registry = new PluginRegistry();
    const first = makePlugin('first', ['ts']);
    const second = makePlugin('second', ['ts']);
    registry.register(first);
    registry.register(second);

    expect(registry.resolve('ts')).toBe(first);
  });

  it('skips plugins with no declared languages', () => {
    const registry = new PluginRegistry();
    const noLangs = makePlugin('bare', undefined);
    const tsPlugin = makePlugin('ts', ['ts']);
    registry.register(noLangs);
    registry.register(tsPlugin);

    expect(registry.resolve('ts')).toBe(tsPlugin);
  });
});
