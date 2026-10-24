// The Proposte deck's main side (ADR 0123): the sources merged newest first with who / where / when, each decision on its
// source's own path, the recheck before a decision (gone, blocked side, one at a time), the Tieni marks kept in userData,
// what the applied-changes source leaves out, and the count event. Memory facts have no source since ADR 0149 (the
// maintenance saves them itself): the generic checks run on the other sources.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn() }, errText: (e: unknown) => String(e instanceof Error ? e.message : e) }));
import { ProposalsService } from '../../../src/main/proposals/service';
import { CHANGE_WINDOW_MS, SOURCES, type ProposalPorts } from '../../../src/main/proposals/sources';
import type { SkillCandidateView } from '../../../src/shared/learning-review';
import type { ApprovalItem } from '../../../src/shared/pulse';
import type { BrainChange } from '../../../src/shared/brain-model';

const NOW = Date.parse('2026-10-20T10:00:00Z');
const H = 3_600_000;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-proposals-'));
const rule = (id: string, at: number): ApprovalItem => ({ id, kind: 'learned-rule', agentId: 'scout', title: `Regola ${id}`, text: `testo ${id}`, evidence: [`card-${id}`], engine: null, createdAt: at, state: 'pending' });
const change = (id: string, at: number, x: Partial<BrainChange> = {}): BrainChange => ({ id, at, job: 'corrections', kind: 'rule', action: 'merge', target: 'rules/test.md', summary: `Cambio ${id}`, reason: 'doppioni', evidence: ['r_1'], canRollback: true, ...x } as BrainChange);
const candidate = (x: Partial<SkillCandidateView> = {}): SkillCandidateView => ({ name: 'triage', text: '## Steps\n1. a\n2. b', digest: 'abcdef0123456789', stepsReady: true, sourceRunIds: ['r_000000000002'], verifiedExampleRunIds: ['r_000000000002'], eligibleReplayIds: ['rep-1'], promotionProblems: [], promoted: false, ...x });

function ports(over: Partial<Omit<ProposalPorts, 'reviewed'>> = {}) {
  const calls: string[] = [];
  let rules = [rule('a', NOW - 2 * H), rule('b', NOW - 5 * H)];
  let changes: BrainChange[] = [change('c1', NOW - 1 * H)];
  let settings = [{ id: 's1', key: 'pulse.dailyUsd', label: 'Budget del Battito', before: 0.2, after: 0.4, reason: 'più controlli', chatId: 'orc', at: NOW - 30 * 60_000 }];
  const p: Omit<ProposalPorts, 'reviewed'> = {
    now: () => NOW,
    runs: () => [{ runId: 'r_000000000004', agentId: 'scout', chatId: 'feedback', goal: 'Studia il modulo', startedAt: NOW - 3 * H, report: { summary: 'Il modulo invia due volte' } }] as never,
    chats: () => [{ id: 'feedback', title: 'App · Feedback' }, { id: 'orc', title: 'Orchestratore', isOrchestrator: true }, { id: 'x', title: 'Altra', run: { runId: 'r_000000000001', agentId: 'sentinel', chatId: 'x' } }] as never,
    pulse: { list: () => rules, decide: async (id, d) => { calls.push(`${d} ${id}`); rules = rules.filter(r => r.id !== id); return { ok: true }; } },
    changes: {
      list: () => changes, stored: () => changes.map(c => ({ ...c, files: [] })) as never,
      rollback: id => { calls.push(`rollback ${id}`); changes = changes.map(c => (c.id === id ? { ...c, rolledBackAt: NOW } : c)); },
    },
    settings: { pending: () => settings as never, confirm: (id, ok) => { calls.push(`setting ${id} ${ok}`); settings = settings.filter(s => s.id !== id); } },
    ...over,
  };
  return { p, calls };
}

