// beta <-> alpha form a deliberate import cycle (drives circularDeps).
import { alpha } from './alpha.js';

export function beta(n: number): number {
  if (n <= 0) return 0;
  return alpha(n - 1) + 1;
}
