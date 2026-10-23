// Flow catalog and shared modal preserve empty-start behavior, full review, evidence, brain identity and immutable revisions.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { app } from '../../src/renderer/store/store';
import type { ChatSummary } from '../../src/shared/contract';
import type { FlowSnapshot, FlowDefinition, FlowRun } from '../../src/shared/flows';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke, on: vi.fn() } }));
import { flowAsks } from '../../src/renderer/lib/flow-ask';
import { flowDecisionMode, flowDecisionSubmission } from '../../src/renderer/lib/flow-decision';
import { flowRequest } from '../../src/renderer/lib/flow-request';
import { Flows } from '../../src/renderer/brain/pages/Flows';
import { FlowApproval } from '../../src/renderer/components/FlowApproval';
import { flowState, decideFlow, reloadFlows } from '../../src/renderer/store/flows';
import { answerLater, requestPostponed, startLater } from '../../src/renderer/lib/later';
import { decisionDraft, saveDecisionDraft } from '../../src/renderer/lib/decision-drafts';
const definition: FlowDefinition = { id: 'review-doc', title: 'Revisione documento', description: 'Solo i documenti selezionati.', category: 'Documenti', aliases: ['rivedi documento'], scope: { project: 'Demo' }, steps: [{ id: 'review', title: 'Conferma il testo', kind: 'approval', instructions: 'Controlla il testo e approva la versione.', inputs: ['document'], evidence: ['[Report](file:///tmp/review.md)'], timeoutMs: 5000, maxAttempts: 1, effect: 'read-only' }] };
const snapshot = (): FlowSnapshot => ({ contextKey: '/brain/a', drafts: [{ definition, revision: 2, updatedAt: 3, status: 'proposed' }], versions: [{ definition, version: 1, draftRevision: 1, digest: 'hash', activatedAt: 1 }], active: { [definition.id]: 1 }, runs: [] });
const run: FlowRun = { id: 'r', revision: 4, flowId: definition.id, flowVersion: 1, definitionDigest: 'hash', ownerOrchestratorId: 'o', subjectKey: 'Doc 1', scope: { project: 'Demo' }, inputs: { document: 'v1' }, status: 'approval', currentStep: 0, steps: [{ stepId: 'review', status: 'approval', attempts: 0 }], createdAt: 1, updatedAt: 3 };
beforeEach(() => { invoke.mockReset(); flowState.set({ snapshot: snapshot(), loading: false, error: null }); });
it('starts empty without sample templates, fake progress or direct execution controls', () => {
  flowState.set({ snapshot: { contextKey: 'empty', drafts: [], versions: [], active: {}, runs: [] }, loading: false, error: null });
  const html = renderToStaticMarkup(createElement(Flows));
  expect(html).toContain('Nessun flusso definito'); expect(html).toContain('Chiedi all’Orchestrator');
  expect(html).not.toContain('flow-definition'); expect(html).not.toContain('flow-run'); expect(html).not.toContain('Attiva');
  expect(invoke).not.toHaveBeenCalled();
});
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
  for (const text of ['Approvi questa versione', 'Solo i documenti selezionati.', 'Conferma il testo', '5000', 'read-only', 'document', 'Sì', 'No', 'Altro…', 'ctx-link file', 'Report']) expect(html).toContain(text);
  expect(html).toContain('<details>'); expect(html).not.toContain('<details open');
  expect(html).toContain('flow/%2Fbrain%2Fa/definition/review-doc@2');
});
it('keeps blocked runs visible with the host reason and no unsupported approval', () => {
  const blocked: FlowRun = { ...run, status: 'blocked', steps: [{ stepId: 'review', status: 'blocked', attempts: 0, reason: 'Adattatore non disponibile' }] };
  const state = { ...snapshot(), drafts: [], runs: [blocked] };
  const html = renderToStaticMarkup(createElement(FlowApproval, { ask: flowAsks(state)[0]!, onEscape: vi.fn() }));
  expect(html).toContain('Adattatore non disponibile'); expect(html).toMatch(/disabled=""[^>]*data-testid="flow-approve"/);
  flowState.set({ snapshot: state, error: null, loading: false });
  expect(renderToStaticMarkup(createElement(Flows))).toContain('Adattatore non disponibile');
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
it('requests a question-first wizard and never authorizes implicit activation or production execution', () => {
  const create = flowRequest('create');
  expect(create).toContain('strumento nativo delle domande'); expect(create).toContain('Non inventare processi aziendali'); expect(create).toContain('Non avviare esecuzioni');
  const start = flowRequest('start', { id: definition.id, name: definition.title, version: 1 });
  expect(start).toContain('versione 1'); expect(start).toContain('Avvia solo tu'); expect(start).toContain('Nessuna operazione di produzione');
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
  expect(flowDecisionMode(flowAsks(exhausted)[0]!)).toBe('blocked');
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

it('offers navigation to the bound agent only while that exact chat remains available', () => {
  const bound: ChatSummary = { id: 'bound-agent', harness: 'claude', origin: 'app', title: 'Bound agent', cwd: '/review', sessionId: null, model: null, effort: null, permissionMode: null, state: 'idle', costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 1, browserTabIds: [] };
  const chats = app.get().chats;
  const state = { ...snapshot(), drafts: [], runs: [{ ...run, steps: [{ ...run.steps[0]!, chatId: bound.id }] }] };
  const ask = flowAsks(state)[0]!;
  try {
    app.set(s => ({ ...s, chats: { ...s.chats, [bound.id]: bound } }));
    expect(renderToStaticMarkup(createElement(FlowApproval, { ask, onEscape: vi.fn() }))).toContain('data-testid="flow-open-agent"');
    flowState.set({ snapshot: state, loading: false, error: null });
    expect(renderToStaticMarkup(createElement(Flows))).toContain('data-testid="flow-open-agent"');
    app.set(s => ({ ...s, chats }));
    expect(renderToStaticMarkup(createElement(FlowApproval, { ask, onEscape: vi.fn() }))).not.toContain('data-testid="flow-open-agent"');
  } finally { app.set(s => ({ ...s, chats })); }
});
