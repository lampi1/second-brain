// Flow catalog and shared modal preserve empty-start behavior, full review, evidence, brain identity and immutable revisions.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { ui, dismissToast } from '../../src/renderer/store/ui';
import { app } from '../../src/renderer/store/store';
import type { ChatSummary } from '../../src/shared/contract';
import type { FlowSnapshot, FlowDefinition, FlowRun } from '../../src/shared/flows';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke, on: vi.fn() } }));
import { flowAsks } from '../../src/renderer/lib/flow-ask';
import { flowDecisionSubmission } from '../../src/renderer/lib/flow-decision';
import { flowRequest } from '../../src/renderer/lib/flow-request';
import { Flows } from '../../src/renderer/brain/pages/Flows';
import { RoutineDetail, RoutineHistory } from '../../src/renderer/components/Routine';
import { FlowFullscreenContent } from '../../src/renderer/components/FlowFullscreen';
import { FlowDiagram } from '../../src/renderer/components/FlowDiagram';
import { FlowAutomation } from '../../src/renderer/components/FlowAutomation';
import { FlowApproval } from '../../src/renderer/components/FlowApproval';
import { flowState, decideFlow, reloadFlows, controlFlowAutomation, importFlowDefinition, exportFlowDefinition } from '../../src/renderer/store/flows';
import { answerLater, requestPostponed, startLater } from '../../src/renderer/lib/later';
import { decisionDraft, saveDecisionDraft } from '../../src/renderer/lib/decision-drafts';
const definition: FlowDefinition = { id: 'review-doc', title: 'Revisione documento', description: 'Solo i documenti selezionati.', category: 'Documenti', aliases: ['rivedi documento'], scope: { project: 'Demo' }, steps: [{ id: 'review', title: 'Conferma il testo', kind: 'approval', instructions: 'Controlla il testo e approva la versione.', inputs: ['document'], evidence: ['[Report](file:///tmp/review.md)'], timeoutMs: 5000, maxAttempts: 1, effect: 'read-only' }] };
const snapshot = (): FlowSnapshot => ({ contextKey: '/brain/a', drafts: [{ definition, revision: 2, updatedAt: 3, status: 'proposed' }], versions: [{ definition, version: 1, draftRevision: 1, digest: 'hash', activatedAt: 1 }], active: { [definition.id]: 1 }, runs: [] });
const run: FlowRun = { id: 'r', revision: 4, flowId: definition.id, flowVersion: 1, definitionDigest: 'hash', ownerOrchestratorId: 'o', subjectKey: 'Doc 1', scope: { project: 'Demo' }, inputs: { document: 'v1' }, status: 'approval', currentStep: 0, steps: [{ stepId: 'review', status: 'approval', attempts: 0 }], createdAt: 1, updatedAt: 3 };
beforeEach(() => { invoke.mockReset(); flowState.set({ snapshot: snapshot(), loading: false, error: null }); });
it('starts empty without sample templates, fake progress or direct execution controls', () => {
  flowState.set({ snapshot: { contextKey: 'empty', drafts: [], versions: [], active: {}, runs: [] }, loading: false, error: null });
  const html = renderToStaticMarkup(createElement(Flows));
  expect(html).toContain('Nessuna routine definita'); expect(html).toContain('Chiedi all’Orchestrator');
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
  for (const text of ['Approvi questa versione', 'Solo i documenti selezionati.', 'Conferma il testo', '5000', 'read-only', 'document', 'Sì', 'No', 'Scrivi una risposta…', 'ctx-link file', 'Report']) expect(html).toContain(text);
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
    // the Routine page's working card for a run whose step has a chat
    const working = { ...state, runs: [{ ...state.runs[0]!, status: 'active' as const, steps: [{ ...state.runs[0]!.steps[0]!, status: 'running' as const }] }] };
    flowState.set({ snapshot: working, loading: false, error: null });
    expect(renderToStaticMarkup(createElement(Flows))).toContain('data-testid="flow-open-agent"');
    app.set(s => ({ ...s, chats }));
    expect(renderToStaticMarkup(createElement(FlowApproval, { ask, onEscape: vi.fn() }))).not.toContain('data-testid="flow-open-agent"');
  } finally { app.set(s => ({ ...s, chats })); }
});

