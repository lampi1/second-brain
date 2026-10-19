// The "Da approvare" inbox: it gathers every pending agent change from the existing channels, maps each click to its
// one channel (with the right undo), and renders cards as text without deciding anything on render.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AgentCatalog, AgentProfile, VersionMetrics } from '../../src/shared/agents';
import type { AgentProposal } from '../../src/shared/agent-authoring';
import type { AgentLifecycleSnapshot } from '../../src/shared/agent-lifecycle';
import type { ClassifierCalibration } from '../../src/shared/agent-classifier';
import { decideApproval, diffDefinition, gatherApprovals, lineDiff, lifecycleTarget, type ApprovalItem, type ApprovalsClient } from '../../src/renderer/lib/agent-approvals';
import { AgentApprovalsView } from '../../src/renderer/components/AgentApprovalCards';

const agent = (id: string, extra: Partial<AgentProfile> = {}): AgentProfile => ({
  id, name: `Agente ${id}`, purpose: 'Scopo', instructions: 'riga uno\nriga due', engine: 'claude', model: null, avatar: { kind: 'symbol', value: 'eye' },
  role: 'Ruolo', category: 'development', tools: null, permissionCeiling: null, origin: { kind: 'user' }, version: 2, activeVersion: 2,
  createdAt: 1, updatedAt: 100, lastEditedBy: 'user', userLocked: false, status: 'active', ...extra,
} as AgentProfile);
const metric = (value: number | null, n = 3) => ({ value, n, coverage: n ? 0.75 : null });
const vm = (agentId: string, version: number, success: number): VersionMetrics => ({
  agentId, version, legacy: false, ended: 4, successRate: metric(success), opinion: { value: null, n: 0 }, selfReport: { value: null, n: 0 },
  correctionsPerRun: metric(1), aiErrorsPerRun: metric(0), reworkRate: metric(0), costPerRun: { median: metric(0.42), p90: null },
  tokensPerRun: {} as VersionMetrics['tokensPerRun'], contextPeak: { median: metric(null, 0), max: null, ofWindow: null },
  timeToDone: { elapsed: metric(180_000), execution: metric(null, 0) }, questionsPerRun: metric(2), permissionsPerRun: metric(0), commandsPerRun: metric(0), reviews: [],
});

function fixture(over: { proposals?: AgentProposal[]; lifecycle?: Partial<AgentLifecycleSnapshot>; failLifecycle?: boolean; failProposals?: boolean; profiles?: AgentProfile[]; calibration?: ClassifierCalibration[] } = {}) {
  const profiles = over.profiles ?? [
    agent('writer'),
    agent('tester', { trial: { version: 3, baseline: 2, startedAt: 50 }, activeVersion: 3, version: 3 }),
    agent('imported', { probation: { since: 70, source: { kind: 'import', packId: 'imported-0123456789abcdef', revision: 1 } } }),
  ];
  const catalog = { profiles, archived: [], models: [], problem: null } as unknown as AgentCatalog;
  const calls: [string, unknown][] = [];
  const answers: Record<string, unknown> = {
    'agents:list': catalog, 'agents:proposals': over.proposals ?? [], 'agents:metrics': [{ agentId: 'tester', versions: [vm('tester', 2, 0.5), vm('tester', 3, 0.8)], all: null, open: 0 }],
    'agents:proposalDecide': agent('writer', { updatedAt: 200, activeVersion: 3 }), 'agents:undo': agent('writer'),
    'agents:trialDecide': agent('tester'), 'agents:lifecycleDecide': { proposals: [], evaluations: [], feedback: [], problem: null }, 'agents:keep': agent('imported'), 'agents:retire': agent('imported'), 'agents:restore': agent('imported'),
    'agents:classifierCalibration': over.calibration ?? [], 'agents:classifierDecide': [],
  };
  const client: ApprovalsClient = {
    invoke: (async (channel: string, arg: unknown) => {
      calls.push([channel, arg]);
      if (channel === 'agents:proposals' && over.failProposals) throw new Error('store unreadable');
      return answers[channel];
    }) as ApprovalsClient['invoke'],
    lifecycle: { read: async () => { if (over.failLifecycle) throw new Error('down'); return { proposals: [], evaluations: [], feedback: [], problem: null, ...over.lifecycle }; } },
  };
  return { client, calls, reads: (channel: string) => calls.filter(([c]) => c === channel).length, writes: () => calls.filter(([c]) => !['agents:list', 'agents:proposals', 'agents:metrics', 'agents:classifierCalibration'].includes(c)), profiles };
}
const proposal = (extra: Partial<AgentProposal> = {}): AgentProposal => ({
  id: 'p1', at: 10, kind: 'proposal', agentId: 'writer', baseRevision: 100, state: 'pending', reason: 'Troppe domande', expectedEffect: 'Meno domande',
  evidence: [{ kind: 'run', ref: 'r_000000000001', at: 5 }], draft: { ...agent('writer'), instructions: 'riga uno\nriga nuova' }, ...extra,
});

