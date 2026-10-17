// Bounded declarative routing metadata, used by persistence and renderer recovery. Never grants capabilities.
import type { AgentManifest } from './agents';

export const MANIFEST_TEXT_LIMITS = { whenToUse: 1200, whenNotToUse: 1200, input: 1600, output: 1600 } as const;
export const MANIFEST_LIST_FIELDS = ['declaredTools', 'accessScopes', 'successCriteria'] as const;
export const MANIFEST_ITEM_LIMIT = 200;
export const MANIFEST_LIST_LIMIT = 12;

export function checkedManifest(value: unknown): AgentManifest | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Manifest: expected an object.');
  const data = value as Record<string, unknown>, result: AgentManifest = {};
  const allowed = [...Object.keys(MANIFEST_TEXT_LIMITS), ...MANIFEST_LIST_FIELDS];
  if (Object.keys(data).some(key => !allowed.includes(key))) throw Error('Manifest: unknown field.');
  const text = (v: unknown, max: number) => {
    if (typeof v !== 'string' || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) throw Error('Manifest: invalid or oversized text.');
    return v.trim();
  };
  for (const [key, max] of Object.entries(MANIFEST_TEXT_LIMITS)) {
    if (data[key] !== undefined) result[key as keyof typeof MANIFEST_TEXT_LIMITS] = text(data[key], max);
  }
  for (const key of MANIFEST_LIST_FIELDS) {
    const items = data[key];
    if (items === undefined) continue;
    if (!Array.isArray(items) || items.length > MANIFEST_LIST_LIMIT) throw Error('Manifest: invalid or oversized list.');
    result[key] = items.map(item => text(item, MANIFEST_ITEM_LIMIT));
  }
  return result;
}
