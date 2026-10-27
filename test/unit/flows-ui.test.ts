// Flow catalog and shared modal preserve empty-start behavior, full review, evidence, brain identity and immutable revisions.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { ui, dismissToast } from '../../src/renderer/store/ui';
import type { FlowSnapshot, FlowDefinition, FlowRun } from '../../src/shared/flows';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke, on: vi.fn() } }));
import { flowAsks } from '../../src/renderer/lib/flow-ask';
import { flowDecisionMode, flowDecisionSubmission, flowRetryLimit } from '../../src/renderer/lib/flow-decision';
import { FlowDiagram } from '../../src/renderer/components/FlowDiagram';
import { FlowApproval } from '../../src/renderer/components/FlowApproval';
import { flowState, decideFlow, reloadFlows } from '../../src/renderer/store/flows';
import { answerLater, requestPostponed, startLater } from '../../src/renderer/lib/later';
import { decisionDraft, saveDecisionDraft } from '../../src/renderer/lib/decision-drafts';
const definition: FlowDefinition = { id: 'review-doc', title: 'Revisione documento', description: 'Solo i documenti selezionati.', category: 'Documenti', aliases: ['rivedi documento'], scope: { project: 'Demo' }, steps: [{ id: 'review', title: 'Conferma il testo', kind: 'approval', instructions: 'Controlla il testo e approva la versione.', inputs: ['document'], evidence: ['[Report](file:///tmp/review.md)'], timeoutMs: 5000, maxAttempts: 1, effect: 'read-only' }] };
const snapshot = (): FlowSnapshot => ({ contextKey: '/brain/a', drafts: [{ definition, revision: 2, updatedAt: 3, status: 'proposed' }], versions: [{ definition, version: 1, draftRevision: 1, digest: 'hash', activatedAt: 1 }], active: { [definition.id]: 1 }, runs: [] });
const run: FlowRun = { id: 'r', revision: 4, flowId: definition.id, flowVersion: 1, definitionDigest: 'hash', ownerOrchestratorId: 'o', subjectKey: 'Doc 1', scope: { project: 'Demo' }, inputs: { document: 'v1' }, status: 'approval', currentStep: 0, steps: [{ stepId: 'review', status: 'approval', attempts: 0 }], createdAt: 1, updatedAt: 3 };
beforeEach(() => { invoke.mockReset(); flowState.set({ snapshot: snapshot(), loading: false, error: null }); });
const automated = (): FlowSnapshot => ({ ...snapshot(), drafts: [], automation: {
  revision: 12, paused: false, background: false, events: [], rules: [{
    id: 'auto-review', revision: 3, ownerOrchestratorId: 'o', status: 'proposed', failures: 0, createdAt: 1, updatedAt: 4,
    config: { flowId: definition.id, flowVersion: 1, scope: { project: 'Selected project', areaPath: 'Selected area' },
      inputs: { workspace: '/selected/workspace' }, priority: 'normal', trigger: { kind: 'devops', everyMinutes: 15,
        organization: 'selected-org', project: 'Selected project', areaPath: 'Selected area', workItemType: 'Bug', states: ['New'], includeExisting: false } },
  }],
} });
it('binds asks to the brain and draft/run revisions and excludes already answered definitions', () => {
  const first = flowAsks(snapshot())[0]!;
  expect(flowAsks({ ...snapshot(), contextKey: '/brain/b' })[0]!.id).not.toBe(first.id);
  expect(flowAsks({ ...snapshot(), drafts: [{ ...snapshot().drafts[0]!, revision: 3 }] })[0]!.id).not.toBe(first.id);
  expect(flowAsks({ ...snapshot(), drafts: [{ ...snapshot().drafts[0]!, status: 'rejected' }] })).toEqual([]);
  expect(flowAsks({ ...snapshot(), storageError: 'corrupt' })).toEqual([]);
  saveDecisionDraft(`flow/${first.id}`, 'Only this document');
  expect(decisionDraft(`flow/${flowAsks({ ...snapshot(), contextKey: '/brain/b' })[0]!.id}`)).toBe('');
});
it('shows complete immutable definition and evidence in expandable modal details with three answer paths', () => {
  const html = renderToStaticMarkup(createElement(FlowApproval, { ask: flowAsks(snapshot())[0]!, onEscape: vi.fn() }));
  for (const text of ['Approvi questa versione', 'Solo i documenti selezionati.', 'Conferma il testo', '5000', 'read-only', 'document', 'Sì', 'No', 'Scrivi una risposta…', 'ctx-link file', 'Report']) expect(html).toContain(text);
  expect(html).toContain('<details>'); expect(html).not.toContain('<details open');
  expect(html).toContain('flow/%2Fbrain%2Fa/definition/review-doc@2');
});
it('sends exact brain, revision and free response without approval; rejects cross-brain answers', async () => {
  const ask = flowAsks(snapshot())[0]!;
  invoke.mockResolvedValue({ ...snapshot(), drafts: [] });
  expect(await decideFlow(ask, 'other', 'Scope only Demo')).toBe(true);
  expect(invoke).toHaveBeenCalledWith('flows:definitionDecide', { contextKey: '/brain/a', id: 'review-doc', expectedRevision: 2, answer: 'other', feedback: 'Scope only Demo' });
  flowState.set({ snapshot: { ...snapshot(), contextKey: '/brain/b' }, error: null, loading: false });
  invoke.mockClear(); expect(await decideFlow(ask, 'yes')).toBe(false); expect(invoke).not.toHaveBeenCalled();
});
it('preserves the run version/step and does not restore stale reads after decisions', async () => {
  const state = { ...snapshot(), drafts: [], runs: [run] }; flowState.set({ snapshot: state, error: null, loading: false });
  let finish!: (s: FlowSnapshot) => void;
  invoke.mockImplementation((channel: string) => channel === 'flows:list' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ ...state, runs: [{ ...run, revision: 5, status: 'completed' }] }));
  const reading = reloadFlows();
  expect(await decideFlow(flowAsks(state)[0]!, 'yes')).toBe(true);
  expect(invoke).toHaveBeenCalledWith('flows:decide', { contextKey: '/brain/a', runId: 'r', expectedRevision: 4, stepId: 'review', answer: 'yes' });
  finish(state); await reading;
  expect(flowState.get().snapshot?.runs[0]!.status).toBe('completed');
});