describe('gatherApprovals', () => {
  it('collects definitions, open trials, probations and lifecycle suggestions in decision order', async () => {
    const f = fixture({
      proposals: [proposal(), proposal({ id: 'done', state: 'accepted' })],
      lifecycle: { proposals: [
        { key: 'trial:tester:3', kind: 'keep', agentIds: ['tester'], reason: 'Migliora', evidence: [], at: 60, state: 'pending' },
        { key: 'trial:gone:1', kind: 'revert', agentIds: ['gone'], reason: 'Vecchia', evidence: [], at: 61, state: 'pending' },
        { key: 'work:x', kind: 'create', agentIds: [], reason: 'Lavoro ripetuto', evidence: [], at: 30, state: 'pending' },
      ] },
    });
    const s = await gatherApprovals(f.client);
    expect(s.items.map(i => i.type)).toEqual(['definition', 'trial', 'probation', 'lifecycle']);
    const trial = s.items.find(i => i.type === 'trial') as Extract<ApprovalItem, { type: 'trial' }>;
    expect(trial.advice?.kind).toBe('keep');
    expect(trial.before?.version).toBe(2); expect(trial.after?.version).toBe(3); // from agents:metrics when the advice has none
    expect(s.items.some(i => i.key.includes('gone'))).toBe(false); // advice for a closed trial: nothing left to decide
    expect(s.problems).toEqual([]);
    expect(f.writes()).toEqual([]); // reading never decides
  });
  it('marks a definition overtaken by a later edit as stale and reports a failing source without hiding the rest', async () => {
    const f = fixture({ proposals: [proposal({ baseRevision: 99 })], failLifecycle: true });
    const s = await gatherApprovals(f.client);
    expect(s.items[0]).toMatchObject({ type: 'definition', stale: true });
    expect(s.problems).toEqual(['lifecycle']);
  });
});

describe('gatherApprovals with the lifecycle queue (drafts, advice)', () => {
  it('falls back to the queue drafts when agents:proposals fails; lessons are never approval cards (ADR 0077)', async () => {
    const f = fixture({ failProposals: true, lifecycle: {
      drafts: [proposal({ id: 'd1' })],
    } });
    const s = await gatherApprovals(f.client);
    expect(s.items.map(i => i.type)).not.toContain('rule');
    expect(s.items.find(i => i.type === 'definition')?.key).toBe('def:d1');
    expect(s.problems).toEqual([]);
  });
  it('puts probation advice on the probation card and never lists trial/probation entries as suggestions', async () => {
    const f = fixture({ lifecycle: { proposals: [
      { key: 'probation:imported', kind: 'retire', agentIds: ['imported'], reason: 'Due esiti negativi', evidence: [], at: 80, state: 'pending' },
      { key: 'model:writer:haiku', kind: 'model-trial', model: 'haiku', agentIds: ['writer'], reason: 'Costa meno', evidence: [], at: 40, state: 'pending' },
    ] } });
    const s = await gatherApprovals(f.client);
    const probation = s.items.find(i => i.type === 'probation') as Extract<ApprovalItem, { type: 'probation' }>;
    expect(probation.advice?.kind).toBe('retire');
    expect(s.items.filter(i => i.type === 'lifecycle').map(i => i.key)).toEqual(['life:model:writer:haiku']);
  });
  it('shows an archive request as one sentence, without a field diff', async () => {
    const f = fixture({ proposals: [proposal({ op: 'archive' })] });
    const item = (await gatherApprovals(f.client)).items[0]!;
    expect(item).toMatchObject({ type: 'definition', changes: [] });
  });
});

