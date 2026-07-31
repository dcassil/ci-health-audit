// Deliberately cycles back to format — creates a math <-> format cycle.
import { add } from './utils.js';
import { formatList } from './format.js';

export function sum(numbers: number[]): number {
  return numbers.reduce((acc, n) => add(acc, n), 0);
}

export function average(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  return sum(numbers) / numbers.length;
}

// Gratuitous use of format to create the cycle.
export function summarise(numbers: number[]): string {
  return formatList(numbers.map(String));
}