it('does not reopen an answered blocked run, but exposes a new explicitly pending decision', () => {
  const state = { ...snapshot(), drafts: [], runs: [{ ...run, status: 'blocked' as const, steps: [{ ...run.steps[0]!, status: 'blocked' as const, decisionPending: false }] }] };
  expect(flowAsks(state)).toEqual([]);
  expect(flowAsks({ ...state, runs: [{ ...state.runs[0]!, revision: 5, steps: [{ ...state.runs[0]!.steps[0]!, decisionPending: true }] }] })).toHaveLength(1);
});
it('postpones only one exact flow decision and prunes it when the source brain changes', () => {
  invoke.mockResolvedValue(undefined);
  startLater();
  const ask = flowAsks(snapshot())[0]!, key = `flow/${ask.id}`;
  answerLater(key); expect(requestPostponed(key)).toBe(true);
  const other = { ...snapshot(), contextKey: '/brain/other' };
  expect(requestPostponed(`flow/${flowAsks(other)[0]!.id}`)).toBe(false);
  flowState.set({ snapshot: other, error: null, loading: false });
  expect(requestPostponed(key)).toBe(false);
});

it('offers bounded agent retries only with required inputs, no action adapter and a safe effect', () => {
  const agentDefinition: FlowDefinition = { ...definition, steps: [{ ...definition.steps[0]!, kind: 'agent', maxAttempts: 2 }] };
  const state = { ...snapshot(), drafts: [], versions: [{ ...snapshot().versions[0]!, definition: agentDefinition }], runs: [{ ...run, status: 'blocked' as const, steps: [{ ...run.steps[0]!, status: 'blocked' as const, attempts: 1 }] }] };
  expect(flowDecisionMode(flowAsks(state)[0]!)).toBe('retry');
  expect(renderToStaticMarkup(createElement(FlowApproval, { ask: flowAsks(state)[0]!, onEscape: vi.fn() }))).toContain('Sì, riprova');
  const exhausted = { ...state, runs: [{ ...state.runs[0]!, steps: [{ ...state.runs[0]!.steps[0]!, attempts: 2 }] }] };
  // attempts used up: Sì grants the one last extra attempt the host allows, and the card says so
  expect(flowDecisionMode(flowAsks(exhausted)[0]!)).toBe('retry');
  expect(flowRetryLimit(flowAsks(exhausted)[0]!)).toEqual({ attempts: 2, max: 2, extra: true, updated: false });
  expect(flowRetryLimit(flowAsks(state)[0]!)).toBeNull();
  const exhaustedCard = renderToStaticMarkup(createElement(FlowApproval, { ask: flowAsks(exhausted)[0]!, onEscape: vi.fn() }));
  expect(exhaustedCard).toContain('data-testid="flow-retry-limit"');
  expect(exhaustedCard).toContain('Tentativi esauriti (2 di 2)');
  expect(exhaustedCard).toContain('ultimo tentativo extra');
  expect(flowDecisionSubmission(flowAsks(exhausted)[0]!, 'yes', '', '')).toEqual({ answer: 'yes' });
  // the extra attempt is spent: a second one is refused and a disabled Sì says why
  const spent = { ...state, runs: [{ ...state.runs[0]!, steps: [{ ...state.runs[0]!.steps[0]!, attempts: 3, userRetryUsed: true }] }] };
  expect(flowDecisionMode(flowAsks(spent)[0]!)).toBe('blocked');
  expect(flowRetryLimit(flowAsks(spent)[0]!)).toEqual({ attempts: 3, max: 2, extra: false, updated: false });
  expect(flowDecisionSubmission(flowAsks(spent)[0]!, 'yes', '', '')).toBeNull();
  expect(renderToStaticMarkup(createElement(FlowApproval, { ask: flowAsks(spent)[0]!, onEscape: vi.fn() }))).toContain('«Sì» non può ripetere il passaggio');
  // a write whose outcome is unknown is reconciled first: no extra attempt over it
  const uncertain = { ...exhausted, runs: [{ ...exhausted.runs[0]!, browserWrites: [{ stepId: 'review', chatRunId: 'r1', taskVersion: 1, at: 1, dispatched: 1, outcome: 'partial' as const, evidence: [] }] }] };
  expect(flowDecisionMode(flowAsks(uncertain)[0]!)).toBe('blocked');
  expect(flowRetryLimit(flowAsks(uncertain)[0]!)?.extra).toBe(false);
  expect(flowDecisionMode(flowAsks({ ...state, runs: [{ ...state.runs[0]!, inputs: {} }] })[0]!)).toBe('blocked');
  for (const effect of ['production', 'external-write'] as const) {
    const dangerous = { ...state, versions: [{ ...state.versions[0]!, definition: { ...agentDefinition, steps: [{ ...agentDefinition.steps[0]!, effect }] } }] };
    expect(flowDecisionMode(flowAsks(dangerous)[0]!)).toBe('blocked');
  }
});

