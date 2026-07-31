import type { Language, ToolPlugin } from './types.js';

/**
 * Thrown by {@link PluginRegistry.resolve} when no registered plugin supports
 * the requested language (NFR-004).
 */
export class NoPluginForLanguageError extends Error {
  readonly language: Language;

  constructor(language: Language, registeredIds: string[]) {
    const registered =
      registeredIds.length > 0
        ? registeredIds.map((id) => `"${id}"`).join(', ')
        : '(none)';
    super(
      `No tool plugin registered for language "${language}". Registered plugins: ${registered}.`,
    );
    this.name = 'NoPluginForLanguageError';
    this.language = language;
  }
}

/**
 * Language-keyed registry of {@link ToolPlugin}s. Plugins are stored in
 * registration order; `resolve` returns the first plugin whose
 * `supports.languages` includes the requested language.
 */
export class PluginRegistry {
  private readonly plugins: ToolPlugin[] = [];

  register(plugin: ToolPlugin): void {
    this.plugins.push(plugin);
  }

  resolve(language: Language): ToolPlugin {
    const plugin = this.plugins.find((p) =>
      p.supports.languages?.includes(language),
    );
    if (plugin === undefined) {
      throw new NoPluginForLanguageError(
        language,
        this.plugins.map((p) => p.id),
      );
    }
    return plugin;
  }
}
