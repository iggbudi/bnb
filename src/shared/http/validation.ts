export function parsePositiveNumber(value: unknown, name: string): number {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') {
    throw new Error(`Parameter "${name}" is required`);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Parameter "${name}" must be a positive finite number`);
  }

  return parsed;
}

export function parsePositiveNumberOrDefault(value: unknown, name: string, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  return parsePositiveNumber(value, name);
}
