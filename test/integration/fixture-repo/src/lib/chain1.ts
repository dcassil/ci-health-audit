// Head of a deep import chain: chain1 -> chain2 -> chain3 -> chain4.
import { chain2 } from './chain2.js';
import { hub } from './hub.js';

export function chain1(): number {
  return chain2() + hub();
}
