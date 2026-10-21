// Generative UI, the pure half (ADR 0033): the schema of each catalog component (table, cards, board, diffList,
// barChart), checked by hand with a few combinators (no dependency), the size caps, and the ```sb-ui fence parser of
// AskUserQuestion previews. A check strips unknown keys and returns a clean copy, or one error that names the path and
// what is expected, so a model can fix its call and retry. Shared so main (show_ui, main/genui/artifacts.ts) and the
// renderer (previews in AskContext.tsx, the views in GenUi.tsx) accept exactly the same things.
import type { ArtifactTarget, UiComponent, UiLink, UiSpec, UiStatus } from './contract';

export const UI_COMPONENTS: readonly UiComponent[] = ['table', 'cards', 'board', 'diffList', 'barChart'];
export const UI_STATUSES: readonly UiStatus[] = ['ok', 'fail', 'blocked', 'running', 'todo', 'info', 'warn'];
export const ARTIFACT_TARGETS: readonly ArtifactTarget[] = ['chat', 'orchestrator', 'next-ask'];
/** visuals kept per chat (the oldest go first) */
export const ARTIFACT_MAX_PER_CHAT = 20;
/** one visual's props as JSON, at most */
export const ARTIFACT_MAX_BYTES = 32_000;
export const TITLE_MAX = 120;
export const SUMMARY_MAX = 600;
/** an sb-ui fence inside a preview, at most (its JSON text) */
const FENCE_MAX = ARTIFACT_MAX_BYTES + 2_000;

class UiError extends Error {}
type V<T> = (v: unknown, at: string) => T;
const fail = (at: string, what: string): never => { throw new UiError(`${at}: ${what}`); };

const str = (max: number): V<string> => (v, at) => {
  if (typeof v !== 'string') return fail(at, `expected a string, got ${kindOf(v)}`);
  const s = v.trim();
  if (!s) return fail(at, 'empty string');
  if (s.length > max) return fail(at, `too long (${s.length} chars, max ${max})`);
  return s;
};
const num: V<number> = (v, at) => (typeof v === 'number' && Number.isFinite(v) ? v : fail(at, `expected a number, got ${kindOf(v)}`));
const count: V<number> = (v, at) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1e9 ? v as number : fail(at, 'expected a whole number ≥ 0'));
const bool: V<boolean> = (v, at) => (typeof v === 'boolean' ? v : fail(at, `expected true or false, got ${kindOf(v)}`));
const oneOf = <T extends string>(values: readonly T[]): V<T> => (v, at) => (values.includes(v as T) ? v as T : fail(at, `expected one of ${values.join(', ')}, got ${JSON.stringify(v)?.slice(0, 40)}`));
const arr = <T>(item: V<T>, max: number, min = 0): V<T[]> => (v, at) => {
  if (!Array.isArray(v)) return fail(at, `expected an array, got ${kindOf(v)}`);
  if (v.length < min) return fail(at, `needs at least ${min} item${min === 1 ? '' : 's'}`);
  if (v.length > max) return fail(at, `too many items (${v.length}, max ${max})`);
  return v.map((x, i) => item(x, `${at}[${i}]`));
};
/** An object with these keys (optional ones may be missing or null); unknown keys are dropped. */
function obj<R extends Record<string, V<unknown>>, O extends Record<string, V<unknown>>>(req: R, opt: O): V<{ [K in keyof R]: ReturnType<R[K]> } & { [K in keyof O]?: ReturnType<O[K]> }> {
  return (v, at) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return fail(at, `expected an object, got ${kindOf(v)}`);
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, f] of Object.entries(req)) {
      if (o[k] === undefined || o[k] === null) return fail(`${at}.${k}`, 'missing');
      out[k] = f(o[k], `${at}.${k}`);
    }
    for (const [k, f] of Object.entries(opt)) if (o[k] !== undefined && o[k] !== null) out[k] = f(o[k], `${at}.${k}`);
    return out as never;
  };
}
function kindOf(v: unknown): string { return v === null ? 'null' : Array.isArray(v) ? 'an array' : typeof v === 'object' ? 'an object' : typeof v; }

/** An http(s) URL or a local absolute path (C:\…, file:///C:/…; on macOS and Linux /…, file:///…, ADR 0054); never
 *  javascript:, data:, a UNC share, a protocol-relative //host or a relative path (main/open-path.ts refuses those too). */
