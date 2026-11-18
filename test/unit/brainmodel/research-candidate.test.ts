// The candidate brain (ADR 0195, brainmodel/research-candidate.ts and its hooks in research.ts): a research's brain-file
// findings are held, gathered into one candidate when it ends (a copy under userData, the brain untouched), shown as
// one Proposte card with a diff per file, replayed only when the budget left covers it, and applied as ONE change whose
// one rollback restores every file; a brain edited in between makes it stale; role changes and app issues stay cards.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '../chats/helpers';
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

  it('plans every finding on a virtual copy: a skill section, a new skill, a forgotten rule; rules for every role are skipped (#366); the brain is not written', () => {
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
    expect(plan.used).toEqual(['s1', 's2', 'f1']);
    expect(plan.skipped.map(x => x.id)).toEqual(['r1', 'r2', 'bad']);
    expect(plan.skipped[0]!.why).toMatch(/non ci sono più/);
    const byRel = Object.fromEntries(plan.files.map(f => [f.rel, f]));
    expect(byRel['rules/lessons.md']).toBeUndefined();
    expect(byRel['.claude/skills/deploy-notes/SKILL.md']!.after).toContain('## Dalla manutenzione');
    expect(byRel['.agents/skills/release-checklist/SKILL.md']!.before).toBeNull();
    expect(byRel['rules/old-proxy.md']!.after).toBeNull();
    expect(snapshot(root)).toEqual(before);
    const checks = candidateChecks(plan.files, input.rules, 'it');
    expect(checks[0]).toMatch(/^3 file: 1 nuovi, 1 tolti/);
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
  await waitFor(() => t.ended() === 1, 'the run to end');
};

describe('one line of an always-loaded file (#435, ADR 0320)', () => {
  const AGENTS = '# Agents\n\n## Commits\n\n- Stage everything, then commit.\n- Message in English.\n\n## Safety\n\n- Ask before any deploy.\n';
  function fixed(): string {
    const root = brain();
    fs.writeFileSync(path.join(root, 'AGENTS.md'), AGENTS);
    fs.writeFileSync(path.join(root, 'brain.json'), JSON.stringify({ machinery: 'product-v1', rules: { fixedFiles: ['AGENTS.md'], fixedBudget: 300, topicFiles: [], appRules: true } }));
    return root;
  }
  const edit = { target: 'rule' as const, file: 'AGENTS.md', before: '- Stage everything, then commit.', text: '- Stage only the files you changed, then commit.' };

  it('the plan changes that line and nothing else; a safety line, another file or a line that is gone is left out', () => {
    const root = fixed(), before = snapshot(root);
    const input = { root, skills: [], rules: readRules(root), now: NOW };
    expect(input.rules.find(r => r.file === 'AGENTS.md')?.loaded).toBe('always');
    expect(isCandidateFinding(p('l1', { change: edit }))).toBe(true);
    const plan = planCandidate(input, [
      p('l1', { change: edit }),
      p('l2', { change: { ...edit, before: '- Ask before any deploy.', text: '- Deploy when the tests pass.' } }),
      p('l3', { change: { ...edit, file: 'rules/old-proxy.md', before: 'Use proxy-1.', text: 'Use proxy-2.' } }),
      p('l4', { change: { ...edit, before: '- A line nobody wrote.' } }),
    ]);
    expect(plan.used).toEqual(['l1']);
    expect(plan.skipped.map(x => x.id)).toEqual(['l2', 'l3', 'l4']);
    expect(plan.skipped[0]!.why).toMatch(/solo l'utente/);
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0]).toMatchObject({ rel: 'AGENTS.md', before: AGENTS, after: AGENTS.replace(edit.before, edit.text) });
    expect(snapshot(root)).toEqual(before);
    // the checks say the always-loaded lines did not grow
    expect(candidateChecks(plan.files, input.rules, 'en').some(l => /\+0 lines in rules loaded in every job/.test(l))).toBe(true);
  });

  it('two findings on one file both land, the second on the first; one that would pass the fixed budget is left out', () => {
    const root = fixed(), input = { root, skills: [], rules: readRules(root), now: NOW };
    const second = { ...edit, before: '- Message in English.', text: '- Message in English, conventional style.' };
    const plan = planCandidate(input, [
      p('l1', { change: edit }),
      p('l2', { change: second }),
      p('l3', { change: { ...edit, before: second.text, text: `- Message in English, ${'conventional '.repeat(20)}style.` } }),
    ]);
    expect(plan.used).toEqual(['l1', 'l2']);
    expect(plan.skipped).toEqual([{ id: 'l3', why: expect.stringMatching(/limite/) }]);
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0]!.after).toBe(AGENTS.replace(edit.before, edit.text).replace(second.before, second.text));
  });

  it('the research proposes it, the candidate shows the line, rejecting keeps the old line, approving changes it and one undo puts it back', async () => {
    const root = fixed(), before = snapshot(root);
    const withRules = (): BrainModelState => ({ ...state(), root, rules: readRules(root) });
    const make = () => { const t = research(root); (t.svc as unknown as { d: ResearchDeps }).d.brain.state = withRules; return t; };
    const finding = { kind: 'rule', title: 'Commit only your own files', adds: 'x', why: '3 runs committed other chats\' files.', evidence: ['run r1, r2, r3'], change: { file: edit.file, before: edit.before, text: edit.text } };
    const t = make();
    await t.svc.start(opts);
    // refused at once, in the tool's words: a safety line, a file that is not always loaded, a role with a file
    expect(() => t.svc.propose('c1', { ...finding, title: 'Deploy freely', change: { file: 'AGENTS.md', before: '- Ask before any deploy.', text: '- Deploy when ready.' } })).toThrow(/changed only by the user/);
    expect(() => t.svc.propose('c1', { ...finding, title: 'Other file', change: { file: 'rules/old-proxy.md', before: 'Use proxy-1.', text: 'Use proxy-2.' } })).toThrow(/loaded in every job \(AGENTS\.md\)/);
    expect(() => t.svc.propose('c1', { ...finding, title: 'With a role', change: { role: 'artisan', file: 'AGENTS.md', before: edit.before, text: edit.text } })).toThrow(/no role/);
    t.svc.propose('c1', finding);
    await end(t);
    const [c] = t.svc.candidateCards();
    expect(c!.files).toEqual([{ rel: 'AGENTS.md', before: AGENTS, after: AGENTS.replace(edit.before, edit.text) }]);
    // the finding's card text is the exact line before and after, written by the app
    expect(t.svc.store.all().find(x => x.title === finding.title)).toMatchObject({ removes: `AGENTS.md: ${edit.before}`, adds: edit.text });
    await t.svc.reject(c!.id);
    expect(snapshot(root)).toEqual(before);

    const t2 = make();
    await t2.svc.start(opts);
    t2.svc.propose('c1', { ...finding, title: 'Commit only the files you changed' });
    await end(t2);
    const [c2] = t2.svc.candidateCards();
    const changeId = await t2.svc.approve(c2!.id);
    expect(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')).toBe(AGENTS.replace(edit.before, edit.text));
    t2.cp.log.rollback(changeId, { activeVersion: () => null, restore: () => {} });
    expect(snapshot(root)).toEqual(before);
  });
});

