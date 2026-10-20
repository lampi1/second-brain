// The Memoria page's statistics (src/main/brainmodel/memory-stats.ts): both ai-errors.md formats, recurring error groups
// (same type and area, or shared words), weeks, recalls counted from the runs of each agent since a line's date, stale
// files, duplicates across agents' memories, skill verdicts from the runs, and the demo brain end to end. Temp folders only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { groupErrors, memoryStats, mondayOf, parseError, skillUses, splitDate, weeksTo } from '../../../src/main/brainmodel/memory-stats';
import { readMemory, readSkills } from '../../../src/main/brainmodel/model';
import { demoBrainRuns, writeDemoBrain } from '../../../src/main/brainmodel/demo';
import type { AgentProfile, AgentRun } from '../../../src/shared/agents';
import type { BrainSkill } from '../../../src/shared/brain-model';

const DAY = 24 * 3600e3;
const NOW = Date.UTC(2026, 9, 19, 10); // a Monday
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-mstats-'))); dirs.push(d); return d; };
const put = (root: string, rel: string, text: string, age = 0) => {
  const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text);
  const t = new Date(NOW - age * DAY); fs.utimesSync(f, t, t);
};
const role = (id: string, name = id) => ({ id, name, scope: 'role', skills: [], knowhow: { folder: 'x', linked: [], hash: 'a'.repeat(64) } }) as unknown as AgentProfile;
const run = (agentId: string, daysAgo: number, skills: string[] = [], verdict?: 'success' | 'partial' | 'fail' | 'unknown'): AgentRun => ({
  source: 'chat', runId: `r_${agentId}_${daysAgo}_${skills.join()}`, chatId: 'c', agentId, version: 1, goal: 'g', startedBy: 'user', startedAt: NOW - daysAgo * DAY,
  counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: null, tokens: null,
  ...(verdict ? { outcome: { verdict, basis: 'human', at: NOW, by: 'u' } } : {}), tags: { skills, app: null, repo: null },
});
const day = (n: number) => new Date(NOW - n * DAY).toISOString().slice(0, 10);

describe('dates and weeks', () => {
  it('splits a leading date (and time) from a line', () => {
    expect(splitDate('2026-10-07 · Il nodo scrive in UTC')).toEqual({ date: '2026-10-07', time: null, text: 'Il nodo scrive in UTC' });
    expect(splitDate('2026-10-07 14:30 · chat · x')).toEqual({ date: '2026-10-07', time: '14:30', text: 'chat · x' });
    expect(splitDate('Senza data')).toEqual({ date: null, time: null, text: 'Senza data' });
  });
  it('counts twelve Monday weeks ending with this one', () => {
    const w = weeksTo(NOW);
    expect(w).toHaveLength(12);
    expect(w[11]).toBe('2026-10-19');
    expect(w[0]).toBe('2026-08-03');
    expect(new Date(mondayOf(Date.UTC(2026, 9, 25))).toISOString().slice(0, 10)).toBe('2026-10-19'); // Sunday → its Monday
  });
});