it('identifies the exact run target and actual scope/inputs before the approval actions', () => {
  const scoped = { ...snapshot(), drafts: [], runs: [{ ...run, subjectKey: 'Issue 247', scope: { project: 'Actual project', areaPath: 'Actual area' }, inputs: { document: 'Selected revision 9', workspace: '/review/repo' } }] };
  const ask = flowAsks(scoped)[0]!;
  expect(ask.title).toContain('Issue 247');
  const html = renderToStaticMarkup(createElement(FlowApproval, { ask, onEscape: vi.fn() }));
  for (const value of ['Issue 247', 'Actual project', 'Actual area', 'Selected revision 9', '/review/repo']) expect(html).toContain(value);
  expect(html.indexOf('data-testid="flow-target"')).toBeLessThan(html.indexOf('data-testid="flow-approve"'));
  expect(html).toContain('data-testid="flow-run-context"');
});
it('requires correctly labelled evidence for Yes and keeps Other as a separate non-approving response', async () => {
  const gateDefinition = { ...definition, steps: [{ ...definition.steps[0]!, evidence: ['review', 'document'] }] };
  const state = { ...snapshot(), drafts: [], versions: [{ ...snapshot().versions[0]!, definition: gateDefinition }], runs: [run] };
  const ask = flowAsks(state)[0]!;
  expect(flowDecisionSubmission(ask, 'yes', 'I approve', '')).toBeNull();
  expect(flowDecisionSubmission(ask, 'yes', '', 'review: checked')).toBeNull();
  expect(flowDecisionSubmission(ask, 'yes', '', 'review: checked\ndocument: ')).toBeNull();
  const note = 'review: checked selected revision\ndocument: revision 9';
  expect(flowDecisionSubmission(ask, 'other', 'Change the scope', note)).toEqual({ answer: 'other', feedback: 'Change the scope' });
  const submission = flowDecisionSubmission(ask, 'yes', 'Unrelated clarification', note)!;
  expect(submission).toEqual({ answer: 'yes', feedback: note });
  flowState.set({ snapshot: state, loading: false, error: null }); invoke.mockResolvedValue({ ...state, runs: [] });
  await decideFlow(ask, submission.answer, submission.feedback);
  expect(invoke).toHaveBeenCalledWith('flows:decide', { contextKey: state.contextKey, runId: run.id, expectedRevision: run.revision, stepId: 'review', answer: 'yes', feedback: note });
  const empty = renderToStaticMarkup(createElement(FlowApproval, { ask, onEscape: vi.fn() }));
  expect(empty).toContain('data-testid="flow-evidence"'); expect(empty).toContain('review: …');
  expect(empty).toMatch(/disabled=""[^>]*data-testid="flow-approve"/);
  saveDecisionDraft(`flow/${ask.id}/evidence`, note);
  const filled = renderToStaticMarkup(createElement(FlowApproval, { ask, onEscape: vi.fn() }));
  expect(filled).toContain(note); expect(filled).not.toMatch(/disabled=""[^>]*data-testid="flow-approve"/);
  saveDecisionDraft(`flow/${ask.id}/evidence`, '');
});
it('requires a manual completion note even when no evidence labels are declared', () => {
  const manual = { ...definition, steps: [{ ...definition.steps[0]!, kind: 'manual' as const, evidence: [] }] };
  const state = { ...snapshot(), drafts: [], versions: [{ ...snapshot().versions[0]!, definition: manual }], runs: [run] };
  const ask = flowAsks(state)[0]!;
  expect(flowDecisionSubmission(ask, 'yes', '', '  ')).toBeNull();
  expect(flowDecisionSubmission(ask, 'yes', '', 'Verified selected document manually.')).toEqual({ answer: 'yes', feedback: 'Verified selected document manually.' });
  const html = renderToStaticMarkup(createElement(FlowApproval, { ask, onEscape: vi.fn() }));
  expect(html).toContain('descrivi ciò che hai fatto');
});
it('shows the required workspace input in the exact definition review', () => {
  const state = snapshot(); state.drafts[0]!.definition = { ...definition, steps: [{ ...definition.steps[0]!, workspaceInput: 'reviewWorkspace' }] };
  const html = renderToStaticMarkup(createElement(FlowApproval, { ask: flowAsks(state)[0]!, onEscape: vi.fn() }));
  expect(html).toContain('Input della cartella di lavoro'); expect(html).toContain('reviewWorkspace');
});

