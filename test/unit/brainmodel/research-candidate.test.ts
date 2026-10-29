// The candidate brain (ADR 0195, brainmodel/research-candidate.ts and its hooks in research.ts): a research's brain-file
// findings are held, gathered into one candidate when it ends (a copy under userData, the brain untouched), shown as
// one Proposte card with a diff per file, replayed only when the budget left covers it, and applied as ONE change whose
// one rollback restores every file; a brain edited in between makes it stale; role changes and app issues stay cards.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrainModelState } from '../../../src/shared/brain-model';
import type { ChatSummary } from '../../../src/shared/contract';
import type { ResearchProposal } from '../../../src/shared/maintenance-research';
import { ChangeLog } from '../../../src/main/brainmodel/changes';
import { readRules, readSkills } from '../../../src/main/brainmodel/model';
import { ResearchService, type ResearchDeps } from '../../../src/main/brainmodel/research';
import { candidateChecks, isCandidateFinding, planCandidate, replayEstimate, type CandidatePorts } from '../../../src/main/brainmodel/research-candidate';
import { SOURCES, type ProposalPorts } from '../../../src/main/proposals/sources';
import type { AgentRun } from '../../../src/shared/agents';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-cand-'))); dirs.push(d); return d; };
const NOW = Date.parse('2026-10-29T10:00:00Z');

/** A brain with one skill, one rules/ file and the lessons file. */
function brain(): string {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude', 'skills', 'deploy-notes'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'deploy-notes', 'SKILL.md'), '---\nname: deploy-notes\ndescription: How to write deploy notes\n---\n\nWrite by area.\n');
  fs.mkdirSync(path.join(root, 'rules'));
  fs.writeFileSync(path.join(root, 'rules', 'old-proxy.md'), '# Old proxy\n\nUse proxy-1.\n');
  fs.writeFileSync(path.join(root, 'rules', 'lessons.md'), '# Lessons\n\nRules from corrections.\n');
  return root;
}
const snapshot = (root: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else out[path.relative(root, f)] = fs.readFileSync(f, 'utf8'); } };
  walk(root);
  return out;
};
const ports = (root: string, userData: string, over: Partial<CandidatePorts> = {}): CandidatePorts & { log: ChangeLog } => {
  const log = new ChangeLog(userData, () => NOW);
  return {
    log,
    input: () => ({ root, skills: readSkills([{ dir: path.join(root, '.claude', 'skills'), home: 'brain' }], root, []), rules: readRules(root) }),
    apply: (meta, writes) => { const c = log.apply({ job: 'research', kind: meta.kind, action: 'update', target: meta.target, summary: meta.summary, reason: meta.reason, evidence: meta.evidence }, writes); if (!c) throw new Error('nothing'); return c.id; },
    ...over,
  };
};
const p = (id: string, x: Partial<ResearchProposal>): ResearchProposal => ({ id, chatId: 'c1', at: NOW, title: id, adds: 'a', removes: '', why: 'w', evidence: [], sources: [], expected: '', risk: '', state: 'open', kind: 'rule', ...x });