describe('ai-errors.md', () => {
  it('reads both formats: the template\'s and the product writer\'s', () => {
    expect(parseError('- 2026-10-07 09:40 · Artisan · rilasci · verifica mancata · detto: fatto · vero: nessuno screenshot · visto da: tu · regola: niente fatto senza screenshot'))
      .toEqual({ date: '2026-10-07', time: '09:40', agent: 'Artisan', area: 'rilasci', type: 'verifica mancata', text: 'nessuno screenshot', rule: 'niente fatto senza screenshot' });
    expect(parseError('- 2026-10-07 | Scout | Ha letto l\'avviso generico')).toEqual({ date: '2026-10-07', time: null, agent: 'Scout', area: null, type: null, text: 'Ha letto l\'avviso generico', rule: null });
    expect(parseError('Formato: `- AAAA-MM-GG …`')).toBeNull();
    expect(parseError('- **Read when:** la skill')).toBeNull();
  });
  it('groups recurring errors by type and area, else by shared words, with a weekly trend', () => {
    const weeks = weeksTo(NOW);
    const lines = [
      `- ${day(20)} | Scout | Ha letto l'avviso generico invece del log del nodo del cliente`,
      `- ${day(10)} | Scout | Di nuovo l'avviso generico al posto del log del nodo`,
      `- ${day(1)} | Judge | Ha letto l'avviso generico invece del log del nodo`,
      `- ${day(5)} | Sentinel | Test dato per passato senza eseguirlo`,
      `- ${day(3)} 10:00 · Artisan · rilasci · verifica mancata · detto: fatto · vero: build rossa`,
      `- ${day(2)} 10:00 · Artisan · rilasci · verifica mancata · detto: fatto · vero: pagina in errore · regola: screenshot prima`,
    ].map(l => parseError(l)!);
    const { groups, items } = groupErrors(lines, weeks);
    expect(groups.map(g => [g.count, g.agents])).toEqual([[3, ['Judge', 'Scout']], [2, ['Artisan']], [1, ['Sentinel']]]);
    expect(groups[0]!.label).toMatch(/avviso|generico|nodo/);
    expect(groups[1]).toMatchObject({ label: 'verifica mancata · rilasci', rule: 'screenshot prima', last: day(2) });
    expect(groups[0]!.trend.reduce((a, b) => a + b, 0)).toBe(3);
    expect(items.filter(i => i.group === groups[0]!.key)).toHaveLength(3);
  });
});

describe('skills from the runs', () => {
  const skill = (name: string, ageDays: number | null): BrainSkill => ({ name, description: '', file: `/x/${name}/SKILL.md`, rel: `.claude/skills/${name}/SKILL.md`, home: 'brain', usedBy: ['a'], tools: [], lines: 3, changedAt: ageDays === null ? null : NOW - ageDays * DAY, madeBy: null });
  it('says useful, weak, few, never used or new, with uses, success and last use', () => {
    // a verdict from 10 known outcomes up (ADR 0101): on 3 or 4 it stays "few"
    const many = (name: string, ok: number, fail: number) => [...Array.from({ length: ok }, (_, i) => run('a', 1 + i, [name], 'success')), ...Array.from({ length: fail }, (_, i) => run('a', 1 + ok + i, [name], 'fail'))];
    const runs = [...many('buona', 8, 2), ...many('debole', 3, 7), run('a', 1, ['poche'], 'success'), run('a', 2, ['poche'], 'success'), run('a', 3, ['poche'], 'fail'), run('a', 5, ['rara'], 'unknown')];
    const u = skillUses([skill('buona', 90), skill('debole', 90), skill('poche', 90), skill('rara', 90), skill('ferma', 90), skill('nuova', 2)], runs, NOW);
    expect(u.map(s => [s.name, s.uses, s.known, s.verdict])).toEqual([['buona', 10, 10, 'useful'], ['debole', 10, 10, 'weak'], ['poche', 3, 3, 'few'], ['rara', 1, 0, 'few'], ['ferma', 0, 0, 'unused'], ['nuova', 0, 0, 'new']]);
    expect(u[0]).toMatchObject({ success: 0.8, lastUse: NOW - DAY, usedBy: 1 });
    expect(u[3]!.success).toBeNull();
  });
});