describe('ResearchService with the candidate brain', () => {
  it('holds brain-file findings, builds ONE candidate card at the end, applies it as one change and one undo restores every file', async () => {
    const root = brain(), before = snapshot(root);
    const replay = vi.fn(() => ({ note: 'Replay saltato: nessun set.' }));
    const t = research(root, { replay });
    await t.svc.start(opts);
    t.svc.propose('c1', { kind: 'skill', title: 'Deploy notes by area', adds: 'A section.', why: '3 corrections.', change: { name: 'deploy-notes', text: 'Never name branches.' } });
    t.svc.propose('c1', { kind: 'forget', title: 'Forget the old proxy rule', removes: 'rules/old-proxy.md', why: 'Unused.', forget: { what: 'rule', name: 'rules/old-proxy.md' } });
    t.svc.propose('c1', { kind: 'role', title: 'Artisan tests first', adds: 'A line.', why: '4 corrections.', change: { role: 'artisan', text: 'Run the tests.' } });
    t.svc.propose('c1', { kind: 'app-idea', title: 'Search in Log', adds: 'A box.', why: '12 runs.', issue: { title: 'Log: search', body: 'Body' } });
    // while it runs: the held findings are no cards; the role change and the issue are
    expect(t.svc.cards().map(x => x.kind).sort()).toEqual(['app-idea', 'role']);
    await end(t, 1.5);
    const [c] = t.svc.candidateCards();
    expect(c).toBeDefined();
    expect(c!.items.map(x => x.title)).toEqual(['Deploy notes by area', 'Forget the old proxy rule']);
    expect(c!.files.map(f => f.rel).sort()).toEqual(['.claude/skills/deploy-notes/SKILL.md', 'rules/old-proxy.md']);
    // the replay is asked with what is left of the cap, and its note is on the card
    expect(replay).toHaveBeenCalledWith(expect.objectContaining({ name: c!.id, budgetUsd: 3.5 }));
    expect(c!.evaluation.replay).toMatchObject({ state: 'skipped', note: 'Replay saltato: nessun set.' });
    // the input is untouched; the candidate is a copy under userData
    expect(snapshot(root)).toEqual(before);
    const copy = path.join(t.userData, 'brain-candidates', c!.id, 'files', '.claude', 'skills', 'deploy-notes', 'SKILL.md');
    expect(fs.readFileSync(copy, 'utf8')).toContain('Never name branches.');
    expect(fs.existsSync(path.join(t.userData, 'brain-candidates', c!.id, 'files', 'rules', 'old-proxy.md'))).toBe(false);

    // the Proposte card: one, with a diff per file
    const src = SOURCES.find(s => s.id === 'research')!;
    const portsP = { now: () => NOW, runs: () => [], chats: () => [], reviewed: { has: () => false, mark: () => {} },
      research: { list: () => t.svc.cards(), approve: (id: string) => t.svc.approve(id), reject: (id: string) => t.svc.reject(id), repo: () => t.svc.repo(), candidates: () => t.svc.candidateCards() } } as ProposalPorts;
    const deck = await src.list(portsP);
    const card = deck.find(x => x.group === 'brain')!;
    expect(card.ask).toMatchObject({ kind: 'candidate', files: 2, items: [{ finding: 'skill' }, { finding: 'forget' }] });
    expect(card.diffs).toHaveLength(2);
    expect(deck.filter(x => x.group === 'brain')).toHaveLength(1);

    const changeId = await t.svc.approve(c!.id);
    expect(fs.readFileSync(path.join(root, '.claude', 'skills', 'deploy-notes', 'SKILL.md'), 'utf8')).toContain('Never name branches.');
    expect(fs.existsSync(path.join(root, 'rules', 'old-proxy.md'))).toBe(false);
    expect(t.cp.log.all()).toHaveLength(1);
    expect(t.cp.log.all()[0]!.files).toHaveLength(2);
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
    t.svc.propose('c1', { kind: 'skill', title: 'Staging is stg-eu', adds: 'A section.', why: 'w', change: { name: 'deploy-notes', text: 'Staging is stg-eu.' } });
    await end(t);
    const [c] = t.svc.candidateCards();
    const skill = path.join(root, '.claude', 'skills', 'deploy-notes', 'SKILL.md');
    fs.appendFileSync(skill, '- my own line\n');
    await expect(t.svc.approve(c!.id)).rejects.toThrow(/cambiato/);
    expect(fs.readFileSync(skill, 'utf8')).not.toContain('stg-eu');
    expect(t.svc.candidateCards()).toHaveLength(0);
    expect(t.svc.cards().map(x => x.title)).toEqual(['Staging is stg-eu']);
  });
});
