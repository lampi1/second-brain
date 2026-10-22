// The brain's saved queries (ADR 0124; the owner, 2026-10-22: Memoria → «Script & Query»): the queries someone reruns
// against a data source (SQL, KQL / Kusto, GraphQL, PromQL, Splunk SPL, …) live in the brain's `queries/` folder, flat,
// one file each, next to scripts/ (ADR 0076). The app writes each as a Markdown note, because one format then holds every
// query language (SPL and GraphQL have no line comment a header could use) and reads well in the file viewer:
//   # Clienti attivi
//
//   Elenca i clienti attivi con id e nome.
//
//   - **Runs on:** Azure Data Explorer · help / Samples
//   - **Tags:** clienti, report
//   - **From:** `clienti/acme.md` (Acme), 2026-10-22
//
//   ```kusto
//   <the query, byte for byte>
//   ```
// A native file the user drops there (.sql, .kql, .graphql, …) shows too, its header read from `@title`, `@description`,
// `@source`, `@tags` comment lines (as in scripts.ts) or its name. Reads mask every line that may hold a credential; a
// save that holds one is refused (AGENTS.md rule 2). A delete goes through the brain model's ChangeLog (job 'user'), so
// Annulla on the Memoria page puts the file back. Nothing here runs a query. Used by brainmodel/upgrade.ts (the
// 'queries' layout entry writes with queryNote), queries-tools.ts (brain_queries, brain_query_add), wiring.ts,
// demo-wiring.ts and index.ts (queries:* IPC). Unit tests: test/unit/brain/queries.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { BrainQuery, BrainQueryList, BrainQuerySummary } from '../../shared/contract';
import type { ChangeLog } from '../brainmodel/changes';
import type { BrainChangelog } from './changelog';
import { maskSecrets } from './mask';
import { secretLine } from './scripts';

export const QUERIES_DIR = 'queries';
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const MAX_BYTES = 200 * 1024;
/** a fence language (lowercase) → its label */
const LABELS: Record<string, string> = {
  sql: 'SQL', tsql: 'T-SQL', 't-sql': 'T-SQL', mysql: 'MySQL', postgresql: 'PostgreSQL', postgres: 'PostgreSQL', pgsql: 'PostgreSQL',
  plsql: 'PL/SQL', sqlite: 'SQLite', kusto: 'KQL', kql: 'KQL', graphql: 'GraphQL', gql: 'GraphQL', promql: 'PromQL', spl: 'SPL',
  splunk: 'SPL', logql: 'LogQL', cypher: 'Cypher', sparql: 'SPARQL', flux: 'Flux', esql: 'ES|QL',
};
/** native extensions → [fence language, line comment] */
const NATIVE: Record<string, [string, string]> = {
  '.sql': ['sql', '--'], '.kql': ['kusto', '//'], '.kusto': ['kusto', '//'], '.csl': ['kusto', '//'], '.graphql': ['graphql', '#'],
  '.gql': ['graphql', '#'], '.promql': ['promql', '#'], '.cypher': ['cypher', '//'], '.sparql': ['sparql', '#'],
};
export const QUERY_EXTS = ['.md', ...Object.keys(NATIVE)];
export const languageLabel = (lang: string): string => LABELS[lang.toLowerCase()] ?? (lang ? lang.toUpperCase() : 'Query');

export interface QueryMeta { title: string; description: string; source?: string; tags?: string[]; from?: string }