describe('memoryStats', () => {
  it('counts lines per agent, recalls since each line, growth, stale files and duplicates', () => {
    const root = tmp();
    put(root, 'agents/scout/memory.md', `# Memoria\n\n- ${day(30)} · Il nodo scrive i log in UTC\n- ${day(3)} · L'ambiente di test si azzera ogni notte\n`, 3);
    put(root, 'agents/artisan/memory.md', `# Memoria\n\n- ${day(8)} · L'ambiente di test si azzera ogni notte\n`, 8);
    put(root, 'clienti/alfa.md', '# Alfa\n\n- Referente: acquisti\n', 45);
    put(root, 'journal/2026-10-12.md', '# Diario\n\n- uno\n- due\n', 7);
    put(root, 'ai-errors.md', `# Errori\n\n- ${day(2)} | scout | Letto l'avviso generico invece del log del nodo\n- ${day(40)} | scout | Avviso generico invece del log del nodo\n`, 2);
    const profiles = [role('scout', 'Scout'), role('artisan', 'Artisan'), role('herald', 'Herald')];
    const memory = readMemory(root, profiles);
    const runs = [run('scout', 40), run('scout', 20), run('scout', 1), run('artisan', 1), { ...run('scout', 1), source: 'oneshot' as const }];
    const s = memoryStats({ root, memory, profiles, runs, skills: [], now: NOW });
    expect(s.perAgent.map(a => [a.name, a.exists, a.entries, a.recalls])).toEqual([['Scout', true, 2, 2], ['Artisan', true, 1, 1], ['Herald', false, 0, 0]]);
    expect(s.totals).toMatchObject({ agents: 3, agentsWithMemory: 2, runs: 4 });
    expect(s.topRecalled[0]).toMatchObject({ owner: 'Scout', text: 'Il nodo scrive i log in UTC', recalls: 2, date: day(30) });
    expect(s.stale).toEqual([{ file: 'clienti/alfa.md', title: 'Alfa', kind: 'knowledge', days: 45 }]);
    expect(s.duplicates).toBe(1);
    expect(s.oldest).toMatchObject({ date: day(30) });
    const sum = (k: string) => s.growth.find(g => g.kind === k)!.values.reduce((a, b) => a + b, 0);
    expect([sum('agent'), sum('journal'), sum('knowledge'), sum('errors')]).toEqual([3, 2, 1, 2]);
    expect(s.errors).toMatchObject({ total: 2, last30: 1, prev30: 1, byAgent: [{ agent: 'scout', count: 2 }] });
    expect(s.errors.groups[0]!.count).toBe(2);
    expect(s.errors.topWord?.n).toBe(2);
    expect(s.errors.items[0]!.date).toBe(day(2)); // newest first
  });
  it('is empty, not failing, on a fresh brain', () => {
    const root = tmp();
    const s = memoryStats({ root, memory: readMemory(root, [role('scout')]), profiles: [role('scout')], runs: [], skills: [], now: NOW });
    expect(s.totals.entries).toBe(0);
    expect(s.errors.total).toBe(0);
    expect(s.topRecalled).toEqual([]);
    expect(s.oldest).toBeNull();
    expect(s.busiestDay).toBeNull();
  });
  it('reads the demo brain: recurring errors, recalled memories and a skill nobody used', () => {
    const root = writeDemoBrain(tmp(), NOW);
    const profiles = ['scout', 'artisan', 'sentinel', 'scribe', 'judge', 'herald'].map(id => role(id, id[0]!.toUpperCase() + id.slice(1)));
    const skills = readSkills([{ dir: path.join(root, '.claude/skills'), home: 'brain' }], root, profiles);
    const runs = demoBrainRuns(NOW, ['uno', 'due', 'tre', ...skills.map(x => x.name)]);
    const s = memoryStats({ root, memory: readMemory(root, profiles), profiles, runs, skills, now: NOW });
    expect(s.errors.total).toBe(12);
    expect(s.errors.groups[0]!.count).toBeGreaterThanOrEqual(3);
    expect(s.perAgent.find(a => a.agentId === 'herald')!.exists).toBe(false);
    expect(s.topRecalled.length).toBeGreaterThan(0);
    expect(s.duplicates).toBe(1);
    expect(s.skills.find(x => x.name === 'pulizia-ambiente')!.verdict).toBe('unused');
    expect(s.skills.find(x => x.name === 'note-di-rilascio')!.uses).toBeGreaterThan(0);
    expect(s.stale.some(x => x.file === 'ambienti/vecchio-server.md')).toBe(true);
  });
});