it('adds exact automatic proposals to the common queue and preserves revision-specific postponement', () => {
  const state = automated(), ask = flowAsks(state)[0]!;
  expect(ask.type).toBe('flow-automation');
  expect(ask.id).toBe('%2Fbrain%2Fa/automation/auto-review@3');
  saveDecisionDraft(`flow/${ask.id}`, 'Only my selected scope');
  const changed = automated(); changed.automation!.rules[0]!.revision = 4;
  expect(flowAsks(changed)[0]!.id).not.toBe(ask.id);
  expect(decisionDraft(`flow/${flowAsks(changed)[0]!.id}`)).toBe('');
  expect(flowAsks({ ...state, automation: { ...state.automation!, storageError: 'unreadable' } })).toEqual([]);
  for (const status of ['enabled', 'paused', 'rejected'] as const) {
    expect(flowAsks({ ...state, automation: { ...state.automation!, rules: [{ ...state.automation!.rules[0]!, status }] } })).toEqual([]);
  }
  saveDecisionDraft(`flow/${ask.id}`, '');
});
it('shows the exact automatic scope, cadence, inputs, cost and revision before consent', () => {
  const ask = flowAsks(automated())[0]!;
  const html = renderToStaticMarkup(createElement(FlowApproval, { ask, onEscape: vi.fn() }));
  for (const value of ['qwin-flow-automation', 'v1 · r3', 'Selected project', 'Selected area', 'selected-org', 'Bug', 'New', '15', '/selected/workspace', 'Esclusi', 'consumare il tuo piano AI', 'Le approvazioni dei passaggi restano necessarie']) expect(html).toContain(value);
  expect(html.indexOf('flow-auto-summary')).toBeLessThan(html.indexOf('flow-approve'));
  expect(flowDecisionSubmission(ask, 'other', 'Change the trigger', '')).toEqual({ answer: 'other', feedback: 'Change the trigger' });
  expect(flowDecisionSubmission(ask, 'yes', '', '')).toEqual({ answer: 'yes' });
  const unavailable = flowAsks({ ...automated(), versions: [] })[0]!;
  expect(flowDecisionSubmission(unavailable, 'yes', '', '')).toBeNull();
});
it('submits automatic consent to its own exact-brain revision channel and rejects cross-brain decisions', async () => {
  const state = automated(); flowState.set({ snapshot: state, error: null, loading: false });
  const ask = flowAsks(state)[0]!; invoke.mockResolvedValue(state);
  expect(await decideFlow(ask, 'other', 'Only new bugs')).toBe(true);
  expect(invoke).toHaveBeenCalledWith('flows:autoDecide', { contextKey: state.contextKey, id: 'auto-review', expectedRevision: 3, answer: 'other', feedback: 'Only new bugs' });
  flowState.set({ snapshot: { ...state, contextKey: 'another-brain' }, error: null, loading: false });
  invoke.mockClear(); expect(await decideFlow(ask, 'yes')).toBe(false); expect(invoke).not.toHaveBeenCalled();
});
it('renders only actual sequence and review edges with keyboard-operable recorded-state nodes', () => {
  const graph = { ...definition, steps: [definition.steps[0]!, { ...definition.steps[0]!, id: 'verify', title: 'Independent verification', reviewOf: 'review', kind: 'agent' as const }] };
  const recorded = { ...run, steps: [{ ...run.steps[0]!, status: 'completed' as const }, { stepId: 'verify', status: 'running' as const, attempts: 1 }], currentStep: 1 };
  const html = renderToStaticMarkup(createElement(FlowDiagram, { definition: graph, run: recorded }));
  expect(html.match(/data-edge="sequence"/g)).toHaveLength(1); expect(html.match(/data-edge="review"/g)).toHaveLength(1);
  expect(html.match(/data-testid="flow-node"/g)).toHaveLength(2);
  expect(html).toContain('data-status="running"'); expect(html).toContain('data-status="completed"'); expect(html).toContain('aria-controls='); expect(html).toContain('aria-pressed="true"');
  const noRun = renderToStaticMarkup(createElement(FlowDiagram, { definition: graph }));
  expect(noRun).not.toContain('flow-node-live');
  expect(noRun).not.toContain('data-status="running"');
});