const one = (s: string | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** A fence longer than any backtick run at a line start of the code, so the code stays one block whatever it holds. */
const fenceFor = (code: string): string => '`'.repeat(Math.max(3, ...[...code.matchAll(/^[ \t]*(`{3,})/gm)].map(m => m[1]!.length + 1)));

/** The note the app writes for a query: title, what it does, the fields, then the code in one fenced block, unchanged. */
export function queryNote(lang: string, code: string, meta: QueryMeta): string {
  const fields = [
    ...(one(meta.source) ? [`- **Runs on:** ${one(meta.source)}`] : []),
    ...(meta.tags?.length ? [`- **Tags:** ${meta.tags.map(one).filter(Boolean).join(', ')}`] : []),
    ...(one(meta.from) ? [`- **From:** ${one(meta.from)}`] : []),
  ];
  const fence = fenceFor(code);
  return [`# ${one(meta.title)}`, '', one(meta.description), '', ...fields, ...(fields.length ? [''] : []), `${fence}${lang.toLowerCase()}`, code, fence, ''].join('\n');
}

const FIELD = /^[-*]\s+\*\*([^*:]+):\*\*\s*(.*)$/;
const KEYS: Record<string, 'source' | 'tags' | 'from'> = {
  'runs on': 'source', source: 'source', 'data source': 'source', 'gira su': 'source', 'dove gira': 'source', 'fonte dati': 'source', datenquelle: 'source', 'läuft auf': 'source',
  tags: 'tags', tag: 'tags', from: 'from', da: 'from', origine: 'from', herkunft: 'from',
};
/** The header fields and the code of a query note (the first fenced block); null when it holds no fenced block. */
export function parseQueryNote(text: string): { title: string; description: string; source: string; tags: string[]; from: string; lang: string; code: string } | null {
  const t = text.replace(/^﻿/, '');
  const fence = /^([ \t]*)(`{3,}|~{3,})[ \t]*([A-Za-z0-9_+-]*)[^\n]*\r?\n([\s\S]*?)\r?\n?^\1\2[ \t]*$/m.exec(t);
  if (!fence) return null;
  const r = { title: '', description: '', source: '', tags: [] as string[], from: '', lang: fence[3]!.toLowerCase(), code: fence[4]! };
  let para: string[] = [];
  for (const raw of t.slice(0, fence.index).split(/\r?\n/)) {
    const line = raw.trim();
    const h = /^#\s+(.+)$/.exec(line);
    if (h && !r.title) { r.title = h[1]!.trim(); continue; }
    const f = FIELD.exec(line);
    if (f) {
      const k = KEYS[f[1]!.trim().toLowerCase()];
      if (k === 'tags') r.tags = f[2]!.split(/[,;]/).map(s => s.trim()).filter(Boolean).slice(0, 12);
      else if (k) r[k] = f[2]!.trim();
      continue;
    }
    if (!line) { if (para.length && !r.description) r.description = para.join(' '); para = []; continue; }
    if (!/^#/.test(line) && !r.description) para.push(line);
  }
  if (para.length && !r.description) r.description = para.join(' ');
  return r;
}

/** A native query file's header: `@title`, `@description`, `@source`, `@tags` comment lines in its first 40 lines. */
function parseNative(text: string, comment: string): { title: string; description: string; source: string; tags: string[]; code: string } {
  const r = { title: '', description: '', source: '', tags: [] as string[], code: '' };
  const esc = comment.replace(/[/\\^$*+?.()|[\]{}-]/g, '\\$&');
  const meta = new RegExp(`^\\s*${esc}\\s*@(title|description|source|tags)\\b[:\\s]?\\s*(.*?)\\s*$`, 'i');
  const plain = new RegExp(`^\\s*${esc}\\s?(.*?)\\s*$`);
  let first = '';
  const body: string[] = [];
  text.replace(/^﻿/, '').split(/\r?\n/).forEach((line, i) => {
    const m = i < 40 ? meta.exec(line) : null;
    if (!m) { body.push(line); if (!first && i < 40) { const c = plain.exec(line)?.[1]?.trim(); if (c && !/^[-=*/#\s]+$/.test(c)) first = c; } return; }
    const k = m[1]!.toLowerCase(), v = m[2]!.trim();
    if (k === 'tags') r.tags = v.split(/[,;]/).map(s => s.trim()).filter(Boolean).slice(0, 12); else r[k as 'title' | 'description' | 'source'] = v;
  });
  while (body.length && !body[0]!.trim()) body.shift();
  r.code = body.join('\n').replace(/\s+$/, '');
  if (!r.description) r.description = first;
  return r;
}

export class BrainQueries {
  constructor(private readonly root: () => string | null, private readonly log: () => ChangeLog | null, private readonly changelog?: BrainChangelog) {}

  private dir(): string | null { const r = this.root(); return r ? path.join(r, QUERIES_DIR) : null; }

  private read(dir: string, name: string): (BrainQuerySummary & { code: string }) | null {
    const ext = path.extname(name).toLowerCase();
    if (!NAME.test(name) || !QUERY_EXTS.includes(ext)) return null;
    const full = path.join(dir, name);
    let st: fs.Stats, text: string;
    try { st = fs.lstatSync(full); if (!st.isFile() || st.size > MAX_BYTES) return null; text = fs.readFileSync(full, 'utf8'); } catch { return null; }
    const base = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
    let h: { title: string; description: string; source: string; tags: string[]; lang: string; code: string; from: string };
    if (ext === '.md') { const p = parseQueryNote(text); if (!p) return null; h = p; }
    else { const [lang, comment] = NATIVE[ext]!; h = { ...parseNative(text, comment), lang, from: '' }; }
    return {
      id: name, file: `${QUERIES_DIR}/${name}`, title: maskSecrets(h.title || base).text, description: maskSecrets(h.description).text,
      language: languageLabel(h.lang), lang: h.lang, source: maskSecrets(h.source).text, tags: h.tags, from: maskSecrets(h.from).text,
      changedAt: st.mtime.toISOString(), bytes: st.size, code: h.code,
    };
  }

  /** Every query of the brain, newest change first; none on a brain without a queries/ folder (a symlinked one is not read). */
  list(): BrainQueryList {
    const root = this.root(), dir = this.dir();
    let names: string[] = [];
    try { if (dir && !fs.lstatSync(dir).isSymbolicLink()) names = fs.readdirSync(dir).filter(n => !n.startsWith('.')); } catch { /* no queries yet */ }
    const queries = names.map(n => this.read(dir!, n)).filter((q): q is BrainQuerySummary & { code: string } => !!q)
      .map(({ code: _c, ...q }) => { void _c; return q; })
      .sort((a, b) => (b.changedAt ?? '').localeCompare(a.changedAt ?? '') || a.id.localeCompare(b.id));
    return { root, dir: QUERIES_DIR, queries };
  }

  /** One query with its code, credentials masked. */
  get(id: string): BrainQuery {
    const dir = this.dir(), name = this.checkName(id);
    const q = dir ? this.read(dir, name) : null;
    if (!dir || !q) throw new Error(`query non trovata: ${id}`);
    const masked = maskSecrets(q.code);
    return { ...q, path: path.join(dir, name), code: masked.text, masked: masked.masked };
  }

  private checkName(raw: string): string {
    const n = String(raw ?? '').trim().replace(/^queries[\\/]/, '');
    if (!NAME.test(n) || n.includes('..')) throw new Error('name: a file name like "clienti-attivi.md" (letters, digits, . _ -), no folders');
    if (!QUERY_EXTS.includes(path.extname(n).toLowerCase())) throw new Error(`name: one of ${QUERY_EXTS.join(' ')}`);
    return n;
  }

  /** Add a new query (brain_query_add): written as a note with its header; an existing name (any case) and a query that
   *  looks like it holds a credential are refused; a line in the brain's changelog. */
  add(input: { name: string; lang: string; code: string; meta: QueryMeta; by: string }): { file: string; path: string } {
    const dir = this.dir();
    if (!dir) throw new Error('nessuna cartella brain configurata');
    const base = String(input.name ?? '').trim().replace(/^queries[\\/]/, '').replace(/\.md$/i, '');
    const name = this.checkName(`${base}.md`);
    if (!one(input.meta.title)) throw new Error('title: required');
    if (!one(input.meta.description)) throw new Error('description: required (what it answers, when to rerun it)');
    const lang = String(input.lang ?? '').trim().toLowerCase();
    if (!/^[a-z0-9+-]{1,16}$/.test(lang)) throw new Error('language: the fence language, e.g. sql, kusto, graphql, promql, spl');
    const code = String(input.code ?? '').replace(/\s+$/, '');
    if (!code.trim()) throw new Error('code: empty');
    const text = queryNote(lang, code, input.meta);
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error(`code: over ${MAX_BYTES / 1024} KB`);
    const bad = secretLine(text);
    if (bad) throw new Error(`refused: line ${bad} looks like a credential. Use a parameter or a connection the tool already has, never write it in a query`);
    if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new Error('queries/ is a link: refused');
    let existing: string[] = [];
    try { existing = fs.readdirSync(dir).map(f => f.toLowerCase()); } catch { /* not there yet */ }
    if (existing.includes(name.toLowerCase())) throw new Error(`${name} exists already: add only creates a new query`);
    fs.mkdirSync(dir, { recursive: true });
    const full = path.join(dir, name);
    fs.writeFileSync(full, text, { encoding: 'utf8', flag: 'wx' });
    this.changelog?.add({ kind: 'note', action: 'added', target: `${QUERIES_DIR}/${name}`, by: input.by, summary: one(input.meta.title) });
    return { file: `${QUERIES_DIR}/${name}`, path: full };
  }

  /** Remove a query through the ChangeLog (job 'user'): its text is kept in the change, Annulla puts it back. */
  delete(id: string): { changeId: string; file: string } {
    const dir = this.dir(), log = this.log();
    if (!dir || !log) throw new Error('nessuna cartella brain configurata');
    const q = this.read(dir, this.checkName(id));
    if (!q) throw new Error(`query non trovata: ${id}`);
    const c = log.apply({ job: 'user', kind: 'memory', action: 'remove', target: q.file, summary: `Query eliminata: ${q.title}`,
      reason: 'Eliminata dalla scheda Script & Query di Memoria.', evidence: [q.file] }, [{ file: path.join(dir, q.id), text: null }]);
    if (!c) throw new Error('la query non si può eliminare con Annulla (file troppo grande): eliminala a mano');
    return { changeId: c.id, file: q.file };
  }
}

/** Can a change to this brain path change the queries list? (the brain watcher asks) */
export const touchesQueries = (rel: string): boolean => {
  const p = rel.replace(/\\/g, '/');
  return p === QUERIES_DIR || p.startsWith(`${QUERIES_DIR}/`);
};
