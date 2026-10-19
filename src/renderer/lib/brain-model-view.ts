// Pure view helpers of the Brain section (ADR 0077), shared by the Skill, Regole, Memoria, Classificatori and Mappa pages,
// the maintenance panel and the agent card's back: one list of skills (the brain model's, plus the Cursor skills only the
// skill editor sees), filters, the links graph agent → skills → rules → memory, the "same / different" of an agent
// choice and the number formats where a missing value is "no data yet", never zero. No React, no IPC: unit-tested in
// test/unit/brain-ui/brain-model-view.test.ts.
import type { BrainChange, BrainModelState, BrainSkill, ClassifierChoice, MemoryFile } from '@shared/brain-model';
import type { SkillCatalog, SkillEntry } from '@shared/contract';

export type SkillRowHome = BrainSkill['home'] | 'cursor';
export interface SkillRow {
  name: string; description: string; home: SkillRowHome; usedBy: string[]; tools: string[];
  /** absolute SKILL.md path; brain-relative path when inside the brain */
  file: string; rel: string | null; madeBy: BrainSkill['madeBy']; lines: number; changedAt: number | null;
  /** the skill editor's entry for it (skills:read / save / delete), when the editor lists it */
  entry: SkillEntry | null;
  /** read by the brain model (the brain's or the user's skill folders): agents can declare it */
  linkable: boolean;
}
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** The brain model's skills with their editor entry, then the editor's skills the model does not read (Cursor's). */
export function skillRows(state: BrainModelState | null, catalog: SkillCatalog | null): SkillRow[] {
  const entries = (catalog?.entries ?? []).filter(e => e.kind === 'skill');
  const used = new Set<string>();
  const rows: SkillRow[] = (state?.skills ?? []).map(s => {
    const entry = entries.find(e => norm(e.path) === norm(s.file)) ?? entries.find(e => e.harness === 'claude' && e.name === s.name && !used.has(e.id)) ?? null;
    if (entry) used.add(entry.id);
    return { name: s.name, description: s.description, home: s.home, usedBy: s.usedBy, tools: s.tools, file: s.file, rel: s.rel, madeBy: s.madeBy, lines: s.lines, changedAt: s.changedAt, entry, linkable: true };
  });
  for (const e of entries) {
    if (used.has(e.id) || rows.some(r => norm(r.file) === norm(e.path))) continue;
    rows.push({ name: e.name, description: e.description, home: e.harness === 'cursor' ? 'cursor' : 'user', usedBy: [], tools: [], file: e.path, rel: null, madeBy: null, lines: 0, changedAt: e.mtime ?? null, entry: e, linkable: false });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export type SkillFilter = 'all' | 'used' | 'unused';
export function filterSkills(rows: SkillRow[], query: string, filter: SkillFilter): SkillRow[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(r => (filter === 'all' || (filter === 'used' ? r.usedBy.length > 0 : r.linkable && !r.usedBy.length))
    && words.every(w => `${r.name} ${r.description} ${r.tools.join(' ')}`.toLowerCase().includes(w)));
}

/** Changes about given kinds (the Skill page shows skills and the agents' links; Regole its rules; Memoria memories). */
export const changesOf = (changes: BrainChange[], kinds: BrainChange['kind'][]): BrainChange[] => changes.filter(c => kinds.includes(c.kind));

/** Memory files in the page's three sections. */
export function memorySections(memory: MemoryFile[]): { knowledge: MemoryFile[]; happened: MemoryFile[]; agents: MemoryFile[] } {
  return {
    knowledge: memory.filter(m => m.kind === 'knowledge'),
    happened: memory.filter(m => m.kind === 'threads' || m.kind === 'journal' || m.kind === 'errors'),
    agents: memory.filter(m => m.kind === 'agent' || m.kind === 'shared'),
  };
}

export interface LinkNode { id: string; label: string; detail: string; kind: 'agent' | 'skill' | 'rule' | 'memory' }
export interface LinkEdge { from: string; to: string }
/** The Mappa graph: agent → the skills it declares, → its memory (and the shared one), → the rules that reach it. */
export function linkGraph(state: BrainModelState | null): { nodes: LinkNode[]; edges: LinkEdge[] } {
  if (!state?.agents.length) return { nodes: [], edges: [] };
  const nodes: LinkNode[] = [], edges: LinkEdge[] = [];
  const skills = new Map(state.skills.map(s => [s.name, s]));
  for (const a of state.agents) nodes.push({ id: `agent:${a.id}`, label: a.name, detail: a.role, kind: 'agent' });
  const usedSkills = new Set(state.agents.flatMap(a => a.skills));
  for (const name of [...new Set([...state.skills.map(s => s.name), ...usedSkills])].sort()) nodes.push({ id: `skill:${name}`, label: name, detail: skills.get(name)?.description ?? '', kind: 'skill' });
  const rules = state.rules.filter(r => r.loaded !== 'none');
  for (const r of rules) nodes.push({ id: `rule:${r.file}`, label: r.title, detail: r.file, kind: 'rule' });
  const shared = state.memory.find(m => m.kind === 'shared');
  if (shared) nodes.push({ id: `memory:${shared.file}`, label: shared.title, detail: shared.file, kind: 'memory' });
  for (const a of state.agents) {
    for (const s of a.skills) edges.push({ from: `agent:${a.id}`, to: `skill:${s}` });
    const own = state.memory.find(m => m.kind === 'agent' && m.agentId === a.id);
    if (own) { nodes.push({ id: `memory:${own.file}`, label: own.title, detail: own.file, kind: 'memory' }); edges.push({ from: `agent:${a.id}`, to: `memory:${own.file}` }); }
    if (shared) edges.push({ from: `agent:${a.id}`, to: `memory:${shared.file}` });
    for (const r of rules) edges.push({ from: `agent:${a.id}`, to: `rule:${r.file}` });
  }
  return { nodes, edges };
}

/** A skill choice: every skill used is among those suggested today, some are not, or nothing is suggested. */
export const choiceMatch = (c: ClassifierChoice): 'same' | 'differ' | 'none' => (!c.suggested.length ? 'none' : c.used.every(s => c.suggested.includes(s)) ? 'same' : 'differ');

/** 0.5 → "50%"; null stays null (the page says "no data yet"). */
export const pct = (v: number | null, locale = 'it-IT'): string | null => (v === null ? null : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(v));
export const usd = (v: number | null, locale = 'it-IT'): string | null => (v === null ? null : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: v < 1 ? 3 : 2 }).format(v));
/** A route or week without data: every value null and no run. */
export const noData = (weeks: { runs: number; success: number | null; avgCostUsd: number | null }[]): boolean => weeks.every(w => !w.runs && w.success === null && w.avgCostUsd === null);