it('shows exact browser-write targets in activation modal before collapsed definition details',()=>{
 const d:FlowDefinition={...definition,steps:[{id:'browser',title:'Aggiorna il sito',kind:'agent',effect:'external-write',writeVia:'browser',browserTargets:['https://qa.example.com'],instructions:'Write the approved fixture',inputs:['workspace'],workspaceInput:'workspace',evidence:['proof'],timeoutMs:10000,maxAttempts:2}]};
 const snap={...snapshot(),drafts:[{definition:d,revision:1,updatedAt:3,status:'proposed' as const}],versions:[],runs:[]};
 const html=renderToStaticMarkup(createElement(FlowApproval,{ask:flowAsks(snap)[0]!,onEscape:vi.fn()}));
 expect(html).toContain('flow-browser-approval');expect(html).toContain('scrive tramite browser su');expect(html.indexOf('https://qa.example.com')).toBeLessThan(html.indexOf('<details>'));expect(html).toContain('Nessuna autorizzazione di produzione');
});

it('shows pinned connector scope and analysis mention opt-in before approving the definition', () => {
  const d: FlowDefinition = { ...definition, steps: [{ ...definition.steps[0]!, effect: 'external-write', adapter: 'devops-write', mentionReason: 'analysis' }, { id: 'connector', title: 'Write test note', kind: 'check', effect: 'external-write', instructions: 'Write fixture', inputs: [], evidence: ['connector'], timeoutMs: 10000, maxAttempts: 2, connector: { serverId: 'qa', tool: 'note', serverHash: 'a'.repeat(64), toolHash: 'b'.repeat(64), role: 'artisan', arguments: { text: 'fixture note' } } }] };
  const snap = { ...snapshot(), drafts: [{ definition: d, revision: 1, updatedAt: 3, status: 'proposed' as const }], versions: [], runs: [] };
  const html = renderToStaticMarkup(createElement(FlowApproval, { ask: flowAsks(snap)[0]!, onEscape: vi.fn() }));
  expect(html).toContain('qa / note'); expect(html).toContain('fixture note'); expect(html).toContain('un solo commento di analisi per run');
});