describe('isCandidateFinding / planCandidate', () => {
  it('takes brain-file findings only: not a role change, a skill for a role, an issue or the cleanup\'s cards', () => {
    expect(isCandidateFinding(p('a', { kind: 'rule', change: { target: 'rule', text: 'x' } }))).toBe(true);
    expect(isCandidateFinding(p('b', { kind: 'skill', change: { target: 'skill', name: 's', text: 'x' } }))).toBe(true);
    expect(isCandidateFinding(p('c', { kind: 'forget', forget: { what: 'rule', name: 'rules/x.md' } }))).toBe(true);
    expect(isCandidateFinding(p('d', { kind: 'rule', change: { target: 'rule', role: 'artisan', text: 'x' } }))).toBe(false);
    expect(isCandidateFinding(p('e', { kind: 'skill', change: { target: 'skill', name: 's', role: 'scout', text: 'x' } }))).toBe(false);
    expect(isCandidateFinding(p('f', { kind: 'role', change: { target: 'role', role: 'scout', text: 'x' } }))).toBe(false);
    expect(isCandidateFinding(p('g', { kind: 'app-bug', issue: { title: 't', body: 'b' } }))).toBe(false);
    expect(isCandidateFinding(p('h', { chatId: null, kind: 'forget', forget: { what: 'skill', name: 'x' } }))).toBe(false);
  });

  it('plans every finding on a virtual copy: two rules in one file, a skill section, a forgotten rule; the brain is not written', () => {
    const root = brain(), before = snapshot(root);
    const input = { root, skills: readSkills([{ dir: path.join(root, '.claude', 'skills'), home: 'brain' }], root, []), rules: readRules(root), now: NOW };
    const plan = planCandidate(input, [
      p('r1', { change: { target: 'rule', text: 'Staging is stg-eu.' } }),
      p('r2', { change: { target: 'rule', text: 'Run the tests before reporting done.' } }),
      p('s1', { kind: 'skill', change: { target: 'skill', name: 'deploy-notes', text: 'Never name branches.' } }),
      p('s2', { kind: 'skill', title: 'Release checklist', change: { target: 'skill', name: 'release-checklist', text: 'Check the changelog.' } }),
      p('f1', { kind: 'forget', forget: { what: 'rule', name: 'rules/old-proxy.md' } }),
      p('bad', { kind: 'forget', forget: { what: 'rule', name: 'rules/missing.md' } }),
    ]);
    expect(plan.used).toEqual(['r1', 'r2', 's1', 's2', 'f1']);
    expect(plan.skipped.map(x => x.id)).toEqual(['bad']);
    const byRel = Object.fromEntries(plan.files.map(f => [f.rel, f]));
    expect(byRel['rules/lessons.md']!.after).toContain('Staging is stg-eu.');
    expect(byRel['rules/lessons.md']!.after).toContain('Run the tests before reporting done.');
    expect(byRel['.claude/skills/deploy-notes/SKILL.md']!.after).toContain('## Dalla manutenzione');
    expect(byRel['.claude/skills/release-checklist/SKILL.md']!.before).toBeNull();
    expect(byRel['rules/old-proxy.md']!.after).toBeNull();
    expect(snapshot(root)).toEqual(before);
    const checks = candidateChecks(plan.files, input.rules, 'it');
    // brain.json lists the lessons file as a topic, as a single approval does
    expect(checks[0]).toMatch(/^5 file: 2 nuovi, 1 tolti/);
    expect(checks.join(' ')).toMatch(/nome e descrizione validi/);
  });

  it('estimates a replay from the median cost of recent runs', () => {
    const run = (cost: number | null, ago: number) => ({ runId: `r${cost}`, agentId: 'scout', startedAt: NOW - ago, endedAt: NOW - ago + 1, costUsd: cost }) as unknown as AgentRun;
    expect(replayEstimate(3, [run(0.1, 1000), run(0.3, 1000), run(0.2, 1000), run(9, 60 * 86_400_000)], NOW)).toBe(1.2);
    expect(replayEstimate(3, [run(null, 1000)], NOW)).toBeNull();
  });
});

