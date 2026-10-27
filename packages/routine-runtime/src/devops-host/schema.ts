// The small value checks the DevOps host modules use (object, keys, text, identifier, integer). Copied from the app's
// src/main/flows/schema.ts (same messages) so these modules run in the routine runtime with no app import (ADR 0175).
const ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
export function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: expected object`);
  return value as Record<string, unknown>;
}
export function keys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`${label}: unknown field`);
}
export function text(value: unknown, label: string, max = 4000, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000]/u.test(value)) throw new Error(`${label}: invalid text`);
  return value.trim();
}
export function identifier(value: unknown, label: string): string {
  const result = text(value, label, 80); if (!ID.test(result)) throw new Error(`${label}: invalid identifier`); return result;
}
export function integer(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`${label}: invalid integer`);
  return value as number;
}