it('explains on-demand configuration and surfaces actionable activation errors', async () => {
  const state = automated(); state.automation!.rules[0]!.config.trigger = { kind: 'manual' };
  const html = renderToStaticMarkup(createElement(FlowApproval, { ask: flowAsks(state)[0]!, onEscape: vi.fn() }));
  expect(html).toContain('su richiesta'); expect(html).not.toContain('in automatico?');
  const ask = flowAsks(snapshot())[0]!;
  invoke.mockRejectedValueOnce(new Error('Connector not enabled for test routines: confirm the account in Settings')).mockResolvedValue(snapshot());
  expect(await decideFlow(ask, 'yes')).toBe(false);
  expect(ui.get().toasts.at(-1)?.text).toContain('confirm the account in Settings');
  ui.get().toasts.forEach(t => dismissToast(t.id));
});

it('replaces the blocked retry question with one exact reconciliation Sì/No and exposes its evidence', async () => {
  const pending = { revision: 4, requestedAt: 1000, digest: 'a'.repeat(64), requestHash: 'b'.repeat(64), op: 'link-pr', outcome: 'applied' as const, evidence: 'Verified the exact PR link in the work item.' };
  const state = { ...snapshot(), drafts: [], runs: [{ ...run, status: 'blocked' as const, pendingReconciliation: pending }] };
  const asks = flowAsks(state); expect(asks).toHaveLength(1); expect(asks[0]?.type).toBe('flow-reconcile');
  const html = renderToStaticMarkup(createElement(FlowApproval, { ask: asks[0]!, onEscape: vi.fn() }));
  expect(html).toContain('flow-reconcile-yes'); expect(html).toContain('flow-reconcile-no'); expect(html).toContain(pending.evidence); expect(html).toContain(pending.requestHash);
  flowState.set({ snapshot: state, error: null, loading: false }); invoke.mockResolvedValue(state);
  await decideFlow(asks[0]!, 'yes'); expect(invoke).toHaveBeenCalledWith('flows:reconcileDecide', { contextKey: state.contextKey, runId: run.id, expectedRevision: 4, answer: 'yes' });
});