describe('decideApproval', () => {
  it('decides queue entries with agents:lifecycleDecide by their key, and only those', async () => {
    const f = fixture({ lifecycle: { proposals: [
      { key: 'trial:tester:3', kind: 'revert', agentIds: ['tester'], reason: 'Peggiora', evidence: [], at: 60, state: 'pending' },
      { key: 'work:x', kind: 'update', agentIds: ['writer'], reason: 'Lacuna ripetuta', evidence: [], at: 30, state: 'pending' },
    ] } });
    const items = (await gatherApprovals(f.client)).items, by = (t: string) => items.find(i => i.type === t)!;
    expect(await decideApproval(f.client, by('lifecycle'), { type: 'queue', decision: 'approve' })).toBeNull();
    await decideApproval(f.client, by('trial'), { type: 'queue', decision: 'dismiss' });
    expect(f.writes()).toEqual([['agents:lifecycleDecide', { key: 'work:x', decision: 'approve' }], ['agents:lifecycleDecide', { key: 'trial:tester:3', decision: 'dismiss' }]]);
    await expect(decideApproval(f.client, by('probation'), { type: 'queue', decision: 'dismiss' })).rejects.toThrow(); // no advice on it
  });
  it('undoes an accepted archive request by restoring the agent', async () => {
    const f = fixture({ proposals: [proposal({ op: 'archive' })] });
    const item = (await gatherApprovals(f.client)).items[0]!;
    const undo = await decideApproval(f.client, item, { type: 'definition', accept: true });
    await undo!.run();
    expect(f.writes()[1]).toEqual(['agents:undo', { agentId: 'writer', expectedRevision: 200, operation: 'restore' }]);
  });
  it('approves a definition change and undoes it by restoring the version it replaced', async () => {
    const f = fixture({ proposals: [proposal()] });
    const item = (await gatherApprovals(f.client)).items[0]!;
    const undo = await decideApproval(f.client, item, { type: 'definition', accept: true });
    expect(f.writes()).toEqual([['agents:proposalDecide', { id: 'p1', accept: true }]]);
    await undo!.run();
    expect(f.writes()[1]).toEqual(['agents:undo', { agentId: 'writer', expectedRevision: 200, operation: 'version', version: 2 }]);
  });
  it('a new agent is undone by archiving it; a rejection has no undo', async () => {
    const f = fixture({ proposals: [proposal({ kind: 'suggestion', agentId: undefined, baseRevision: undefined, before: undefined })] });
    const item = (await gatherApprovals(f.client)).items[0]!;
    expect(item.type === 'definition' && item.changes.some(c => c.field === 'name' && c.before === null)).toBe(true);
    const undo = await decideApproval(f.client, item, { type: 'definition', accept: true });
    await undo!.run();
    expect(f.writes()[1]![1]).toMatchObject({ operation: 'archive' });
    expect(await decideApproval(f.client, item, { type: 'definition', accept: false })).toBeNull();
  });
  it('maps trials and probations to their channels', async () => {
    const f = fixture();
    const items = (await gatherApprovals(f.client)).items, by = (t: string) => items.find(i => i.type === t)!;
    await decideApproval(f.client, by('trial'), { type: 'trial', decision: 'rollback' });
    await decideApproval(f.client, by('probation'), { type: 'probation', decision: 'keep' });
    const retire = await decideApproval(f.client, by('probation'), { type: 'probation', decision: 'retire', reason: 'no' });
    await retire!.run();
    expect(f.writes()).toEqual([
      ['agents:trialDecide', { id: 'tester', decision: 'rollback' }],
      ['agents:keep', { id: 'imported' }],
      ['agents:retire', { id: 'imported', reason: 'no' }],
      ['agents:restore', { id: 'imported' }],
    ]);
    await expect(decideApproval(f.client, by('trial'), { type: 'probation', decision: 'keep' })).rejects.toThrow();
  });
});

describe('diffs', () => {
  it('lists only changed fields and diffs instructions line by line', () => {
    const before = agent('a'), after = { ...before, model: 'sonnet', instructions: 'riga uno\nriga tre' };
    expect(diffDefinition(before, after).map(c => c.field)).toEqual(['instructions', 'model']);
    expect(lineDiff('riga uno\nriga due', 'riga uno\nriga tre')).toEqual([{ op: 'same', text: 'riga uno' }, { op: 'del', text: 'riga due' }, { op: 'add', text: 'riga tre' }]);
  });
  it('sends a create suggestion to a new definition and an update to its agent', () => {
    const base = { type: 'lifecycle' as const, key: 'k', at: 1, proposal: { key: 'k', kind: 'update' as const, agentIds: ['writer'], reason: '', evidence: [], at: 1, state: 'pending' as const } };
    expect(lifecycleTarget({ ...base, agents: [agent('writer')] })).toBe('writer');
    expect(lifecycleTarget({ ...base, agents: [] })).toBe('studio');
  });
});

