// The Memoria page's statistics (owner, 2026-10-19: "estremamente interessante e ricca di statistiche e grafici, tipo
// errore ricorrente, skill utile inutile"): how many lines each agent's memory holds and how often it was loaded, how the
// memory grew week by week, the lines recalled most, the files gone stale, the recurring errors of ai-errors.md (count,
// trend, agents) and which skills the runs actually used and how they went. Every number is a count over files on disk
// and the agent runs the app recorded: zero tokens, nothing written, bounded reads. "Recalled" is exact for what the
// app does: every run of a role starts with that role's memory file (agents/pack/flows.ts), so a line was recalled by
// each run of its agent that started on or after the line's date. Used by brainmodel/service.ts (BrainModelState.
// memoryStats); unit tests: test/unit/brainmodel/memory-stats.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { AgentProfile, AgentRun } from '../../shared/agents';
import type { AgentMemoryStat, BrainSkill, ErrorEntry, ErrorGroup, MemoryFile, MemoryGrowthKind, MemoryLine, MemoryStats, SkillUse, SkillVerdict } from '../../shared/brain-model';
import { fold, jaccard, tokens } from './jobs';
import { agentMemoryFile, rawEntries, readSmall } from './model';

const DAY = 24 * 3600e3;
export const STALE_DAYS = 30;
const WEEKS = 12;
const JOURNAL_READ = 120;
/** a skill younger than this with no run yet is "new", not "never used" */
const NEW_SKILL_DAYS = 14;
/** known outcomes a skill needs before it is called useful / weak / mixed: on 2 the verdict was noise (ADR 0101) */
export const MIN_VERDICT = 10;
const DATE = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?\s*(?:[·|:–-]\s*)?/;

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
/** Monday 00:00 UTC of the week that holds `ms`. */
export function mondayOf(ms: number): number {
  const d = new Date(ms), wd = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - wd * DAY;
}
/** The Mondays of the last `n` weeks, oldest first. */
export function weeksTo(now: number, n = WEEKS): string[] {
  const last = mondayOf(now);
  return Array.from({ length: n }, (_, i) => iso(last - (n - 1 - i) * 7 * DAY));
}
const weekIndex = (weeks: string[], date: string): number => weeks.indexOf(iso(mondayOf(dayMs(date))));

/** A list line split into its own date (when it starts with one) and the text after it. */
export function splitDate(line: string): { date: string | null; time: string | null; text: string } {
  const m = DATE.exec(line);
  if (!m || Number.isNaN(dayMs(m[1]!))) return { date: null, time: null, text: line.trim() };
  return { date: m[1]!, time: m[2] ?? null, text: line.slice(m[0].length).trim() };
}

// ── ai-errors.md ────────────────────────────────────────────────────────────────────────────────────────────────────
/** One line of ai-errors.md, in either format the brain writes: the template's
 *  `- AAAA-MM-GG HH:MM · chat · area · tipo · detto: … · vero: … · visto da: … · regola: …` or the product writer's
 *  `- AAAA-MM-GG | agent | text`. Lines that are not a dated list item are not errors (the file's own explanation). */
export function parseError(line: string): Omit<ErrorEntry, 'group'> | null {
  const l = line.replace(/^\s*[-*]\s+/, '');
  const { date, time, text } = splitDate(l);
  if (!date || !text) return null;
  const pipes = text.includes(' | ') && !/\s·\s/.test(text);
  const parts = text.split(pipes ? /\s+\|\s+/ : /\s+·\s+/).map(p => p.trim()).filter(Boolean);
  const kv = (k: string) => parts.find(p => fold(p).startsWith(`${k}:`))?.replace(/^[^:]+:\s*/, '') ?? null;
  if (pipes || parts.length < 4 || !parts.some(p => /^(detto|vero|regola|visto da):/i.test(p))) {
    const [agent, ...rest] = parts.length > 1 ? parts : ['', ...parts];
    return { date, time, agent: agent || '—', area: null, type: null, text: rest.join(' · ') || text, rule: kv('regola') };
  }
  const [agent = '—', area = null, type = null] = parts;
  return { date, time, agent, area, type, text: kv('vero') ?? kv('detto') ?? parts.slice(3).join(' · '), rule: kv('regola') };
}