const automated = (): FlowSnapshot => ({ ...snapshot(), drafts: [], automation: {
  revision: 12, paused: false, background: false, events: [], rules: [{
    id: 'auto-review', revision: 3, ownerOrchestratorId: 'o', status: 'proposed', failures: 0, createdAt: 1, updatedAt: 4,
    config: { flowId: definition.id, flowVersion: 1, scope: { project: 'Selected project', areaPath: 'Selected area' },
      inputs: { workspace: '/selected/workspace' }, priority: 'normal', trigger: { kind: 'devops', everyMinutes: 15,
        organization: 'selected-org', project: 'Selected project', areaPath: 'Selected area', workItemType: 'Bug', states: ['New'], includeExisting: false } },
  }],
} });
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
it('sends scoped pause and global controls without silently changing other settings', async () => {
  const state = automated(); flowState.set({ snapshot: state, error: null, loading: false }); invoke.mockResolvedValue(state);
  await controlFlowAutomation(state.contextKey, { id: 'auto-review', expectedRevision: 3, paused: true });
  expect(invoke).toHaveBeenLastCalledWith('flows:autoPause', { contextKey: state.contextKey, id: 'auto-review', expectedRevision: 3, paused: true });
  await controlFlowAutomation(state.contextKey, { expectedRevision: 12, background: true });
  expect(invoke).toHaveBeenLastCalledWith('flows:autoControl', { contextKey: state.contextKey, expectedRevision: 12, background: true });
  await controlFlowAutomation(state.contextKey, { expectedRevision: 12, paused: false });
  expect(invoke).toHaveBeenLastCalledWith('flows:autoControl', { contextKey: state.contextKey, expectedRevision: 12, paused: false });
  invoke.mockClear(); expect(await controlFlowAutomation('another-brain', { expectedRevision: 12, paused: false })).toBe(false); expect(invoke).not.toHaveBeenCalled();
});
it('never restores a previous brain after a pending automatic control completes', async () => {
  const state = automated(); flowState.set({ snapshot: state, error: null, loading: false });
  let complete!: (value: FlowSnapshot) => void; invoke.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const action = controlFlowAutomation(state.contextKey, { expectedRevision: 12, background: true });
  flowState.set({ snapshot: { ...state, contextKey: 'new-brain' }, error: null, loading: false });
  complete(state); await action;
  expect(flowState.get().snapshot?.contextKey).toBe('new-brain');
});
it('offers resume only for the approved paused revision and shows real blocked events and errors', () => {
  const state = automated(), rule = state.automation!.rules[0]!;
  rule.status = 'paused'; rule.approvedRevision = 2; rule.error = 'No Orchestrator available'; rule.lastResult = '2 selected items';
  state.automation!.events = [{ id: 'event', ruleId: rule.id, ruleRevision: rule.revision, sourceKey: 'source', subjectKey: 'item', title: 'Selected item', inputs: {}, createdAt: 1, updatedAt: 2, status: 'blocked', attempts: 3, reason: 'Dispatch needs retry' }];
  const props = { version: state.versions[0]!, snapshot: state };
  const html = renderToStaticMarkup(createElement(FlowAutomation, props));
  expect(html).not.toContain('Riprendi e riprova');
  for (const value of ['Selected item', 'Dispatch needs retry', 'No Orchestrator available', '2 selected items']) expect(html).toContain(value);
  rule.approvedRevision = 3;
  expect(renderToStaticMarkup(createElement(FlowAutomation, props))).toContain('Riprendi e riprova');
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
it('keeps the approved definition and automatic mode visible when an older draft exists', () => {
  const state = automated(); state.automation!.rules[0]!.status = 'enabled'; state.automation!.rules[0]!.approvedRevision = 3;
  state.drafts = [{ definition: { ...definition, title: 'Obsolete draft title' }, revision: 1, updatedAt: 1, status: 'rejected' }];
  flowState.set({ snapshot: state, error: null, loading: false });
  const html = renderToStaticMarkup(createElement(Flows));
  // no run open: the page opens on the routines, with the trigger switch on and its schedule in words
  expect(html).toContain('Revisione documento'); expect(html).not.toContain('Obsolete draft title'); expect(html).toContain('data-testid="rt-rule-switch"'); expect(html).toContain('aria-checked="true"');
});
it('requests exact automatic configuration through the existing Orchestrator proposal tool', () => {
  const request = flowRequest('automate', { id: definition.id, name: definition.title, version: 1 });
  for (const value of ['app_flow_auto_propose', 'versione 1', 'cadenza', 'consumo AI', 'Non attivare o avviare nulla implicitamente']) expect(request).toContain(value);
});

it('keeps the newest completed run and its recorded evidence visible after work finishes', () => {
  const finished: FlowRun = { ...run, status: 'completed', updatedAt: 12, steps: [{ ...run.steps[0]!, status: 'completed', receipt: { id: 'finished-receipt', stepId: 'review', kind: 'user', at: 12, summary: 'Verified the selected document.', evidence: ['Selected revision 8'] } }] };
  const older: FlowRun = { ...finished, id: 'older-run', subjectKey: 'Old document', updatedAt: 7, steps: [{ ...finished.steps[0]!, receipt: { ...finished.steps[0]!.receipt!, summary: 'Older result.' } }] };
  flowState.set({ snapshot: { ...snapshot(), drafts: [], runs: [older, finished] }, error: null, loading: false });
  const html = renderToStaticMarkup(createElement(Flows));
  // no run open: the page opens on the routines; finished runs live in Storico, newest first
  expect(html).toContain('data-testid="rt-list"');
  const history = renderToStaticMarkup(createElement(RoutineHistory, { snapshot: flowState.get().snapshot! }));
  expect(history.match(/<tr aria-expanded/g)).toHaveLength(2);
});

it('offers import from an empty catalog without requiring an Orchestrator', () => {
  flowState.set({ snapshot: { contextKey: 'empty', drafts: [], versions: [], active: {}, runs: [] }, loading: false, error: null });
  const html = renderToStaticMarkup(createElement(Flows));
  expect(html).toContain('data-testid="flow-import-open"');
  expect(html).not.toMatch(/disabled=""[^>]*data-testid="flow-import-open"/);
});
it('exports the exact shown run version and offers all immutable versions in the picker', () => {
  const state = snapshot(); state.active[definition.id] = 2;
  state.versions.push({ ...state.versions[0]!, version: 2, definition: { ...definition, title: 'Current version' } });
  state.runs = [run];
  flowState.set({ snapshot: state, error: null, loading: false });
  const html = renderToStaticMarkup(createElement(Flows));
  // the run is open: the page opens on Adesso; the open routine exports its active version as JSON or Markdown
  expect(html).toContain('data-testid="rt-now"');
  const detail = renderToStaticMarkup(createElement(RoutineDetail, { snapshot: state, flowId: definition.id, onBack: vi.fn(), onStart: vi.fn(), onDryRun: vi.fn(), onAsk: vi.fn() }));
  expect(detail).toContain('Current version'); expect(detail).toContain('v2');
  expect(detail).toContain('data-testid="flow-export-json"'); expect(detail).toContain('data-testid="flow-export-markdown"');
});
it('keeps real run states, roles, evidence and receipts in the fullscreen inspection content', () => {
  const def = { ...definition, steps: [{ ...definition.steps[0]!, kind: 'agent' as const, role: 'sentinel' as const, tier: 'mid' as const }] };
  const recorded = { ...run, steps: [{ ...run.steps[0]!, status: 'blocked' as const, reason: 'Review required', receipt: { id: 'receipt', stepId: 'review', kind: 'user' as const, at: 1, summary: 'Recorded evidence summary', evidence: ['document: revision 3'] } }] };
  const html = renderToStaticMarkup(createElement(FlowFullscreenContent, { definition: def, run: recorded }));
  for (const value of ['flow-fullscreen-run', 'flow-diagram', 'flow-definition', 'Doc 1', 'sentinel', 'Review required', 'Recorded evidence summary', 'document: revision 3']) expect(html.toLowerCase()).toContain(value.toLowerCase());
  expect(html).not.toContain('flow-step-tier');
});
it('shows every fullscreen step description and resolved model before the optional diagram', () => {
  const state = snapshot();
  state.roles = { sentinel: { name: 'Sentinel', avatar: { kind: 'character', value: 'sentinel' }, tier: 'mid', tierMax: 'top', model: null, models: { mid: 'review-model' } } };
  flowState.set({ snapshot: state, error: null, loading: false });
  const def = { ...definition, steps: ['first', 'second', 'third'].map(id => ({ ...definition.steps[0]!, id, title: `Step ${id}`, instructions: `Complete description ${id}`, kind: 'agent' as const, role: 'sentinel' as const, tier: 'mid' as const })) };
  const html = renderToStaticMarkup(createElement(FlowFullscreenContent, { definition: def }));
  const primary = html.slice(0, html.indexOf('<details class="flow-fullscreen-diagram"'));
  expect(primary).toContain('<section class="flow-fullscreen-steps"');
  expect(primary.match(/class="flow-step"/g)).toHaveLength(3);
  expect(primary.match(/Sentinel · mid · review-model<\/span>/g)).toHaveLength(3);
  for (const step of def.steps) expect(primary).toContain(step.instructions);
  expect(primary).not.toContain('<details class="flow-full-definition"');
});
it('imports only in the displayed brain and never restores a stale brain when the import completes', async () => {
  const state = snapshot();
  expect(await importFlowDefinition('another-brain', '{}')).toBe(false); expect(invoke).not.toHaveBeenCalled();
  let complete!: (value: FlowSnapshot) => void; invoke.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const pending = importFlowDefinition(state.contextKey, '{"test":true}');
  expect(invoke).toHaveBeenCalledWith('flows:import', { contextKey: state.contextKey, content: '{"test":true}' });
  flowState.set({ snapshot: { ...state, contextKey: 'new-brain' }, loading: false, error: null });
  complete(state); expect(await pending).toBe(false); expect(flowState.get().snapshot?.contextKey).toBe('new-brain');
});
it('submits export for the exact selected version and prevents a late cross-brain download', async () => {
  const state = snapshot();
  let complete!: (value: { content: string; filename: string }) => void; invoke.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const pending = exportFlowDefinition(state.contextKey, definition.id, 1, 'markdown');
  expect(invoke).toHaveBeenCalledWith('flows:export', { contextKey: state.contextKey, flowId: definition.id, version: 1, format: 'markdown' });
  flowState.set({ snapshot: { ...state, contextKey: 'new-brain' }, loading: false, error: null });
  complete({ content: '# Definition', filename: 'flow.md' });
  await pending; // No document exists in this node test: a late download would throw and toast.
  expect(flowState.get().snapshot?.contextKey).toBe('new-brain');
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

it('exposes write reconciliation from cancelled run history', () => {
  const state = { ...snapshot(), runs: [{ ...run, status: 'cancelled' as const, steps: [{ ...run.steps[0]!, status: 'cancelled' as const }] }] };
  const html = renderToStaticMarkup(createElement(RoutineHistory, { snapshot: state }));
  expect(html).toContain('routine-reconcile-open'); expect(html).toContain('Riconcilia scritture');
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