describe('ProposalsService', () => {
  it('merges the sources newest first, with who / where / when resolved from runs and chats', async () => {
    const { p } = ports();
    const s = new ProposalsService({ ports: p, userData: tmp() });
    const { items, problems } = await s.list();
    expect(problems).toEqual([]);
    expect(items.map(c => c.id)).toEqual(['setting:s1', 'change:c1', 'pulse:a', 'pulse:b']);
    expect(items.find(c => c.id === 'setting:s1')!.provenance).toMatchObject({ who: { kind: 'role', id: 'orchestrator' }, chat: { id: 'orc' } });
    expect(items.find(c => c.id === 'change:c1')).toMatchObject({ applied: true, group: 'rule', provenance: { who: { kind: 'maintenance', id: 'corrections' } } });
    expect(items.find(c => c.id === 'pulse:a')).toMatchObject({ group: 'rule', provenance: { at: new Date(NOW - 2 * H).toISOString(), evidence: ['card-a'] } });
    // the run behind a card: from the run store, or known only from a chat's mirror
    const runs = ports({ candidates: { list: () => [candidate({ name: 'uno', sourceRunIds: ['r_000000000004'] }), candidate({ name: 'due', sourceRunIds: ['r_000000000001'] })], promote: () => {} } });
    const more = (await new ProposalsService({ ports: runs.p, userData: tmp() }).list()).items;
    expect(more.find(c => c.id === 'candidate:uno')!.provenance).toMatchObject({ who: { kind: 'role', id: 'scout' }, chat: { id: 'feedback', title: 'App · Feedback' }, runId: 'r_000000000004' });
    expect(more.find(c => c.id === 'candidate:due')!.provenance).toMatchObject({ who: { kind: 'role', id: 'sentinel' }, chat: { id: 'x' } });
  });

  it('memory facts are no cards any more (ADR 0149): no memory source, even with facts waiting', async () => {
    expect(SOURCES.map(x => x.id)).not.toContain('memory');
    const { items } = await new ProposalsService({ ports: ports().p, userData: tmp() }).list();
    expect(items.filter(c => c.source === 'memory')).toEqual([]);
    expect(await new ProposalsService({ ports: ports().p, userData: tmp() }).decide({ id: 'memory:a', decision: 'approve' })).toMatchObject({ ok: false, error: 'Fonte della proposta non disponibile.' });
  });

  it('decides each card through its source', async () => {
    const { p, calls } = ports();
    const s = new ProposalsService({ ports: p, userData: tmp() });
    expect((await s.decide({ id: 'pulse:a', decision: 'approve' })).ok).toBe(true);
    expect((await s.decide({ id: 'pulse:b', decision: 'reject', note: 'non vale più' })).ok).toBe(true);
    expect((await s.decide({ id: 'setting:s1', decision: 'approve' })).ok).toBe(true);
    const last = await s.decide({ id: 'change:c1', decision: 'reject' });
    expect(calls).toEqual(['approve a', 'discard b', 'setting s1 true', 'rollback c1']);
    expect(last).toMatchObject({ ok: true, state: { items: [] } });
  });

  it('rechecks before deciding: a gone card, a blocked side, a bad request and two decisions at once are refused', async () => {
    const { p, calls } = ports();
    const s = new ProposalsService({ ports: p, userData: tmp() });
    expect(await s.decide({ id: 'pulse:zzz', decision: 'approve' })).toMatchObject({ ok: false, error: expect.stringContaining('non è più da decidere') });
    expect(await s.decide({ id: 'pulse:a', decision: 'maybe' as never })).toMatchObject({ ok: false });
    expect(await s.decide({ id: 'nope:a', decision: 'approve' })).toMatchObject({ ok: false });
    // a change that cannot roll back any more: Annulla is refused, Tieni still works
    const blocked = ports({ changes: { list: () => [change('c2', NOW - H, { canRollback: false })], stored: () => [], rollback: () => { throw new Error('no'); } } });
    const b = new ProposalsService({ ports: blocked.p, userData: tmp() });
    expect((await b.list()).items.find(c => c.id === 'change:c2')).toMatchObject({ canReject: false, blocked: ['changed-since'] });
    expect(await b.decide({ id: 'change:c2', decision: 'reject' })).toMatchObject({ ok: false, error: expect.stringContaining('non è più possibile') });
    // one decision at a time on the same card
    const [one, two] = await Promise.all([s.decide({ id: 'pulse:a', decision: 'approve' }), s.decide({ id: 'pulse:a', decision: 'approve' })]);
    expect([one.ok, two.ok].sort()).toEqual([false, true]);
    expect(calls.filter(c => c === 'approve a')).toHaveLength(1);
    // a source that throws: the card stays, the reason comes back
    const failing = ports({ settings: { pending: () => [{ id: 's9', key: 'k', label: 'L', before: 1, after: 2, at: NOW }] as never, confirm: () => { throw new Error('Impostazione protetta'); } } });
    const f = new ProposalsService({ ports: failing.p, userData: tmp() });
    const r = await f.decide({ id: 'setting:s9', decision: 'approve' });
    expect(r).toMatchObject({ ok: false, error: 'Impostazione protetta' });
    expect(r.state.items.map(c => c.id)).toContain('setting:s9');
  });

  it('keeps the Tieni marks in userData across restarts', async () => {
    const dir = tmp(), { p, calls } = ports();
    const s = new ProposalsService({ ports: p, userData: dir });
    expect((await s.decide({ id: 'change:c1', decision: 'approve' })).ok).toBe(true);
    expect(calls).toEqual([]); // Tieni changes nothing in the brain
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'proposals-reviewed.json'), 'utf8')).marks).toHaveProperty('c1');
    const again = new ProposalsService({ ports: ports().p, userData: dir });
    expect((await again.list()).items.map(c => c.id)).not.toContain('change:c1');
  });

  it('leaves out format jobs, changes older than 14 days, rolled back ones and the candidate files', async () => {
    const list = [
      change('fresh', NOW - H), change('old', NOW - CHANGE_WINDOW_MS - 1), change('mig', NOW - H, { job: 'migration' }), change('usr', NOW - H, { job: 'user' }),
      change('back', NOW - H, { rolledBackAt: NOW - 1 }), change('cand', NOW - H, { job: 'repeated-task', kind: 'skill', action: 'create', target: 'triage' }),
    ];
    const stored = list.map(c => ({ ...c, files: c.id === 'cand' ? [{ file: '/brain/memory/skill-candidates/triage.md' }] : [] }));
    const { p } = ports({ changes: { list: () => list, stored: () => stored as never, rollback: () => {} }, candidates: { list: () => [candidate()], promote: () => {} } });
    const ids = (await new ProposalsService({ ports: p, userData: tmp() }).list()).items.map(c => c.id);
    expect(ids.filter(id => id.startsWith('change:'))).toEqual(['change:fresh']);
    expect(ids).toContain('candidate:triage');
  });

  it('a skill candidate: promotion with its first replay and example, Rifiuta rolls back the change that wrote it', async () => {
    const calls: string[] = [];
    const origin = change('orig', NOW - H, { job: 'repeated-task', kind: 'skill', action: 'create', target: 'triage' });
    const { p } = ports({
      candidates: { list: () => [candidate()], promote: (...a) => { calls.push(`promote ${a.join(' ')}`); } },
      changes: { list: () => [origin], stored: () => [{ ...origin, files: [{ file: '/brain/memory/skill-candidates/triage.md' }] }] as never, rollback: id => { calls.push(`rollback ${id}`); } },
    });
    const s = new ProposalsService({ ports: p, userData: tmp(), root: () => '/brain' });
    const c = (await s.list()).items.find(x => x.id === 'candidate:triage')!;
    expect(c).toMatchObject({ group: 'skill', readFirst: true, canApprove: true, canReject: true, provenance: { files: ['memory/skill-candidates/triage.md'] } });
    await s.decide({ id: 'candidate:triage', decision: 'approve' });
    await s.decide({ id: 'candidate:triage', decision: 'reject' });
    expect(calls).toEqual(['promote triage abcdef0123456789 rep-1 r_000000000002', 'rollback orig']);
    // not ready and nothing to roll back: no card at all
    const none = ports({ candidates: { list: () => [candidate({ eligibleReplayIds: [] })], promote: () => {} }, changes: { list: () => [], stored: () => [], rollback: () => {} } });
    expect((await new ProposalsService({ ports: none.p, userData: tmp() }).list()).items.map(x => x.id)).not.toContain('candidate:triage');
  });

  it('a source that fails is reported, the others still show', async () => {
    const { p } = ports({ pulse: { list: () => { throw new Error('disco'); }, decide: async () => ({ ok: true }) } });
    const st = await new ProposalsService({ ports: p, userData: tmp() }).list();
    expect(st.problems).toEqual(['pulse']);
    expect(st.items.map(c => c.id)).toEqual(['setting:s1', 'change:c1']);
  });

  it('emits the count only when it changes', async () => {
    const emit = vi.fn(), { p } = ports();
    const s = new ProposalsService({ ports: p, userData: tmp(), emit });
    expect(await s.count()).toBe(4);
    await s.list();
    expect(emit.mock.calls).toEqual([[4]]);
    await s.decide({ id: 'pulse:a', decision: 'approve' });
    expect(emit.mock.calls).toEqual([[4], [3]]);
  });

  it('a change to a script or a query shows its code and words its question from data', async () => {
    const list = [change('s1', NOW - H, { job: 'repeated-task', kind: 'script', action: 'create', target: 'scripts/conta.mjs' }), change('q1', NOW - 2 * H, { job: 'corrections', kind: 'script', action: 'update', target: 'queries/errori.md' })];
    const stored = [{ ...list[0], files: [{ file: '/brain/scripts/conta.mjs', before: null, after: 'console.log(1);\n' }] }, { ...list[1], files: [{ file: 'C:\\brain\\queries\\errori.md', before: 'x', after: '# Errori\r\n\r\n```kql\r\nlogs | where status == 500\r\n```\r\n' }] }];
    const { p } = ports({ changes: { list: () => list, stored: () => stored as never, rollback: () => {} } });
    const items = (await new ProposalsService({ ports: p, userData: tmp() }).list()).items;
    expect(items.find(c => c.id === 'change:s1')).toMatchObject({ group: 'script', ask: { kind: 'applied', what: 'script', action: 'create', name: 'conta.mjs' }, code: [{ file: 'scripts/conta.mjs', lang: 'javascript', text: 'console.log(1);\n' }] });
    expect(items.find(c => c.id === 'change:q1')).toMatchObject({ group: 'script', ask: { what: 'query', name: 'errori' }, code: [{ file: 'queries/errori.md', lang: 'kql', text: 'logs | where status == 500' }] });
  });
});