export function safeHref(h: string): 'web' | 'file' | null {
  if (/^https?:\/\/[^\s]+$/i.test(h)) return 'web';
  if (/^file:\/\/\/?[a-z]:[\\/]/i.test(h) || /^[a-z]:[\\/]/i.test(h)) return 'file';
  if (/^(?:file:\/\/)?\/(?![\\/])\S/i.test(h)) return 'file';
  return null;
}
const href: V<string> = (v, at) => { const s = str(1000)(v, at); return safeHref(s) ? s : fail(at, 'expected an http(s) URL or an absolute local path'); };
const link: V<UiLink> = obj({ label: str(80), href }, {});
const status = oneOf(UI_STATUSES);
/** a table cell may be empty (nothing to say in that column) */
const cell: V<string> = (v, at) => (v === '' ? '' : str(300)(v, at));

const SCHEMAS: { [K in UiComponent]: V<Extract<UiSpec, { component: K }>['props']> } = {
  table: (v, at) => {
    const t = obj({ columns: arr(str(60), 12, 1), rows: arr(obj({ cells: arr(cell, 12) }, { status, link }), 200) }, {})(v, at);
    t.rows.forEach((r, i) => { if (r.cells.length > t.columns.length) fail(`${at}.rows[${i}].cells`, `${r.cells.length} cells for ${t.columns.length} columns`); });
    return t;
  },
  cards: (v, at) => {
    const c = obj({ options: arr(obj({ title: str(80) }, { summary: str(300), pros: arr(str(160), 8), cons: arr(str(160), 8), effort: str(40), risk: oneOf(['low', 'medium', 'high'] as const), recommended: bool }), 6, 1) }, {})(v, at);
    if (c.options.filter(o => o.recommended).length > 1) fail(`${at}.options`, 'at most one option may be recommended');
    return c;
  },
  board: obj({ lanes: arr(obj({ title: str(60), items: arr(obj({ title: str(160) }, { detail: str(300), status, links: arr(link, 4) }), 50) }, { status }), 8, 1) }, {}),
  diffList: obj({ groups: arr(obj({ area: str(80), files: arr(obj({ path: str(300) }, { why: str(200), added: count, removed: count, href }), 100, 1) }, {}), 20, 1) }, {}),
  barChart: obj({ bars: arr(obj({ label: str(60), value: num }, { note: str(80) }), 40, 1) }, { unit: str(12) }),
};

export type UiCheck = { ok: true; spec: UiSpec } | { ok: false; error: string };

/** A component name + props from a model → a clean spec, or one clear error (English: the model reads it). */
export function checkUi(component: unknown, props: unknown): UiCheck {
  if (!UI_COMPONENTS.includes(component as UiComponent)) return { ok: false, error: `component: expected one of ${UI_COMPONENTS.join(', ')}, got ${JSON.stringify(component)?.slice(0, 40)}` };
  const c = component as UiComponent;
  let size: number;
  try { size = JSON.stringify(props ?? null).length; } catch { return { ok: false, error: 'props: not serializable' }; }
  if (size > ARTIFACT_MAX_BYTES) return { ok: false, error: `props: too big (${size} bytes of JSON, max ${ARTIFACT_MAX_BYTES}): show fewer rows or shorter text` };
  try {
    return { ok: true, spec: { component: c, props: SCHEMAS[c](props, 'props') } as UiSpec };
  } catch (e) {
    if (e instanceof UiError) return { ok: false, error: `${c} ${e.message}` };
    throw e;
  }
}

/** The plain-text fallback line of a spec when no summary was given (a preview fence): what it is and how big. */
export function describeUi(spec: UiSpec): string {
  switch (spec.component) {
    case 'table': return `Tabella: ${spec.props.rows.length} righe (${spec.props.columns.join(', ')})`;
    case 'cards': return `Opzioni: ${spec.props.options.map(o => o.title).join(' · ')}`;
    case 'board': return `Bacheca: ${spec.props.lanes.map(l => `${l.title} ${l.items.length}`).join(' · ')}`;
    case 'diffList': return `File cambiati: ${spec.props.groups.reduce((n, g) => n + g.files.length, 0)} in ${spec.props.groups.length} aree`;
    case 'barChart': return `Grafico: ${spec.props.bars.map(b => `${b.label} ${b.value}${spec.props.unit ?? ''}`).join(' · ')}`;
  }
}

