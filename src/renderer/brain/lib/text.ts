// Text helpers of the brain pages: names not numbers (a PR is named after the bug it fixes, a leading "#<id>" and commit
// prefixes dropped), DevOps numbers in free text turned into named links, the 3-5 stand-up sentences, decisions that
// wait for the owner. Pure (no DOM), unit-tested in test/unit/brain-ui/text.test.ts. The owner's name is never in the
// code: it is read from the data (ownerOf) and only used to turn third-person lines into first person.
import type { Brief, BriefItem, BriefPr, DayReport, Idea } from '../types';
import { fmt } from './format';

export const short = (s: unknown, n = 80): string => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
/** drop a leading "#<id>", a conventional-commit prefix and double spaces */
export const clean = (s: unknown): string => String(s ?? '').replace(/^\s*#\d+\s*/, '').replace(/^\s*(fix|feat|chore|refactor|docs|test|perf|build|ci|style)(\([^)]*\))?!?:\s*/i, '').replace(/\s+/g, ' ').trim();
/** a work item title without its "[Area] - " prefix */
export const bugName = (t: unknown): string => clean(String(t ?? '').replace(/^\[[^\]]+\]\s*-?\s*/, ''));
export const topicOf = (t: unknown): string => String(t ?? '').match(/^\[([^\]]+)\]/)?.[1] ?? '';
/** a PR is named after the bug it fixes (what QA and colleagues know), else after its own cleaned title */
export const prName = (pr: Pick<BriefPr, 'title' | 'items'>): string => {
  const b = (pr.items ?? []).find(i => !/^P-/.test(i.type));
  return b ? bugName(b.title) : clean(pr.title);
};
/** a diary line, readable: no "[personale]" tag, cut at the first sentence end */
export const firstClause = (s: unknown, n = 110): string => short(clean(String(s ?? '').replace(/\[personale\]\s*/gi, '')).split(/(?<=[.;])\s/)[0], n);
export const quote = (s: string): string => `«${s}»`;
export const list3 = (a: string[]): string => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} e ${a[a.length - 1]}`);
export const baseName = (s: unknown): string => String(s ?? '').replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '';
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The brain owner's name as the data writes it: the most common author of the ideas that are not the AI's. */
export function ownerOf(ideas: Pick<Idea, 'chi'>[]): string {
  const n = new Map<string, number>();
  for (const i of ideas) if (i.chi && i.chi !== 'IA') n.set(i.chi, (n.get(i.chi) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}
/** "<Owner> decide se…" → "decide se…" (lines written about the owner, read by the owner) */
export const firstPerson = (s: string, owner: string): string => (owner ? s.replace(new RegExp(`\\b${escRe(owner)}\\s+`, 'g'), '') : s);

/** Work areas = what goes in the team stand-up: every area but the personal one and the catch-all. */
export const isWorkArea = (a: string): boolean => !/^(personale|altro)/i.test(a.trim());
export const isAgentsSection = (s: string): boolean => /^Agenti e sessioni/i.test(s);

export const nextText = (s: string): string => s.replace(/^(prossimo|aspetta\w*|resta)\s*:?\s*/i, '');

// ── DevOps names and links ────────────────────────────────────────────────────────────────────────────────────────
export interface DevopsRef { url: string; name: string; kind: string }
/** id → {url, name, kind} from the live brief (your PRs, their work items, your work items). */
export function devopsIndex(br: { prs?: BriefPr[]; items?: BriefItem[] } | null | undefined): Map<string, DevopsRef> {
  const idx = new Map<string, DevopsRef>();
  const add = (id: string | undefined, url: string, name: string, kind: string) => { if (id && url && !idx.has(id)) idx.set(id, { url, name, kind }); };
  for (const p of br?.prs ?? []) {
    add(p.url.match(/pullrequest\/(\d+)/)?.[1], p.url, prName(p), 'PR');
    for (const i of p.items ?? []) add(i.url.match(/edit\/(\d+)/)?.[1], i.url, bugName(i.title), i.type.split(' ')[0] ?? i.type);
  }
  for (const i of br?.items ?? []) add(i.url.match(/edit\/(\d+)/)?.[1], i.url, bugName(i.title), i.type);
  return idx;
}
export type TextPart = string | { url: string; label: string; title: string };
/** "PR <n>", "!<n>", "#<n>" or a bare 5-6 digit id → a link named after the thing; unknown numbers and bare 4-digit ones
 *  (years, times) stay text. */
export function linkify(text: string, idx: Map<string, DevopsRef> | null | undefined): TextPart[] {
  const s = String(text ?? '');
  if (!idx?.size) return [s];
  const re = /(?<![\w!#])(PR\s*!?|!|#)?(\d{4,6})\b/g;
  const out: TextPart[] = [];
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const id = m[2]!, hit = idx.get(id);
    if (!hit || !(m[1] || id.length >= 5)) continue; // a bare 4-digit number is a year or a time, never a PR
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push({ url: hit.url, label: `${hit.kind === 'PR' ? 'PR ' : ''}«${short(hit.name, 50)}»`, title: `${hit.kind} ${id}` });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

// ── stand-up ──────────────────────────────────────────────────────────────────────────────────────────────────────
const AREA_TAG = /^(\w{2,5}) · /;
const noTag = (s: string) => s.replace(/^\[personale\]\s*/i, '').replace(AREA_TAG, '').trim();
/** 3-5 sentences to read aloud: what was done on the last work day, open PRs, today's next steps, what you wait for. */
export function standupText(rep: Pick<DayReport, 'rows' | 'day' | 'areas'> | null, br: (Pick<Brief, 'prs' | 'threads' | 'areas'> & { items?: BriefItem[] }) | null, owner = ''): string {
  const areas = [...new Set([...(rep?.areas ?? []), ...(br?.areas ?? []), ...(rep?.rows ?? []).map(r => r.area)])].filter(isWorkArea);
  const S: string[] = [];
  const did = areas.map(a => {
    const rows = (rep?.rows ?? []).filter(r => r.area === a);
    const merged = rows.filter(r => r.kind === 'pr-unita'), opened = rows.filter(r => r.kind === 'pr-aperta');
    const prs = (list: typeof rows, verb: string) => (list.length ? [`${verb} ${list.length === 1 ? 'la PR' : `${list.length} PR:`} ${list3(list.slice(0, 3).map(r => quote(short(clean(r.title), 60))))}`] : []);
    const bits = [
      ...prs(merged, 'ho unito'), ...prs(opened, 'ho aperto'),
      ...rows.filter(r => r.kind === 'diario' && /fatto/i.test(r.tag ?? '')).map(r => `ho chiuso ${quote(short(noTag(String(r.title).split(':')[0] ?? ''), 60))}`),
      ...rows.filter(r => r.kind === 'chat' && (r.his ?? 0) > 0).map(r => `ho lavorato a ${quote(noTag(r.title))}`),
    ];
    return bits.length ? `${a}: ${list3([...new Set(bits)].slice(0, 3))}.` : null;
  }).filter((x): x is string => !!x);
  const dayLabel = rep?.day ? fmt.day(rep.day).replace(/^\w/, c => c.toUpperCase()) : 'Ieri';
  S.push(did.length ? `${dayLabel} · ${did.join(' ')}` : `${dayLabel}: niente di registrato sul lavoro.`);
  const prs = (br?.prs ?? []).filter(p => isWorkArea(p.area));
  if (prs.length) S.push(`Ho ${prs.length === 1 ? 'una PR aperta' : `${prs.length} PR aperte`}: ${list3(prs.slice(0, 3).map(p => quote(prName(p))))}${prs.some(p => /nessuno/.test(p.votes ?? '')) ? ', aspettano revisione' : ''}.`);
  const open = (br?.threads ?? []).filter(t => !t.done && isWorkArea(t.area) && !isAgentsSection(t.section));
  // read aloud: names, not numbers (a PR number → PR «the bug it fixes»)
  const idx = devopsIndex(br);
  const named = (s: string) => linkify(s, idx).map(p => (typeof p === 'string' ? p : p.label)).join('');
  const next = open.filter(t => /prossimo/i.test(t.next) && !/aspetta/i.test(t.next) && !t.stale);
  if (next.length) S.push(`Oggi: ${list3(next.slice(0, 3).map(t => `${noTag(t.label)} (${short(named(nextText(t.next)), 90)})`))}.`);
  const wait = open.filter(t => /aspetta/i.test(t.next));
  if (wait.length) S.push(`Aspetto: ${list3(wait.slice(0, 2).map(t => `${noTag(t.label)} (${short(named(nextText(t.next)), 80)})`))}.`);
  return firstPerson(S.join('\n'), owner);
}

/** The last day before today with a diary line (the stand-up talks about it), else today. */
export function lastDiaryDay(journal: { data: string }[], today: string): string {
  return [...new Set(journal.map(r => r.data))].filter(d => d < today).sort().pop() ?? today;
}

/** Count rows by a key, most frequent first ('—' for empty). */
export function countBy<T>(rows: T[], key: (r: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) { const k = key(r) || '—'; m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'it'));
}
export const sum = (a: number[]): number => a.reduce((x, y) => x + (y || 0), 0);