/** A group's name: the first clause (before a colon) its lines repeat most, else the shortest one, at most 70 characters. */
const label = (members: Omit<ErrorEntry, 'group'>[]): string => {
  const clauses = members.map(m => m.text.replace(/[*_`]/g, '').split(/:\s/)[0]!.trim());
  const counts = new Map<string, { text: string; n: number }>();
  for (const c of clauses) { const k = fold(c).replace(/[^a-z0-9]+/g, ' ').trim(); const e = counts.get(k) ?? { text: c, n: 0 }; e.n++; counts.set(k, e); }
  const best = [...counts.values()].sort((x, y) => y.n - x.n || x.text.length - y.text.length)[0]!.text;
  return best.length > 70 ? `${best.slice(0, 69)}…` : best;
};
/** Recurring errors: lines with the same type and area, else lines whose words overlap (Jaccard ≥ 0.3 with the group's
 *  first line, or three content words in common). */
export function groupErrors(entries: Omit<ErrorEntry, 'group'>[], weeks: string[]): { items: ErrorEntry[]; groups: ErrorGroup[] } {
  const groups: { key: string; seed: Set<string>; members: Omit<ErrorEntry, 'group'>[] }[] = [];
  const items: ErrorEntry[] = [];
  for (const e of entries) {
    let g = e.type && e.area ? groups.find(x => x.key === `t:${fold(e.type!)}|${fold(e.area!)}`) : undefined;
    if (!g && !(e.type && e.area)) {
      const tk = tokens(e.text);
      g = groups.find(x => !x.key.startsWith('t:') && (jaccard(tk, x.seed) >= 0.3 || [...tk].filter(w => !w.startsWith('~') && x.seed.has(w)).length >= 3));
    }
    if (!g) { g = { key: e.type && e.area ? `t:${fold(e.type)}|${fold(e.area)}` : `w:${groups.length}`, seed: tokens(e.text), members: [] }; groups.push(g); }
    g.members.push(e);
    items.push({ ...e, group: g.key });
  }
  const out: ErrorGroup[] = groups.map(g => {
    const dates = g.members.map(m => m.date).filter((d): d is string => !!d).sort();
    const trend = weeks.map(() => 0);
    for (const d of dates) { const i = weekIndex(weeks, d); if (i >= 0) trend[i]!++; }
    const withType = g.members[0]!.type && g.members[0]!.area;
    return { key: g.key, label: withType ? `${g.members[0]!.type} · ${g.members[0]!.area}` : label(g.members), count: g.members.length,
      agents: [...new Set(g.members.map(m => m.agent))].sort(), first: dates[0] ?? null, last: dates[dates.length - 1] ?? null, trend,
      sample: g.members[g.members.length - 1]!.text, rule: [...g.members].reverse().find(m => m.rule)?.rule ?? null };
  });
  return { items, groups: out.sort((a, b) => b.count - a.count || (b.last ?? '').localeCompare(a.last ?? '')) };
}

// ── skills from the runs ────────────────────────────────────────────────────────────────────────────────────────────
export function skillUses(skills: BrainSkill[], runs: AgentRun[], now: number): SkillUse[] {
  return skills.map(s => {
    const mine = runs.filter(r => r.tags?.skills.includes(s.name));
    const known = mine.filter(r => r.outcome && r.outcome.verdict !== 'unknown');
    const ok = known.filter(r => r.outcome!.verdict === 'success').length;
    const success = known.length ? ok / known.length : null;
    const verdict: SkillVerdict = !mine.length ? (s.changedAt && now - s.changedAt < NEW_SKILL_DAYS * DAY ? 'new' : 'unused')
      : known.length < MIN_VERDICT ? 'few' : success! >= 0.7 ? 'useful' : success! < 0.5 ? 'weak' : 'mixed';
    return { name: s.name, rel: s.rel, uses: mine.length, known: known.length, ok, success, lastUse: mine.length ? Math.max(...mine.map(r => r.startedAt)) : null, usedBy: s.usedBy.length, verdict };
  }).sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
}

// ── the whole page ──────────────────────────────────────────────────────────────────────────────────────────────────
export interface MemoryStatsInput {
  root: string;
  memory: MemoryFile[];
  profiles: readonly AgentProfile[];
  runs: AgentRun[];
  skills: BrainSkill[];
  now: number;
}
const growthKind = (m: MemoryFile): MemoryGrowthKind | null => (m.kind === 'agent' || m.kind === 'shared' ? 'agent' : m.kind === 'errors' ? 'errors' : m.kind === 'journal' ? 'journal' : m.kind === 'knowledge' ? 'knowledge' : null);
const normLine = (t: string) => fold(t).replace(/[^a-z0-9]+/g, ' ').trim();
const STOPWORDS_ERR = new Set(['sempre', 'invece', 'senza', 'detto', 'vero', 'regola', 'fatto', 'stato', 'leggere', 'perche', 'quando']);

export function memoryStats(i: MemoryStatsInput): MemoryStats {
  const weeks = weeksTo(i.now);
  const runs = i.runs.filter(r => r.source !== 'oneshot');
  const growth = new Map<MemoryGrowthKind, number[]>((['agent', 'errors', 'journal', 'knowledge'] as const).map(k => [k, weeks.map(() => 0)]));
  const byDay = new Map<string, number>();
  const count = (kind: MemoryGrowthKind | null, date: string) => {
    byDay.set(date, (byDay.get(date) ?? 0) + 1);
    const w = kind ? weekIndex(weeks, date) : -1;
    if (kind && w >= 0) growth.get(kind)![w]!++;
  };
  const runsSince = (agentId: string | null, date: string | null) => runs.filter(r => (agentId === null || r.agentId === agentId) && (!date || r.startedAt >= dayMs(date))).length;

  // every dated line of every memory file (the journal: every line of every day file)
  const lines: MemoryLine[] = [];
  let entries = 0;
  for (const m of i.memory) {
    if (m.kind === 'journal') {
      let files: string[] = [];
      try { files = fs.readdirSync(path.join(i.root, 'journal')).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/i.test(f)); } catch { /* none */ }
      // bounded: the newest JOURNAL_READ days are read line by line, an older day counts as one line
      files.sort().reverse();
      for (const [k, f] of files.entries()) {
        const n = k < JOURNAL_READ ? rawEntries(readSmall(path.join(i.root, 'journal', f)) ?? '').length || 1 : 1;
        entries += n;
        for (let j = 0; j < n; j++) count('journal', f.slice(0, 10));
      }
      continue;
    }
    const raw = m.kind === 'errors' ? [] : rawEntries(readSmall(path.join(i.root, m.file)) ?? '');
    entries += m.kind === 'errors' ? 0 : raw.length || m.entries;
    const fallback = m.changedAt ? iso(m.changedAt) : null;
    for (const r of raw) {
      const { date, text } = splitDate(r);
      const d = date ?? fallback;
      if (d) count(growthKind(m), d);
      if (m.kind === 'agent' || m.kind === 'shared') lines.push({ text, owner: m.kind === 'shared' ? 'Condivisa' : m.group, file: m.file, date, recalls: runsSince(m.kind === 'shared' ? null : m.agentId ?? null, date) });
      else if (date) lines.push({ text, owner: m.title, file: m.file, date, recalls: 0 });
    }
  }

  // errors
  const errFile = i.memory.find(m => m.kind === 'errors');
  const parsed = errFile ? (readSmall(path.join(i.root, errFile.file)) ?? '').split(/\r?\n/).map(parseError).filter((e): e is NonNullable<ReturnType<typeof parseError>> => !!e) : [];
  for (const e of parsed) count('errors', e.date!);
  entries += parsed.length;
  const { items, groups } = groupErrors(parsed, weeks);
  const weekly = weeks.map(() => 0), weekday = [0, 0, 0, 0, 0, 0, 0];
  const agents = new Map<string, number>(), words = new Map<string, number>();
  let last30 = 0, prev30 = 0;
  for (const e of parsed) {
    const t = dayMs(e.date!), w = weekIndex(weeks, e.date!);
    if (w >= 0) weekly[w]!++;
    weekday[(new Date(t).getUTCDay() + 6) % 7]!++;
    const age = (i.now - t) / DAY;
    if (age < 30) last30++; else if (age < 60) prev30++;
    agents.set(e.agent, (agents.get(e.agent) ?? 0) + 1);
    for (const w of tokens(e.text)) if (!w.startsWith('~') && !STOPWORDS_ERR.has(w)) words.set(w, (words.get(w) ?? 0) + 1);
  }
  const top = [...words].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];

  // agents
  const roles = i.profiles.filter(p => p.scope === 'role');
  const perAgent: AgentMemoryStat[] = roles.map(p => {
    const file = agentMemoryFile(p.id), m = i.memory.find(x => x.kind === 'agent' && x.agentId === p.id);
    const mine = lines.filter(l => l.file === file), dated = mine.map(l => l.date).filter((d): d is string => !!d).sort();
    return { agentId: p.id, name: p.name, file, exists: !!m, entries: m ? mine.length || m.entries : 0, recalls: m ? runsSince(p.id, dated[0] ?? null) : 0,
      lastAt: dated.length ? dayMs(dated[dated.length - 1]!) : m?.changedAt ?? null };
  }).sort((a, b) => b.entries - a.entries || a.name.localeCompare(b.name));

  // the same line in two or more agents' memories
  const owners = new Map<string, Set<string>>();
  for (const l of lines) if (l.owner !== 'Condivisa' && i.memory.some(m => m.kind === 'agent' && m.file === l.file)) {
    const k = normLine(l.text); if (k.length < 12) continue;
    const s = owners.get(k) ?? new Set<string>(); s.add(l.file); owners.set(k, s);
  }
  const memLines = lines.filter(l => i.memory.some(m => (m.kind === 'agent' || m.kind === 'shared') && m.file === l.file));
  const oldest = memLines.filter(l => l.date).sort((a, b) => a.date!.localeCompare(b.date!))[0] ?? null;
  const busiest = [...byDay].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0];

  return {
    at: i.now, weeks,
    totals: { files: i.memory.length, entries, agents: roles.length, agentsWithMemory: perAgent.filter(a => a.exists).length,
      shared: i.memory.find(m => m.kind === 'shared')?.entries ?? 0, runs: runs.length },
    perAgent,
    growth: [...growth].map(([kind, values]) => ({ kind, values })),
    topRecalled: [...memLines].sort((a, b) => b.recalls - a.recalls || (a.date ?? '').localeCompare(b.date ?? '')).filter(l => l.recalls > 0).slice(0, 5),
    stale: i.memory.filter(m => m.kind !== 'journal' && m.changedAt && i.now - m.changedAt >= STALE_DAYS * DAY)
      .map(m => ({ file: m.file, title: m.title, kind: m.kind, days: Math.floor((i.now - m.changedAt!) / DAY) })).sort((a, b) => b.days - a.days).slice(0, 12),
    staleDays: STALE_DAYS,
    duplicates: [...owners.values()].filter(s => s.size >= 2).length,
    oldest, busiestDay: busiest ? { date: busiest[0], n: busiest[1] } : null,
    errors: { total: parsed.length, last30, prev30, weekly, groups: groups.slice(0, 12), byAgent: [...agents].map(([agent, n]) => ({ agent, count: n })).sort((a, b) => b.count - a.count || a.agent.localeCompare(b.agent)),
      weekday, topWord: top && top[1] >= 2 ? { word: top[0], n: top[1] } : null, items: items.map((e, k) => ({ e, k })).sort((a, b) => `${b.e.date} ${b.e.time ?? ''}`.localeCompare(`${a.e.date} ${a.e.time ?? ''}`) || b.k - a.k).map(x => x.e).slice(0, 200) },
    skills: skillUses(i.skills, runs, i.now),
  };
}
