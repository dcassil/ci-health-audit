// Pure math helpers — no cycles, shallow imports.
import { add } from './utils.js';

export function sum(numbers: number[]): number {
  return numbers.reduce((acc, n) => add(acc, n), 0);
}

export function average(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  return sum(numbers) / numbers.length;
}