describe('AgentApprovalsView', () => {
  const props = { error: false, busy: null, done: null, failure: null, onDecide: vi.fn(), onEdit: vi.fn(), onUndo: vi.fn(), onDismiss: vi.fn(), onRefresh: vi.fn() };
  it('renders nothing when nothing is pending', () => {
    expect(renderToStaticMarkup(createElement(AgentApprovalsView, { ...props, state: { items: [], problems: [], lifecycleProblem: null } }))).toBe('');
  });
  it('renders each card as text with its numbers and decisions, deciding nothing on render', async () => {
    const f = fixture({ proposals: [proposal({ reason: '<script>x()</script>' })] });
    const state = await gatherApprovals(f.client);
    const html = renderToStaticMarkup(createElement(AgentApprovalsView, { ...props, state }));
    expect(html).toContain('Da approvare'); expect(html).toContain('data-testid="approvals-count"');
    expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
    for (const label of ['Approva', 'Rifiuta', 'Modifica prima di approvare', 'Tieni questa versione', 'Torna a v2', 'Tieni l’agente', 'Ritira']) expect(html).toContain(label);
    expect(html).toContain('riga nuova'); expect(html).toContain('80%'); expect(html).toContain('n=3');
    expect(props.onDecide).not.toHaveBeenCalled(); expect(f.writes()).toEqual([]);
  });
  it('offers queue decisions on suggestions and advice, and names rollback requests', async () => {
    const f = fixture({ proposals: [proposal({ op: 'rollback', toVersion: 1 })], lifecycle: { proposals: [
      { key: 'trial:tester:3', kind: 'keep', agentIds: ['tester'], reason: 'Migliora', evidence: [], at: 60, state: 'pending' },
      { key: 'work:x', kind: 'split', agentIds: ['writer'], reason: 'Due ruoli', evidence: [], at: 30, state: 'pending' },
    ] } });
    const html = renderToStaticMarkup(createElement(AgentApprovalsView, { ...props, state: await gatherApprovals(f.client) }));
    for (const label of ['Ritorno alla v1', 'Le prossime esecuzioni useranno la v1 invece della v2.', 'Chiedi la bozza', 'Ignora', 'Prepara nell’editor', 'seconda approvazione']) expect(html).toContain(label);
    expect(html).not.toContain('Modifica prima di approvare'); // a rollback is not edited, only approved or rejected
    expect(html.match(/>Ignora</g)).toHaveLength(2); // the trial's advice and the suggestion
  });
  it('shows the undo line after a decision and a stale proposal only as closable', async () => {
    const f = fixture({ proposals: [proposal({ baseRevision: 1 })], profiles: [agent('writer')] });
    const state = await gatherApprovals(f.client);
    const html = renderToStaticMarkup(createElement(AgentApprovalsView, { ...props, state, done: { text: 'Fatto.', undo: { kind: 'retire', agentId: 'x', run: async () => null } } }));
    expect(html).toContain('Annulla'); expect(html).toContain('Chiudi la proposta'); expect(html).not.toContain('>Approva<');
  });
});

describe('classifier threshold card', () => {
  const cal = (extra: Partial<ClassifierCalibration> = {}): ClassifierCalibration => ({ mode: 'hybrid', threshold: 60, defaultThreshold: 60, approved: null, n: 24,
    rank1: 0.75, coverageNow: 0.7, coverageSuggested: 0.92, suggested: 47, pending: true, ...extra });
  it('lists a pending suggestion only, keyed by its value, after the agent changes', async () => {
    const f = fixture({ calibration: [cal(), cal({ mode: 'words', pending: false, suggested: 22 })] });
    const items = (await gatherApprovals(f.client)).items;
    expect(items.filter(i => i.type === 'classifier').map(i => i.key)).toEqual(['classifier:hybrid:47']);
    expect(items.at(-1)!.type).toBe('classifier');
  });
  it('applies the value shown and undoes back to the default, or to the earlier approved value', async () => {
    const f = fixture({ calibration: [cal()] });
    const item = (await gatherApprovals(f.client)).items.find(i => i.type === 'classifier')!;
    const undo = await decideApproval(f.client, item, { type: 'classifier', decision: 'apply' });
    await undo!.run();
    expect(f.writes()).toEqual([['agents:classifierDecide', { mode: 'hybrid', decision: 'apply', value: 47 }], ['agents:classifierDecide', { mode: 'hybrid', decision: 'reset' }]]);
    const g = fixture({ calibration: [cal({ approved: 55, threshold: 55 })] });
    const again = (await gatherApprovals(g.client)).items.find(i => i.type === 'classifier')!;
    await (await decideApproval(g.client, again, { type: 'classifier', decision: 'apply' }))!.run();
    expect(g.writes().at(-1)).toEqual(['agents:classifierDecide', { mode: 'hybrid', decision: 'apply', value: 55 }]);
    expect(await decideApproval(g.client, again, { type: 'classifier', decision: 'dismiss' })).toBeNull();
  });
  it('renders what changes, the numbers behind it and the method', async () => {
    const f = fixture({ calibration: [cal()] });
    const html = renderToStaticMarkup(createElement(AgentApprovalsView, { state: await gatherApprovals(f.client), error: false, busy: null, done: null, failure: null,
      onDecide: vi.fn(), onEdit: vi.fn(), onUndo: vi.fn(), onDismiss: vi.fn(), onRefresh: vi.fn() }));
    for (const text of ['Soglia del classificatore', 'con il modello locale', 'da 60 a 47', 'Su 24 esecuzioni', '70%', '92%', '75%', 'quantile conforme', 'Applica la soglia']) expect(html).toContain(text);
    expect(f.writes()).toEqual([]);
  });
});
