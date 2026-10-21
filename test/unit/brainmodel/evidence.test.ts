// The evidence layer (src/main/brainmodel/evidence.ts, ADR 0109): a change is sealed with the roles and skill it is
// measured on; its claim compares the user's corrections per run before (frozen, newest 40) and after it, with a verdict
// only at the checkpoints; an undone change reads «annullato»; the Apprendimento page counts verdicts and draws weekly
// corrections per role with the changes on them.
import { describe, expect, it } from 'vitest';
import { BASELINE_MAX, claimOf, learningState, seal, WEEK, WEEKS } from '../../../src/main/brainmodel/evidence';
import type { AgentRun } from '../../../src/shared/agents';
import type { BrainChange } from '../../../src/shared/brain-model';

const HOUR = 3600e3, AT = Date.parse('2026-09-01T00:00:00Z');
const roles = [
  { id: 'artisan', name: 'Artisan', skills: ['note-di-rilascio'], knowhow: undefined },
  { id: 'scout', name: 'Scout', skills: [], knowhow: { linked: ['note-di-rilascio'] } as never },
  { id: 'herald', name: 'Herald', skills: [], knowhow: undefined },
];
let seq = 0;
function run(agentId: string, startedAt: number, corrections: number | null, o: Partial<AgentRun> = {}): AgentRun {
  return { source: 'chat', runId: `r${seq++}`, chatId: 'c', agentId, version: 1, goal: 'g', startedBy: 'user', startedAt, endedAt: startedAt + HOUR,
    counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: null, tokens: null,
    ...(corrections === null ? {} : { corrections: { tagged: corrections, afterReport: 0 } }), ...o };
}
/** n runs of a role, one every 6 hours, before (side -1) or after (+1) AT; corrections from the pattern */
const side = (agentId: string, n: number, dir: -1 | 1, pattern: number[], o: Partial<AgentRun> = {}): AgentRun[] =>
  Array.from({ length: n }, (_, i) => run(agentId, dir < 0 ? AT - (i + 2) * 6 * HOUR : AT + (i + 1) * 6 * HOUR, pattern[i % pattern.length]!, o));
const change = { id: 'c1', at: AT };

describe('seal', () => {
  it('measures a role change on that role, a rule on every role, a skill on its users and the runs that load it', () => {
    expect(seal({ kind: 'agent', action: 'update', target: 'artisan' }, roles)).toEqual({ hypothesis: 'fewer', scope: ['artisan'], skill: null });
    expect(seal({ kind: 'rule', action: 'create', target: 'rules/x.md' }, roles)).toEqual({ hypothesis: 'fewer', scope: [], skill: null });
    expect(seal({ kind: 'skill', action: 'create', target: 'note-di-rilascio' }, roles)).toEqual({ hypothesis: 'fewer', scope: ['artisan', 'scout'], skill: 'note-di-rilascio' });
    expect(seal({ kind: 'skill', action: 'update', target: 'note-di-rilascio' }, roles)).toMatchObject({ baselineSkill: true });
    expect(seal({ kind: 'skill', action: 'merge', target: 'altro' }, roles)).toEqual({ hypothesis: 'not-more', scope: [], skill: 'altro', baselineSkill: true });
    expect(seal({ kind: 'skill', action: 'remove', target: 'note-di-rilascio' }, roles)).toEqual({ hypothesis: 'not-more', scope: ['artisan', 'scout'], skill: null });
    expect(seal({ kind: 'memory', action: 'merge', target: 'agents/scout/memory.md' }, roles)).toEqual({ hypothesis: 'not-more', scope: ['scout'], skill: null });
    expect(seal({ kind: 'memory', action: 'merge', target: 'memory/clienti.md' }, roles).scope).toEqual([]);
    expect(seal({ kind: 'agent', action: 'unlink', target: 'herald' }, roles).hypothesis).toBe('not-more');
  });
});

