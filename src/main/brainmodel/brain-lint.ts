// The brain lint (ADR 0194, M2): zero-token checks the free cleanup of «Manutenzione» runs over the brain, after
// Karpathy's «LLM wiki» lint (orphans, broken links, missing concept pages) and Solenta (facts citing files that are
// gone). What it finds becomes Proposte cards with one plain question (lint-cards.ts, research.ts afterPass):
//   orphan        a note no other brain note links to ([[wiki]] or a markdown link), index / hub files excluded; only in
//                 a brain that links its notes at all (else every note would be one);
//   broken-link   a [[wiki]] or markdown link in a note that leads to no file;
//   concept       a [[wiki]] target with no note cited three times or more, or a **bold term** in three notes or more
//                 with no note of its own;
//   stale-fact    a memory fact citing a repo or brain file that is gone (cited-paths.ts); the agents already stop
//                 receiving it (launch-memory.ts);
//   changed-fact  the file a confirmed fact cites changed since the lint first saw it (its sha256 kept in userData);
//   stale-cite    a line of a brain skill or a rules/ file citing a file that is gone.
// Reads the brain, never writes it (the hashes go to userData through the caller). Bounded: at most MAX_NOTES notes of
// at most 256 KB. Used by research.ts; tests: test/unit/brainmodel/brain-lint.test.ts.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrainSkill } from '../../shared/brain-model';
import type { LintFinding } from '../../shared/maintenance-research';
import { factSentence } from '../../shared/proposals';
import { citedPaths, pathState } from '../rules/cited-paths';
import type { MemoryRecord } from '../rules/memory-records';

export const MAX_NOTES = 2000;
const MAX_BYTES = 256 * 1024;
/** folders that are not notes: the app's and the tools' own, the memory store, history */
const SKIP_DIRS = /^(?:\..*|node_modules|ops|memory|agents|journal|reviews|scripts|queries|harness|worktrees|dev|dist|out|build|target|bin|obj)$/i;
/** index / hub files: entry points nobody has to link to */
export const HUB = /^(?:index|hub|readme|start-here|agents|claude|home|moc|_index|changelog|license|contributing)\.md$/i;
/** files the app writes at the brain's top: never orphans */
const APP_FILES = /^(?:ideas|proposals|routines|ai-reflections|now|inbox)\.md$/i;
/** a concept is cited this often before it deserves its own note */
export const CONCEPT_MIN = 3;

const rel = (root: string, file: string): string => path.relative(root, file).split(path.sep).join('/');
const read = (file: string): string | null => { try { const st = fs.statSync(file); return st.isFile() && st.size <= MAX_BYTES ? fs.readFileSync(file, 'utf8') : null; } catch { return null; } };
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[\s_]+/g, '-').trim();
const sha = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** The brain's notes: its markdown files outside the tool and history folders, sorted. */
export function brainNotes(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_NOTES) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 8 && !SKIP_DIRS.test(e.name)) walk(p, depth + 1); } else if (e.isFile() && /\.md$/i.test(e.name)) out.push(p);
    }
  };
  walk(root, 0);
  return out;
}

