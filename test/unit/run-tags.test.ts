// Run tags (A7b, AGENTS-DESIGN §4.8): strict reading, skills frozen at the end, per-tag rollup counts that are dropped
// first to keep the 1 MB share, and the skill/app/repo metric filters (untagged runs never match).
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentRunStore, ROLLUP_BYTES, RUNS_MAX, SKILLS_MAX, addSkill, endRun, fitRollups, readRun, readTally, type RunStart } from '../../src/main/agents/runs';
import { closeAppDbs } from '../../src/main/app-db';
import { emptyTally, matchesTags, rollUp, runMetrics, tagOf, type RunTally } from '../../src/main/agents/run-metrics';
import type { AgentRun, AgentRunTags } from '../../src/shared/agents';

const roots: string[] = [];
afterEach(() => { closeAppDbs(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-run-tags-')); roots.push(dir); return dir; };
const tags = (o: Partial<AgentRunTags> = {}): AgentRunTags => ({ skills: ['review'], app: 'crm', repo: 'second-brain', ...o });
const start = (o: Partial<RunStart> = {}): RunStart => ({ chatId: 'c1', agentId: 'coder', version: 1, goal: 'g', startedBy: 'user', startedAt: 1000, costKnown: true, tags: tags(), ...o });

describe('run tags on the record', () => {
  it('start validates and stores tags; readRun reads them back and refuses them out of shape', () => {
    const s = new AgentRunStore(tmp());
    const run = s.start(start());
    expect(run.tags).toEqual(tags());
    expect(readRun(run)).toEqual(run);
    for (const bad of [{ skills: ['Bad Skill'], app: null, repo: null }, { skills: ['a', 'a'], app: null, repo: null }, { skills: Array.from({ length: SKILLS_MAX + 1 }, (_, i) => `s${i}`), app: null, repo: null },
      { skills: [], app: 'x'.repeat(41), repo: null }, { skills: [], app: ' crm', repo: null }, { skills: [], app: '', repo: null }, { skills: [], app: 'a\nb', repo: null }, { skills: [], app: null, repo: 'r'.repeat(121) },
      { skills: [], app: null }, null, 'tags']) {
      expect(readRun({ ...run, tags: bad })).toBeNull();
      expect(() => s.start(start({ tags: bad as AgentRunTags }))).toThrow('Esecuzione non valida.');
    }
    expect(readRun({ ...run, tags: { skills: Array.from({ length: SKILLS_MAX }, (_, i) => `s${i}`), app: 'x'.repeat(40), repo: null } })).not.toBeNull();
    const untagged = s.start(start({ tags: undefined }));
    expect(untagged.tags).toBeUndefined();
    expect(readRun(untagged)).toEqual(untagged);
  });

  it('addSkill takes the id after a plugin prefix, dedupes, stops at 16 and freezes at the run’s end', () => {
    const s = new AgentRunStore(tmp());
    const run = s.start(start({ tags: tags({ skills: [] }) }));
    expect(addSkill(run, 'my-plugin:Code-Review')).toBe(true);
    expect(addSkill(run, 'code-review')).toBe(false);
    expect(addSkill(run, 'not a skill')).toBe(false);
    expect(addSkill(run, 42)).toBe(false);
    expect(run.tags!.skills).toEqual(['code-review']);
    for (let i = 0; i < 20; i++) addSkill(run, `s${i}`);
    expect(run.tags!.skills).toHaveLength(SKILLS_MAX);
    const other = s.start(start({ tags: tags({ skills: [] }) }));
    endRun(other, 'completed', 2000);
    expect(addSkill(other, 'late')).toBe(false);
    expect(other.tags!.skills).toEqual([]);
    expect(addSkill(s.start(start({ tags: undefined })), 'any')).toBe(false); // an untagged (legacy) run stays untagged
  });
});

describe('per-tag rollups', () => {
  const ended = (o: Partial<AgentRun> = {}): AgentRun => {
    const s = new AgentRunStore(tmp());
    const r = s.start(start());
    endRun(r, 'completed', 2000);
    return { ...r, ...o };
  };

  it('readTally reads tag counts, refuses bad keys or counts, and both tags and tagsLost together', () => {
    const t = rollUp([], [ended()], [])[0]!;
    expect(t.tags!.skills.review!.ended).toBe(1);
    expect(readTally(t)).toEqual(t);
    expect(readTally({ ...t, tags: { ...t.tags, skills: { 'Bad Key': t.tags!.skills.review } } })).toBeNull();
    expect(readTally({ ...t, tags: { ...t.tags, apps: { crm: { ...t.tags!.apps.crm, ended: -1 } } } })).toBeNull();
    expect(readTally({ ...t, tagsLost: true })).toBeNull();
    const { tags: _t, ...lost } = t;
    void _t;
    expect(readTally({ ...lost, tagsLost: true })).toEqual({ ...lost, tagsLost: true });
    expect(readTally({ ...lost, tagsLost: false })).toBeNull();
  });

  it('folds each pruned run once, across two prunes, into its tally and each tag it carries; untagged runs into none', () => {
    const a = ended(), b = ended({ tags: tags({ skills: ['review', 'deploy'], app: null }) }), legacy = ended({ tags: undefined });
    const first = rollUp([], [a], [a, b, legacy]);
    const second = rollUp(first, [b, legacy], [b, legacy]);
    expect(second).toHaveLength(1);
    const t = second[0]!;
    expect(t.ended).toBe(3);
    expect(t.tags!.skills.review!.ended).toBe(2);
    expect(t.tags!.skills.deploy!.ended).toBe(1);
    expect(t.tags!.apps.crm!.ended).toBe(1);
    expect(t.tags!.repos['second-brain']!.ended).toBe(2);
    // counts only: no samples
    expect(Object.keys(t.tags!.skills.review!)).not.toContain('cost');
  });

  it('a "__proto__" tag is an ordinary key', () => {
    const weird = ended({ tags: tags({ app: '__proto__', repo: 'constructor' }) });
    const t = rollUp([], [weird], [weird])[0]!;
    expect(tagOf(t.tags!.apps, '__proto__')!.ended).toBe(1);
    expect(tagOf(t.tags!.repos, 'constructor')!.ended).toBe(1);
    expect(tagOf(t.tags!.apps, 'toString')).toBeUndefined();
    expect(readTally(JSON.parse(JSON.stringify(t)))).not.toBeNull();
  });

  it('fitRollups drops the tags of the biggest rollup before any sample, and marks it tagsLost; later prunes do not rebuild it', () => {
    const big = emptyTally('coder', 1);
    big.tags = { skills: {}, apps: {}, repos: {} };
    const one = rollUp([], [ended()], [])[0]!.tags!.skills.review!;
    for (let i = 0; i < 6000; i++) big.tags.repos[`repo-${i}`] = structuredClone(one);
    big.cost = { n: 3, values: [1, 2, 3] };
    const small = rollUp([], [ended({ agentId: 'other' })], [])[0]!;
    const fit = fitRollups([big, small]);
    expect(Buffer.byteLength(JSON.stringify(fit, null, 2), 'utf8')).toBeLessThanOrEqual(ROLLUP_BYTES);
    const fat = fit.find(t => t.agentId === 'coder')!;
    expect(fat.tags).toBeUndefined();
    expect(fat.tagsLost).toBe(true);
    expect(fat.cost.values).toEqual([1, 2, 3]);
    expect(fit.find(t => t.agentId === 'other')!.tags).toBeDefined();
    const after = rollUp(fit, [ended()], []).find(t => t.agentId === 'coder')!;
    expect(after.tags).toBeUndefined();
    expect(after.ended).toBe(1);
  });

  it('the store prunes a tagged run into the per-tag counts', () => {
    const dir = tmp(), s = new AgentRunStore(dir);
    const old = s.start(start({ tags: tags({ skills: ['ship'] }) }), false);
    endRun(old, 'completed', 1);
    for (let i = 0; i < RUNS_MAX; i++) endRun(s.start(start({ agentId: 'filler', tags: undefined }), false), 'closed', 1000 + i);
    s.save();
    const coder = new AgentRunStore(dir).rolledUp().find(t => t.agentId === 'coder')!;
    expect(coder.tags!.skills.ship!.ended).toBe(1);
  });
});

describe('metric filters', () => {
  let n = 0;
  const run = (o: Partial<AgentRun> = {}): AgentRun => ({ runId: `r_${(++n).toString(16).padStart(12, '0')}`, chatId: 'c', agentId: 'coder', version: 1, goal: 'g', startedBy: 'user', startedAt: 10, endedAt: 20, endReason: 'completed',
    counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: 0, tokens: null, tags: tags(), ...o });
  const ended = (m: ReturnType<typeof runMetrics>) => m.find(x => x.agentId === 'coder')?.versions[0]?.ended ?? 0;

  it('an untagged run never matches a filter; no filter matches every run', () => {
    expect(matchesTags(run({ tags: undefined }), {})).toBe(true);
    expect(matchesTags(run({ tags: undefined }), { repo: 'second-brain' })).toBe(false);
    expect(matchesTags(run(), { skill: 'review', app: 'crm', repo: 'second-brain' })).toBe(true);
    expect(matchesTags(run(), { skill: 'review', app: 'other' })).toBe(false);
  });

  it('filters runs and open runs with exact counts for combined tags after pruning', () => {
    const pruned = run({ tags: tags({ skills: ['deploy'] }) });
    const rollups: RunTally[] = rollUp([], [pruned], [pruned]);
    const live = [run(), run({ tags: undefined }), run({ tags: tags({ app: 'shop' }) }), run({ endedAt: undefined, endReason: undefined })];
    expect(ended(runMetrics(live, { rollups }))).toBe(4);
    expect(ended(runMetrics(live, { rollups, filter: { app: 'crm' } }))).toBe(2); // 1 live + the pruned one
    expect(ended(runMetrics(live, { rollups, filter: { skill: 'deploy' } }))).toBe(1);
    expect(runMetrics(live, { rollups, filter: { skill: 'deploy' } })[0]!.versions[0]!.costPerRun.median.n).toBe(0); // counts only
    expect(ended(runMetrics(live, { rollups, filter: { app: 'crm', repo: 'second-brain' } }))).toBe(2);
    expect(ended(runMetrics(live, { rollups, filter: { skill: 'deploy', app: 'crm', repo: 'second-brain' } }))).toBe(1);
    expect(ended(runMetrics(live, { rollups, filter: { skill: 'deploy', app: 'shop' } }))).toBe(0);
    expect(runMetrics(live, { rollups, filter: { app: 'crm' } })[0]!.open).toBe(1);
    expect(runMetrics(live, { rollups, filter: { app: 'shop' } })[0]!.open).toBe(0);
    expect(runMetrics(live, { rollups, filter: { repo: 'nowhere' } })).toEqual([]);
    const lost = fitRollups(rollups).map(t => ({ ...t, tags: undefined, tagsLost: true as const }));
    expect(ended(runMetrics([], { rollups: lost, filter: { skill: 'deploy' } }))).toBe(0);
  });
});