const STATUS_IT: Record<UiStatus, string> = { ok: 'OK', fail: 'Fallito', blocked: 'Bloccato', running: 'In corso', todo: 'Da fare', info: 'Info', warn: 'Attenzione' };
const cellMd = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** A visual as plain markdown, for its Copia button: what a user pastes into a mail, a work item or another chat. */
export function textOfUi(spec: UiSpec, title?: string): string {
  const out: string[] = title ? [`**${title}**`, ''] : [];
  switch (spec.component) {
    case 'table': {
      const { columns, rows } = spec.props;
      const st = rows.some(r => r.status);
      const head = [...(st ? ['Stato'] : []), ...columns, ...(rows.some(r => r.link) ? ['Link'] : [])];
      out.push(`| ${head.map(cellMd).join(' | ')} |`, `|${head.map(() => ' --- ').join('|')}|`);
      for (const r of rows) {
        const cells = [...(st ? [r.status ? STATUS_IT[r.status] : ''] : []), ...columns.map((_, i) => r.cells[i] ?? ''), ...(head.length > columns.length + (st ? 1 : 0) ? [r.link ? `${r.link.label}: ${r.link.href}` : ''] : [])];
        out.push(`| ${cells.map(cellMd).join(' | ')} |`);
      }
      break;
    }
    case 'cards':
      for (const o of spec.props.options) {
        out.push(`- **${o.title}**${o.recommended ? ' (consigliata)' : ''}${o.summary ? `: ${o.summary}` : ''}`);
        for (const x of o.pros ?? []) out.push(`  - + ${x}`);
        for (const x of o.cons ?? []) out.push(`  - − ${x}`);
        const foot = [o.effort && `sforzo ${o.effort}`, o.risk && `rischio ${({ low: 'basso', medium: 'medio', high: 'alto' } as const)[o.risk]}`].filter(Boolean);
        if (foot.length) out.push(`  - ${foot.join(', ')}`);
      }
      break;
    case 'board':
      for (const l of spec.props.lanes) {
        out.push(`**${l.title}** (${l.items.length})`);
        for (const it of l.items) out.push(`- ${it.status ? `[${STATUS_IT[it.status]}] ` : ''}${it.title}${it.detail ? `: ${it.detail}` : ''}${(it.links ?? []).map(x => ` (${x.label}: ${x.href})`).join('')}`);
        out.push('');
      }
      break;
    case 'diffList':
      for (const g of spec.props.groups) {
        out.push(`**${g.area}**`);
        for (const f of g.files) out.push(`- \`${f.path}\`${f.added !== undefined || f.removed !== undefined ? ` +${f.added ?? 0} −${f.removed ?? 0}` : ''}${f.why ? `: ${f.why}` : ''}`);
        out.push('');
      }
      break;
    case 'barChart':
      for (const b of spec.props.bars) out.push(`- ${b.label}: ${b.value}${spec.props.unit ? ` ${spec.props.unit}` : ''}${b.note ? ` (${b.note})` : ''}`);
      break;
  }
  return out.join('\n').trim();
}

export type PreviewPart = { kind: 'md'; text: string } | { kind: 'ui'; title?: string; spec: UiSpec } | { kind: 'bad'; error: string; raw: string };

const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*sb-ui[ \t]*\r?\n([\s\S]*?)\r?\n {0,3}\1[ \t]*$/gm;

/** An option's preview markdown split around its ```sb-ui {json}``` fences: the JSON is { component, props, title? }.
 *  A fence that does not parse or check stays visible as a 'bad' part with its error (shown with the raw text). */
export function splitUiFences(md: string): PreviewPart[] {
  const out: PreviewPart[] = [];
  let last = 0;
  for (const m of md.matchAll(FENCE)) {
    const before = md.slice(last, m.index);
    if (before.trim()) out.push({ kind: 'md', text: before });
    last = m.index + m[0].length;
    const raw = m[2] ?? '';
    if (raw.length > FENCE_MAX) { out.push({ kind: 'bad', error: 'sb-ui: troppo grande', raw: raw.slice(0, 200) }); continue; }
    let j: unknown;
    try { j = JSON.parse(raw); } catch (e) { out.push({ kind: 'bad', error: `sb-ui: JSON non valido (${e instanceof Error ? e.message : String(e)})`, raw }); continue; }
    const o = (j && typeof j === 'object' ? j : {}) as { component?: unknown; props?: unknown; title?: unknown };
    const r = checkUi(o.component, o.props);
    if (!r.ok) { out.push({ kind: 'bad', error: `sb-ui: ${r.error}`, raw }); continue; }
    const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim().slice(0, TITLE_MAX) : undefined;
    out.push({ kind: 'ui', spec: r.spec, ...(title ? { title } : {}) });
  }
  const rest = md.slice(last);
  if (rest.trim()) out.push({ kind: 'md', text: rest });
  return out;
}

/** True when a preview carries at least one sb-ui fence (cheap test before splitting). */
export const hasUiFence = (md: string | undefined): boolean => !!md && /(`{3,}|~{3,})[ \t]*sb-ui\b/.test(md);
