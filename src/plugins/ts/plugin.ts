/**
 * JS/TS `ToolPlugin` (CIHA-I-0001, Phase 4).
 *
 * Composes the `scc` and `depcruise` runners into a single {@link ToolRunOutput}.
 * This is the plugin resolved for `language: "ts"` (and the JS/TS aliases). The
 * only impure work happens inside the injected {@link CommandRunner}; the plugin
 * itself is deterministic given its inputs.
 */
import type {
  ScanContext,
  ToolPlugin,
  ToolRunOutput,
  ToolSupport,
} from '../../scanner/types.js';
import { runScc } from './scc.js';
import { runDepcruise } from './depcruise.js';

/** The JS/TS tool plugin (`id: "ts"`). */
export class TsToolPlugin implements ToolPlugin {
  readonly id = 'ts';

  readonly supports: ToolSupport = {
    languages: ['ts', 'js', 'typescript', 'javascript'],
  };

  /**
   * Runs `scc` + `depcruise` and composes their outputs. The runners are
   * synchronous, but this returns a promise so the {@link ToolPlugin} seam stays
   * async and so synchronous runner failures surface as a rejected promise
   * rather than a synchronous throw (NFR-004).
   */
  run(ctx: ScanContext): Promise<ToolRunOutput> {
    try {
      const fileStats = runScc(ctx);
      const { modules, edges } = runDepcruise(ctx);

      return Promise.resolve({
        raw: { fileStats, modules, edges },
        fileStats,
        modules,
        edges,
      });
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