const state = (): BrainModelState => ({ root: '/brain', agents: [], skills: [], rules: [], memory: [], changes: [], migration: null, lastRun: null });
function research(root: string, over: Partial<CandidatePorts> = {}) {
  const userData = tmp(), chats = new Map<string, ChatSummary>(), applied: string[] = [];
  let ended = 0;
  const cp = ports(root, userData, over);
  const deps: ResearchDeps = {
    userData, lang: () => 'it', root: () => root, appVersion: () => '0.1.0', issuesUrl: () => 'https://github.com/lampi1/second-brain/issues',
    engines: () => [{ harness: 'claude', label: 'Claude', effort: true, web: true }] as ReturnType<ResearchDeps['engines']>, bestModel: () => 'opus', runs: () => [], roles: () => [],
    brain: { state, apply: x => { applied.push(x.id); return `chg-${applied.length}`; }, noise: () => {}, maintain: async () => state() },
    chats: { create: async () => { const c = { id: `c${chats.size + 1}`, state: 'starting', costUsd: 0 } as ChatSummary; chats.set(c.id, c); return c; }, get: id => chats.get(id), stop: async () => {} },
    changed: vi.fn(), now: () => NOW, privacy: { home: '/home/user', user: 'mario' }, candidates: cp, done: () => { ended++; },
  };
  return { svc: new ResearchService(deps), cp, applied, userData, ended: () => ended };
}
const opts = { harness: 'claude' as const, model: 'opus', effort: 'high' as const, web: true, capUsd: 5, prompt: 'Studia il brain.' };
const end = async (t: ReturnType<typeof research>, cost = 1) => {
  t.svc.chatUpdated({ id: 'c1', state: 'running', costUsd: cost } as ChatSummary);
  t.svc.chatUpdated({ id: 'c1', state: 'idle', costUsd: cost } as ChatSummary);
  await vi.waitFor(() => expect(t.ended()).toBe(1));
};