export interface NoteLink { raw: string; target: string; kind: 'wiki' | 'md'; line: string }
const FENCE = /^(\s*)(`{3,}|~{3,})/;
/** The links of a note (outside code), each with the line it is on. */
export function noteLinks(text: string): NoteLink[] {
  const out: NoteLink[] = [];
  let fence: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const f = FENCE.exec(line)?.[2];
    if (f) { fence = fence === null ? f[0]! : fence === f[0] ? null : fence; continue; }
    if (fence) continue;
    const plain = line.replace(/`[^`]*`/g, ' ');
    for (const m of plain.matchAll(/!?\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g)) out.push({ raw: m[0], target: m[1]!.trim(), kind: 'wiki', line });
    for (const m of plain.matchAll(/!?\[[^\]\n]*\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)) {
      const href = m[1]!;
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('//')) continue;
      let target = href.split('#')[0]!.split('?')[0]!;
      try { target = decodeURIComponent(target); } catch { /* as written */ }
      if (target) out.push({ raw: m[0], target, kind: 'md', line });
    }
  }
  return out;
}
/** The **bold terms** of a note (outside code): short names, not labels or sentences. */
export function boldTerms(text: string): string[] {
  const out = new Set<string>();
  const body = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
  for (const m of body.matchAll(/\*\*([^*\n]{3,40})\*\*/g)) {
    const t = m[1]!.trim();
    if (/[:.!?;,()]$/.test(t) || /^\d/.test(t) || t.split(/\s+/).length > 4 || !/^\p{L}/u.test(t)) continue;
    out.add(t);
  }
  return [...out];
}

export interface LintInput {
  root: string;
  skills: readonly Pick<BrainSkill, 'name' | 'file' | 'home'>[];
  records: readonly MemoryRecord[];
  /** the cited files' hashes the lint saw before (memoryId|path → sha), updated in place */
  hashes: Record<string, string>;
  home?: string;
}

