// alpha <-> beta form a deliberate import cycle (drives circularDeps).
import { beta } from './beta.js';

export function alpha(n: number): number {
  if (n <= 0) return 0;
  return beta(n - 1) + 1;
}
