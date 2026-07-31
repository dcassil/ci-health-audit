// A hub module imported by several others (raises fan-in coupling).
export function hub(): number {
  return 42;
}