/** Every finding, in a stable order (checks, then paths). */
export function lintBrain(i: LintInput): LintFinding[] {
  const root = i.root, out: LintFinding[] = [];
  const notes = brainNotes(root), texts = new Map<string, string>();
  for (const n of notes) { const t = read(n); if (t !== null) texts.set(n, t); }
  // names a [[wiki]] link resolves by: the relative path without .md, and the bare file name (case and accents folded)
  const byName = new Map<string, string[]>();
  const add = (k: string, file: string) => byName.set(k, [...(byName.get(k) ?? []), file]);
  for (const n of texts.keys()) { const r = rel(root, n).replace(/\.md$/i, ''); add(fold(r), n); add(fold(path.basename(r)), n); }
  const resolveWiki = (target: string): string | null => {
    const t = target.replace(/\\/g, '/').replace(/\.md$/i, '');
    const hit = byName.get(fold(t)) ?? byName.get(fold(path.basename(t)));
    if (hit?.length) return hit[0]!;
    // a wiki link may name any file of the brain (an image, a PDF)
    const any = path.resolve(root, target);
    return any.startsWith(path.resolve(root)) && fs.existsSync(any) ? any : null;
  };
  const inbound = new Map<string, number>();
  const unresolved = new Map<string, { n: number; target: string; at: { file: string; line: string; raw: string }[] }>();
  let resolvedLinks = 0;
  for (const [file, text] of texts) {
    for (const l of noteLinks(text)) {
      let to: string | null;
      if (l.kind === 'wiki') to = resolveWiki(l.target);
      else { const p = path.resolve(path.dirname(file), l.target); to = fs.existsSync(p) ? p : fs.existsSync(`${p}.md`) ? `${p}.md` : null; }
      if (to) { if (to !== file) { inbound.set(to, (inbound.get(to) ?? 0) + 1); resolvedLinks++; } continue; }
      const key = l.kind === 'wiki' ? `wiki:${fold(l.target)}` : `md:${rel(root, file)}:${l.target}`;
      const u = unresolved.get(key) ?? { n: 0, target: l.target, at: [] };
      u.n++; u.at.push({ file: rel(root, file), line: l.line, raw: l.raw });
      unresolved.set(key, u);
    }
  }
  // 1. broken links, and wiki targets cited often enough to be concepts
  const concepts = new Set<string>();
  for (const [key, u] of [...unresolved].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (key.startsWith('wiki:') && u.n >= CONCEPT_MIN) {
      concepts.add(fold(u.target));
      out.push({ check: 'concept', key: `concept:${fold(u.target)}`, target: u.target, about: String(u.n), citedBy: [...new Set(u.at.map(a => a.file))] });
      continue;
    }
    for (const a of u.at) out.push({ check: 'broken-link', key: `broken:${a.file}:${a.raw}`, file: a.file, target: u.target, line: a.line, about: a.raw });
  }
  // 2. bold terms in three notes or more with no note of their own
  const bold = new Map<string, { term: string; files: Set<string> }>();
  for (const [file, text] of texts) for (const t of boldTerms(text)) {
    const k = fold(t), b = bold.get(k) ?? { term: t, files: new Set<string>() };
    b.files.add(rel(root, file)); bold.set(k, b);
  }
  for (const [k, b] of [...bold].sort((a, c) => a[0].localeCompare(c[0]))) {
    if (b.files.size < CONCEPT_MIN || concepts.has(k) || byName.has(k)) continue;
    out.push({ check: 'concept', key: `concept:${k}`, target: b.term, about: String(b.files.size), citedBy: [...b.files].sort() });
  }
  // 3. orphans: only in a brain that links its notes
  if (resolvedLinks >= 3) {
    for (const n of texts.keys()) {
      const r = rel(root, n), base = path.basename(n);
      if (HUB.test(base) || (!r.includes('/') && APP_FILES.test(base)) || r.startsWith('rules/') || inbound.get(n)) continue;
      out.push({ check: 'orphan', key: `orphan:${r}`, file: r });
    }
  }
  // 4. memory facts citing files that are gone, or changed since the lint first saw them
  for (const m of i.records) {
    if (m.validTo !== null || (m.status !== 'confirmed' && m.status !== 'proposed')) continue;
    const bases = [root, ...[m.scope.repository, m.scope.project].filter((b): b is string => !!b && path.isAbsolute(b))];
    const text = `${m.subject} ${m.predicate} ${m.value}`, about = factSentence(m.subject, m.predicate, m.value);
    for (const p of citedPaths(text)) {
      const state = pathState(p, bases, { ...(i.home ? { home: i.home } : {}) });
      if (state === 'missing') { out.push({ check: 'stale-fact', key: `stale-fact:${m.memoryId}:${p}`, memoryId: m.memoryId, target: p, about }); break; }
      if (state !== 'exists' || m.status !== 'confirmed') continue;
      const file = bases.map(b => path.resolve(b, p.replace(/^~(?=[\\/])/, i.home ?? os.homedir()))).find(f => fs.existsSync(f));
      const now = file ? read(file) : null;
      if (now === null) continue;
      const k = `${m.memoryId}|${p}`, h = sha(now), was = i.hashes[k];
      if (was === undefined) i.hashes[k] = h;
      else if (was !== h) out.push({ check: 'changed-fact', key: `changed-fact:${m.memoryId}:${p}:${h}`, memoryId: m.memoryId, target: p, about });
    }
  }
  // 5. brain skills and rules/ files citing files that are gone (one finding per line)
  const cites: { file: string; name: string }[] = [
    ...i.skills.filter(s => s.home === 'brain' && !rel(root, s.file).startsWith('..')).map(s => ({ file: s.file, name: s.name })),
    ...(() => { try { return fs.readdirSync(path.join(root, 'rules')).filter(f => /\.md$/i.test(f)).sort().map(f => ({ file: path.join(root, 'rules', f), name: `rules/${f}` })); } catch { return []; } })(),
  ];
  for (const c of cites) {
    const text = read(c.file);
    if (text === null) continue;
    let fence = false;
    for (const line of text.split(/\r?\n/)) {
      if (FENCE.test(line)) { fence = !fence; continue; }
      if (fence || /^\s*(?:name|description|when):/.test(line)) continue;
      const gone = citedPaths(line).find(p => pathState(p, [root], { local: path.dirname(c.file), ...(i.home ? { home: i.home } : {}) }) === 'missing');
      if (gone) out.push({ check: 'stale-cite', key: `stale-cite:${rel(root, c.file)}:${line.trim()}`, file: rel(root, c.file), target: gone, line, about: c.name });
    }
  }
  return out;
}
