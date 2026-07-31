// Deliberately cycles back to math — creates a format <-> math cycle.
import { average } from './math.js';

export function formatAverage(numbers: number[]): string {
  const avg = average(numbers);
  return avg.toFixed(2);
}

export function formatList(items: string[]): string {
  return items.join(', ');
}
