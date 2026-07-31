// Part of a deliberate 2-module cycle: a <-> b.
import { aOnly } from './a.js';
import { hub } from './hub.js';

export function bValue(): number {
  return aOnly(3) + hub();
}
