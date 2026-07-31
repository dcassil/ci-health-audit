// Part of a deliberate 2-module cycle: a <-> b.
import { bValue } from './b.js';
import { hub } from './hub.js';

export function aValue(): number {
  return bValue() + hub();
}

export function aOnly(n: number): number {
  if (n > 0) {
    return n * 2;
  }
  return 0;
}