describe('claimOf', () => {
  const seed = { hypothesis: 'fewer' as const, scope: ['artisan'], skill: null };
  it('stays «in raccolta» below the first checkpoint, saying which checkpoint is next', () => {
    const c = claimOf(change, seed, [...side('artisan', 30, -1, [2]), ...side('artisan', 7, 1, [0])]);
    expect(c).toMatchObject({ verdict: 'raccolta', need: 20, diff: null, before: { n: 30, judged: 20 }, after: { n: 7, judged: 0, mean: 0 } });
  });
  it('«aiuta» when the interval of the difference is below zero, judged at the checkpoint only', () => {
    const runs = [...side('artisan', 50, -1, [2, 1, 3, 2]), ...side('artisan', 27, 1, [0, 1, 0, 0])];
    const c = claimOf(change, seed, runs);
    expect(c.verdict).toBe('aiuta');
    expect(c.before).toMatchObject({ n: BASELINE_MAX, judged: 40, mean: 2 });
    expect(c.after).toMatchObject({ n: 27, judged: 20 });
    expect(c.diff!.high).toBeLessThan(0);
    expect(c.need).toBe(40);
    expect(claimOf(change, seed, side('artisan', 25, 1, [0])).need).toBe(40);
    // the same data, the same interval (seeded); a run past the checkpoint changes nothing
    expect(claimOf(change, seed, runs)).toEqual(c);
    expect(claimOf(change, seed, [...runs, run('artisan', AT + 400 * HOUR, 9)]).diff).toEqual(c.diff);
  });
  it('«peggiora» when the corrections went up, and «annullato» once undone (runs after the undo do not count)', () => {
    const runs = [...side('artisan', 20, -1, [0, 0, 1, 0]), ...side('artisan', 20, 1, [2, 3, 2, 2])];
    expect(claimOf(change, seed, runs).verdict).toBe('peggiora');
    const undone = claimOf({ ...change, rolledBackAt: AT + 30 * HOUR }, seed, runs);
    expect(undone.verdict).toBe('annullato');
    expect(undone.after.n).toBe(4);
  });
  it('«nessun effetto» when the interval sits inside the margin', () => {
    const flat = [1, 1, 1, 1, 0, 2];
    expect(claimOf(change, seed, [...side('artisan', 40, -1, [1]), ...side('artisan', 40, 1, [1])]).verdict).toBe('nessun-effetto');
    // noisy and undecided after 160 runs: no effect worth the name
    const c = claimOf(change, seed, [...side('artisan', 40, -1, [0, 3, 1, 0]), ...side('artisan', 160, 1, [0, 3, 0, 1, 0, 2, ...flat])]);
    expect(c.need).toBeNull();
    expect(['nessun-effetto', 'aiuta']).toContain(c.verdict);
  });
  it('counts only its scope, chat runs that ended with corrections counted, and for a skill the runs that loaded it', () => {
    const runs = [
      ...side('artisan', 20, -1, [1]), ...side('scout', 20, -1, [5]),
      ...side('artisan', 5, 1, [0]), run('artisan', AT + HOUR, null), run('artisan', AT + HOUR, 0, { source: 'oneshot' }), run('artisan', AT + HOUR, 0, { endedAt: undefined }),
      ...side('artisan', 3, 1, [0], { tags: { skills: ['note-di-rilascio'], app: null, repo: null } }),
    ];
    expect(claimOf(change, seed, runs)).toMatchObject({ before: { n: 20, mean: 1 }, after: { n: 8 } });
    expect(claimOf(change, { hypothesis: 'fewer', scope: [], skill: null }, runs).before.n).toBe(40);
    expect(claimOf(change, { hypothesis: 'fewer', scope: ['artisan'], skill: 'note-di-rilascio' }, runs).after.n).toBe(3);
    // an updated skill: the baseline too is the runs that loaded it
    expect(claimOf(change, { hypothesis: 'fewer', scope: ['artisan'], skill: 'note-di-rilascio', baselineSkill: true }, runs).before.n).toBe(0);
  });
});

describe('learningState', () => {
  it('counts the verdicts and draws each role\'s weekly corrections with the changes measured on its runs', () => {
    const now = AT + 20 * 86_400_000;
    const claim = (verdict: BrainChange['claim'] extends infer C ? C extends { verdict: infer V } ? V : never : never, scope: string[]) =>
      ({ hypothesis: 'fewer', metric: 'corrections', scope, skill: null, before: { n: 0, judged: 0, mean: null }, after: { n: 0, judged: 0, mean: null }, need: 20, diff: null, verdict }) as const;
    const base = { job: 'corrections' as const, kind: 'agent' as const, action: 'update' as const, target: 'artisan', reason: '', evidence: [], canRollback: true };
    const changes: BrainChange[] = [
      { ...base, id: 'a', at: AT, summary: 'Artisan aggiornato', claim: { ...claim('aiuta', ['artisan']) } },
      { ...base, id: 'b', at: AT + HOUR, summary: 'Regola', kind: 'rule', claim: { ...claim('raccolta', []) } },
      { ...base, id: 'c', at: now - (WEEKS + 1) * WEEK, summary: 'Vecchia', claim: { ...claim('annullato', ['artisan']) } },
      { ...base, id: 'd', at: AT, summary: 'Senza prova' },
    ];
    const runs = [run('artisan', now - 2 * 86_400_000, 2), run('artisan', now - 3 * 86_400_000, 1), run('scout', now - 2 * 86_400_000, 4), run('artisan', now - 2 * 86_400_000, null)];
    const s = learningState(changes, roles, runs, now);
    expect(s.counts).toEqual({ raccolta: 1, aiuta: 1, 'nessun-effetto': 0, peggiora: 0, annullato: 1 });
    expect(s.week).toBe(WEEK);
    const artisan = s.roles.find(r => r.id === 'artisan')!;
    expect(artisan.weeks).toHaveLength(WEEKS);
    expect(artisan.weeks.at(-1)).toMatchObject({ runs: 2, corrections: 3 });
    expect(artisan.changes.map(c => c.id)).toEqual(['a', 'b']);
    expect(s.roles.find(r => r.id === 'herald')!.changes.map(c => c.id)).toEqual(['b']);
  });
});
