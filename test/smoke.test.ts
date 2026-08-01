import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';

/**
 * Smoke test for the public API surface (CIHA-T-0008). The Phase 1 `VERSION`
 * placeholder has been replaced by the real `scan()` entrypoint and re-exports;
 * this asserts the surface the CLI (CIHA-I-0002) consumes stays present.
 */
describe('public API surface', () => {
  it('exports the orchestrator and config helpers', () => {
    expect(typeof api.scan).toBe('function');
    expect(typeof api.scanWithRawConfig).toBe('function');
    expect(typeof api.loadConfig).toBe('function');
    expect(typeof api.configFileSchema).toBe('object');
    expect(typeof api.resolveProjects).toBe('function');
    expect(typeof api.DEFAULT_CONFIG).toBe('object');
  });

  it('exports the scanner/plugin and runner surface', () => {
    expect(typeof api.score).toBe('function');
    expect(typeof api.buildGraph).toBe('function');
    expect(typeof api.computeMetrics).toBe('function');
    expect(typeof api.PluginRegistry).toBe('function');
    expect(typeof api.TsToolPlugin).toBe('function');
    expect(typeof api.execCommandRunner.run).toBe('function');
    expect(typeof api.CommandExecutionError).toBe('function');
    expect(typeof api.NoPluginForLanguageError).toBe('function');
  });
});