describe('ResearchService with the candidate brain', () => {
  it('holds brain-file findings, builds ONE candidate card at the end, applies it as one change and one undo restores every file', async () => {
    const root = brain(), before = snapshot(root);
    const replay = vi.fn(() => ({ note: 'Replay saltato: nessun set.' }));
    const t = research(root, { replay });
    await t.svc.start(opts);
    t.svc.propose('c1', { kind: 'rule', title: 'Staging is stg-eu', adds: 'A line.', why: 'Scout looked for staging-1 3 times.', change: { text: 'Staging is stg-eu.' } });
    t.svc.propose('c1', { kind: 'skill', title: 'Deploy notes by area', adds: 'A section.', why: '3 corrections.', change: { name: 'deploy-notes', text: 'Never name branches.' } });
    t.svc.propose('c1', { kind: 'forget', title: 'Forget the old proxy rule', removes: 'rules/old-proxy.md', why: 'Unused.', forget: { what: 'rule', name: 'rules/old-proxy.md' } });
    t.svc.propose('c1', { kind: 'role', title: 'Artisan tests first', adds: 'A line.', why: '4 corrections.', change: { role: 'artisan', text: 'Run the tests.' } });
    t.svc.propose('c1', { kind: 'app-idea', title: 'Search in Log', adds: 'A box.', why: '12 runs.', issue: { title: 'Log: search', body: 'Body' } });
    // while it runs: the held findings are no cards; the role change and the issue are
    expect(t.svc.cards().map(x => x.kind).sort()).toEqual(['app-idea', 'role']);
    await end(t, 1.5);
    const [c] = t.svc.candidateCards();
    expect(c).toBeDefined();
    expect(c!.items.map(x => x.title)).toEqual(['Staging is stg-eu', 'Deploy notes by area', 'Forget the old proxy rule']);
    expect(c!.files.map(f => f.rel).sort()).toEqual(['.claude/skills/deploy-notes/SKILL.md', 'brain.json', 'rules/lessons.md', 'rules/old-proxy.md']);
    // the replay is asked with what is left of the cap, and its note is on the card
    expect(replay).toHaveBeenCalledWith(expect.objectContaining({ name: c!.id, budgetUsd: 3.5 }));
    expect(c!.evaluation.replay).toMatchObject({ state: 'skipped', note: 'Replay saltato: nessun set.' });
    // the input is untouched; the candidate is a copy under userData
    expect(snapshot(root)).toEqual(before);
    const copy = path.join(t.userData, 'brain-candidates', c!.id, 'files', 'rules', 'lessons.md');
    expect(fs.readFileSync(copy, 'utf8')).toContain('Staging is stg-eu.');
    expect(fs.existsSync(path.join(t.userData, 'brain-candidates', c!.id, 'files', 'rules', 'old-proxy.md'))).toBe(false);

    // the Proposte card: one, with a diff per file
    const src = SOURCES.find(s => s.id === 'research')!;
    const portsP = { now: () => NOW, runs: () => [], chats: () => [], reviewed: { has: () => false, mark: () => {} },
      research: { list: () => t.svc.cards(), approve: (id: string) => t.svc.approve(id), reject: (id: string) => t.svc.reject(id), repo: () => t.svc.repo(), candidates: () => t.svc.candidateCards() } } as ProposalPorts;
    const deck = await src.list(portsP);
    const card = deck.find(x => x.group === 'brain')!;
    expect(card.ask).toMatchObject({ kind: 'candidate', files: 4, items: [{ finding: 'rule' }, { finding: 'skill' }, { finding: 'forget' }] });
    expect(card.diffs).toHaveLength(4);
    expect(deck.filter(x => x.group === 'brain')).toHaveLength(1);

    const changeId = await t.svc.approve(c!.id);
    expect(fs.readFileSync(path.join(root, 'rules', 'lessons.md'), 'utf8')).toContain('Staging is stg-eu.');
    expect(fs.existsSync(path.join(root, 'rules', 'old-proxy.md'))).toBe(false);
    expect(t.cp.log.all()).toHaveLength(1);
    expect(t.cp.log.all()[0]!.files).toHaveLength(4);
    expect(t.svc.store.all().filter(x => x.candidateId === c!.id).every(x => x.state === 'approved' && x.changeId === changeId)).toBe(true);
    expect(t.svc.candidateCards()).toHaveLength(0);
    // one undo restores every file
    t.cp.log.rollback(changeId, { activeVersion: () => null, restore: () => {} });
    expect(snapshot(root)).toEqual(before);
  });

  it('a brain edited after the candidate: approval refused, the findings become their own cards again', async () => {
    const root = brain();
    const t = research(root);
    await t.svc.start(opts);
    t.svc.propose('c1', { kind: 'rule', title: 'Staging is stg-eu', adds: 'A line.', why: 'w', change: { text: 'Staging is stg-eu.' } });
    await end(t);
    const [c] = t.svc.candidateCards();
    fs.appendFileSync(path.join(root, 'rules', 'lessons.md'), '- my own line\n');
    await expect(t.svc.approve(c!.id)).rejects.toThrow(/cambiato/);
    expect(fs.readFileSync(path.join(root, 'rules', 'lessons.md'), 'utf8')).not.toContain('stg-eu');
    expect(t.svc.candidateCards()).toHaveLength(0);
    expect(t.svc.cards().map(x => x.title)).toEqual(['Staging is stg-eu']);
  });

  it('rejecting discards the candidate and its findings; a capped research skips the replay', async () => {
    const root = brain(), before = snapshot(root);
    const replay = vi.fn(() => ({ replayId: 'x', note: 'started' }));
    const t = research(root, { replay });
    await t.svc.start(opts);
    t.svc.propose('c1', { kind: 'rule', title: 'Staging is stg-eu', adds: 'A line.', why: 'w', change: { text: 'Staging is stg-eu.' } });
    t.svc.chatUpdated({ id: 'c1', state: 'running', costUsd: 5.2 } as ChatSummary);
    await vi.waitFor(() => expect(t.ended()).toBe(1));
    const [c] = t.svc.candidateCards();
    expect(replay).not.toHaveBeenCalled();
    expect(c!.evaluation.replay).toMatchObject({ state: 'skipped', note: expect.stringMatching(/budget/) });
    t.svc.reject(c!.id);
    expect(t.svc.candidateCards()).toHaveLength(0);
    expect(t.svc.store.all().every(x => x.state === 'rejected')).toBe(true);
    expect(snapshot(root)).toEqual(before);
  });
});
