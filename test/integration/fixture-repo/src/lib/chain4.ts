import { hub } from './hub.js';

export function chain4(): number {
  return hub() + 1;
}
