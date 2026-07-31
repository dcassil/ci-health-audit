import type { Config } from '../config/schema.js';

export type Language = 'ts' | 'js' | 'typescript' | 'javascript';

export interface ToolSupport {
  languages?: Language[];
}

/**
 * Injectable command execution seam (NFR-006). `run` returns stdout as a
 * string synchronously; tests mock it and the real implementation backs it
 * with `execSync`. No `execSync` lives in this core seam.
 */
export interface CommandRunner {
  run(command: string, cwd: string): string;
}

export interface ScanContext {
  srcDir: string;
  config: Config;
  runner: CommandRunner;
}

export interface ModuleEntry {
  source: string;
  dependencies: string[];
}

export interface Edge {
  fromPath: string;
  toPath: string;
}

export interface FileStats {
  path: string;
  loc: number;
  complexity: number;
}

export interface ToolRunOutput {
  raw: unknown;
  fileStats: FileStats[];
  modules: ModuleEntry[];
  edges: Edge[];
}

/**
 * The scanner seam. `run` is async even though {@link CommandRunner.run} is
 * sync, keeping the seam open for future async tools without a breaking change.
 */
export interface ToolPlugin {
  readonly id: string;
  readonly supports: ToolSupport;
  run(ctx: ScanContext): Promise<ToolRunOutput>;
}
