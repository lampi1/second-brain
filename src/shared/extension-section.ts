// Validated data-only sections shared by scaffold, main registry and renderer. No executable extension payloads.
export interface SectionManifest {
  schemaVersion: 1;
  id: string;
  title: string;
  columns: { id: string; label: string; kind: 'text' | 'date' | 'status' }[];
  rows: { id: string; cells: string[] }[];
}

const slug = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u0008\u000b-\u001f]/.test(v);
function shape(v: unknown, keys: string[]): asserts v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) throw new Error('Invalid section object fields');
}
function unique(ids: string[]): void {
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate section identifiers');
}

/** Reject unknown versions/fields before any persistence or rendering. Return detached plain JSON. */
export function parseSection(input: unknown): SectionManifest {
  shape(input, ['schemaVersion', 'id', 'title', 'columns', 'rows']);
  if (input.schemaVersion !== 1 || !slug(input.id) || !text(input.title, 120)) throw new Error('Invalid section header');
  if (!Array.isArray(input.columns) || input.columns.length < 1 || input.columns.length > 8 || !Array.isArray(input.rows) || input.rows.length > 200) throw new Error('Section size exceeds limits');
  const columns = input.columns.map(c => {
    shape(c, ['id', 'label', 'kind']);
    if (!slug(c.id) || !text(c.label, 80) || typeof c.kind !== 'string' || !['text', 'date', 'status'].includes(c.kind)) throw new Error('Invalid section column');
    return { id: c.id, label: c.label, kind: c.kind as 'text' | 'date' | 'status' };
  });
  unique(columns.map(c => c.id));
  const rows = input.rows.map(r => {
    shape(r, ['id', 'cells']);
    if (!slug(r.id) || !Array.isArray(r.cells) || r.cells.length !== columns.length) throw new Error('Invalid section row');
    const cells = r.cells.map((v, i) => {
      if (!text(v, 500)) throw new Error('Invalid section cell');
      if (columns[i]!.kind === 'status' && !['open', 'done', 'blocked'].includes(v)) throw new Error('Invalid section status');
      if (columns[i]!.kind === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v)) throw new Error('Invalid section date');
      return v;
    });
    return { id: r.id, cells };
  });
  unique(rows.map(r => r.id));
  const result: SectionManifest = { schemaVersion: 1, id: input.id, title: input.title, columns, rows };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 128 * 1024) throw new Error('Section byte budget exceeded');
  return result;
}
