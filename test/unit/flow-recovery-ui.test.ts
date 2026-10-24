// Recovery previews and renderer controls preserve exact versions, prerequisite receipts and explicit native decisions.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import type { FlowDefinition, FlowRun, FlowSnapshot } from '../../src/shared/flows';
import type { ChatSummary } from '../../src/shared/contract';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke, on: vi.fn() } }));
import { flowRecoveryPreview, flowRecoveryQuestion } from '../../src/renderer/lib/flow-recovery';
import { flowAsks } from '../../src/renderer/lib/flow-ask';
import { FlowApproval } from '../../src/renderer/components/FlowApproval';
import { FlowRecoveryContent, FlowRecoveryQuestionFrame, FlowRunControls } from '../../src/renderer/components/FlowRunControls';
import { FlowFullscreenButton, FlowFullscreenContent } from '../../src/renderer/components/FlowFullscreen';
import { controlFlowRun, decideFlow, flowState } from '../../src/renderer/store/flows';
import { saveDecisionDraft } from '../../src/renderer/lib/decision-drafts';
import { app } from '../../src/renderer/store/store';
const step = (id: string, effect: 'read-only' | 'external-write' = 'read-only') => ({ id, title: `Passaggio ${id}`, kind: 'manual' as const, instructions: `Completa e documenta ${id}`, inputs: [], evidence: [], timeoutMs: 5000, maxAttempts: 1, effect });
const definition: FlowDefinition = { id: 'routine', title: 'Routine di revisione', description: 'Solo documenti selezionati', aliases: [], scope: {}, steps: [step('a'), step('b', 'external-write'), step('c')] };
const run: FlowRun = { id: 'source', revision: 4, flowId: definition.id, flowVersion: 1, definitionDigest: 'one', ownerOrchestratorId: 'owner', subjectKey: 'Documento selezionato', scope: {}, inputs: {}, status: 'blocked', currentStep: 1, steps: [{ stepId: 'a', status: 'completed', attempts: 1, receipt: { id: 'receipt-a', stepId: 'a', at: 1, kind: 'user', summary: 'Confermato', evidence: ['Documento confermato'] } }, { stepId: 'b', status: 'blocked', attempts: 0, reason: 'Attende approvazione scrittura' }, { stepId: 'c', status: 'pending', attempts: 0 }], createdAt: 1, updatedAt: 2 };
const snapshot = (): FlowSnapshot => ({ contextKey: 'brain', drafts: [], versions: [{ version: 1, digest: 'one', definition, draftRevision: 1, activatedAt: 1 }, { version: 2, digest: 'two', definition: { ...definition, steps: [step('new')] }, draftRevision: 2, activatedAt: 2 }], active: { routine: 2 }, runs: [structuredClone(run)] });
beforeEach(() => { invoke.mockReset(); flowState.set({ snapshot: snapshot(), error: null, loading: false }); app.set(state => ({ ...state, chats: { owner: { id: 'owner', title: 'Orchestrator documenti', state: 'idle' } as ChatSummary } })); });
it('keeps original version for a selected step and active version for a full restart', () => {
  const state = snapshot(), resume = flowRecoveryPreview(state, run, 'from-step', 'b'), restart = flowRecoveryPreview(state, run, 'from-start');
  expect(resume.version?.version).toBe(1); expect(resume.prefix.map(row => row.id)).toEqual(['a']); expect(resume.effects.map(row => row.id)).toEqual(['b']); expect(resume.reason).toBeNull();
  expect(restart.version?.version).toBe(2); expect(restart.prefix).toEqual([]); expect(restart.effects).toEqual([]);
  expect(flowRecoveryPreview(state, run, 'from-step', 'c').reason).toBe('prefix');
  expect(flowRecoveryPreview(state, { ...run, steps: run.steps.map(row => ({ ...row, receipt: undefined })) }, 'from-step', 'b').reason).toBe('prefix');
});
it('shows actionable blockers, all recovery choices and owner without starting anything on render', () => {
  const controls = renderToStaticMarkup(createElement(FlowRunControls, { run, onRequest: vi.fn() }));
  for (const text of ['Interrompi', 'Riprendi da un passaggio', 'Ricomincia', 'Orchestrator documenti', 'Attende approvazione scrittura']) expect(controls).toContain(text);
  const state = snapshot(); state.runs[0]!.currentStep = 2; flowState.set({ snapshot: state, error: null, loading: false });
  const html = renderToStaticMarkup(createElement(FlowRecoveryContent, { snapshot: state, run: state.runs[0]!, mode: 'from-step', onClose: vi.fn() }));
  expect(html).toContain('Prima completa questi passaggi'); expect(html).toContain('Passaggio b'); expect(html).toMatch(/disabled=""[^>]*data-testid="flow-recovery-yes"/); expect(invoke).not.toHaveBeenCalled();
});
it('hides stop for terminal history while keeping restart choices and original lineage visible', () => {
  const cancelled: FlowRun = { ...run, status: 'cancelled', restartOf: { runId: 'previous', stepId: 'b', expectedRevision: 3, mode: 'from-step' } };
  const html = renderToStaticMarkup(createElement(FlowRunControls, { run: cancelled, onRequest: vi.fn() }));
  expect(html).not.toContain('data-testid="flow-cancel"'); expect(html).toContain('data-testid="flow-restart"'); expect(html).toContain('previous'); expect(html).toContain('Interrotta');
});
it('refuses stale run, changed active version and different brain before a visible yes', () => {
  const state = snapshot(), changed = snapshot(); changed.active.routine = 1; flowState.set({ snapshot: changed, error: null, loading: false });
  const html = renderToStaticMarkup(createElement(FlowRecoveryContent, { snapshot: state, run, mode: 'from-start', onClose: vi.fn() }));
  expect(html).toContain('L’esecuzione o la versione è cambiata'); expect(html).toMatch(/disabled=""[^>]*data-testid="flow-recovery-yes"/);
});
it('binds automatic approval to current source rule while allowing a newly approved target version', () => {
  const state = snapshot(); state.automation = { revision: 4, paused: false, background: false, rules: [{ id: 'auto', revision: 3, approvedRevision: 3, status: 'enabled', ownerOrchestratorId: 'owner', config: { flowId: 'routine', flowVersion: 2, scope: {}, inputs: {}, priority: 'normal', trigger: { kind: 'interval', everyMinutes: 60 } }, createdAt: 1, updatedAt: 3, failures: 0 }], events: [{ id: 'event', ruleId: 'auto', ruleRevision: 1, runId: run.id, sourceKey: 'source', subjectKey: run.subjectKey, title: run.subjectKey, inputs: {}, createdAt: 1, updatedAt: 2, status: 'started', attempts: 1 }] };
  expect(flowRecoveryPreview(state, run, 'from-start')).toMatchObject({ reason: null, automationRule: { id: 'auto', revision: 3 } });
  const historical = { ...run, subjectKey: 'auto:auto:1:old-event-hash' }; state.automation.events = [];
  expect(flowRecoveryPreview(state, historical, 'from-start')).toMatchObject({ reason: null, automationRule: { id: 'auto', revision: 3 } });
  state.automation.events = [{ id: 'event', ruleId: 'auto', ruleRevision: 1, runId: run.id, sourceKey: 'source', subjectKey: run.subjectKey, title: run.subjectKey, inputs: {}, createdAt: 1, updatedAt: 2, status: 'started', attempts: 1 }];
  state.automation.paused = true; expect(flowRecoveryPreview(state, run, 'from-start').reason).toBe('automation');
  state.automation.paused = false; state.automation.rules[0]!.config.inputs = { document: 'changed' }; expect(flowRecoveryPreview(state, run, 'from-start').reason).toBe('automation');
});
it('routes cancel and restart proposals into native yes/no/other decisions, suppressing old step questions', async () => {
  const state = snapshot(); state.runs[0]!.pendingRecovery = { mode: 'from-step', stepId: 'b', revision: 1, requestedAt: 3, targetVersion: 1, targetDigest: 'one' }; flowState.set({ snapshot: state, error: null, loading: false });
  const ask = flowAsks(state)[0]!; expect(flowAsks(state)).toHaveLength(1); expect(ask.type).toBe('flow-restart');
  const html = renderToStaticMarkup(createElement(FlowApproval, { ask, onEscape: vi.fn() }));
  for (const text of ['Sì', 'No', 'Altro', 'v1', 'Passaggio b', 'scritture esterne', 'Passaggi precedenti conservati']) expect(html).toContain(text);
  expect(invoke).not.toHaveBeenCalled(); invoke.mockResolvedValue(state); await decideFlow(ask, 'other', 'Chiarisci gli effetti'); expect(invoke).toHaveBeenLastCalledWith('flows:restartDecide', { contextKey: 'brain', runId: 'source', expectedRevision: 4, answer: 'other', feedback: 'Chiarisci gli effetti' });
  delete state.runs[0]!.pendingRecovery; state.runs[0]!.pendingCancellation = { revision: 1, requestedAt: 4, reason: 'Fermare il lavoro' }; flowState.set({ snapshot: state, error: null, loading: false });
  const cancel = flowAsks(state)[0]!; expect(cancel.type).toBe('flow-cancel'); await decideFlow(cancel, 'yes'); expect(invoke).toHaveBeenLastCalledWith('flows:cancelDecide', { contextKey: 'brain', runId: 'source', expectedRevision: 4, answer: 'yes' });
});
it('sends only explicit pinned recovery and never installs late cross-brain results', async () => {
  expect((await controlFlowRun('other', { runId: 'source', expectedRevision: 4 })).ok).toBe(false); expect(invoke).not.toHaveBeenCalled();
  let complete!: (state: FlowSnapshot) => void; invoke.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const payload = { runId: 'source', expectedRevision: 4, mode: 'from-start' as const, targetVersion: 2, targetDigest: 'two', acknowledgeEffects: true };
  const pending = controlFlowRun('brain', payload); expect(invoke).toHaveBeenCalledWith('flows:restart', { ...payload, contextKey: 'brain' });
  flowState.set({ snapshot: { ...snapshot(), contextKey: 'new-brain' }, error: null, loading: false }); complete(snapshot()); expect((await pending).ok).toBe(false); expect(flowState.get().snapshot?.contextKey).toBe('new-brain');
});
it('keeps free text separate from execution and uses labelled icon-only fullscreen controls', () => {
  expect(flowRecoveryQuestion(run, definition, 'from-step', 'b', 'Spiega')).toContain('non approva né avvia');
  for (const expanded of [false, true]) { const html = renderToStaticMarkup(createElement(FlowFullscreenButton, { expanded, onClick: vi.fn() })); expect(html).toContain('<svg'); expect(html).toContain('aria-label='); expect(html).toContain('title='); expect(html).not.toMatch(/>Schermo intero<|>Esci da schermo intero</); }
});
it('shows all twenty long descriptions, model labels and the final step before optional fullscreen diagram', () => {
  const state = snapshot(); state.roles = { sentinel: { name: 'Sentinel', avatar: { kind: 'character', value: 'sentinel' }, tier: 'mid', tierMax: 'top', model: null, models: { mid: 'synthetic-reasoning-model-long-context-2026-10-24' } } }; flowState.set({ snapshot: state, error: null, loading: false });
  const long = { ...definition, description: 'Long complete description. '.repeat(60), steps: Array.from({ length: 20 }, (_, index) => ({ ...step(`s${index}`), kind: 'agent' as const, role: 'sentinel' as const, tier: 'mid' as const, instructions: `Step ${index}: ${'Inspect requirements, inputs, receipts and missing evidence. '.repeat(10)}` })) };
  const html = renderToStaticMarkup(createElement(FlowFullscreenContent, { definition: long })); const primary = html.slice(0, html.indexOf('<details class="flow-fullscreen-diagram"'));
  expect(primary.match(/class="flow-step"/g)).toHaveLength(20); for (const row of long.steps) expect(primary).toContain(row.instructions); expect(primary.match(/synthetic-reasoning-model-long-context-2026-10-24<\/span>/g)).toHaveLength(20);
});

it('restores postponed clarification drafts and makes recovery questions focusable with isolated Escape', () => {
  const state = snapshot(); state.runs[0]!.pendingRecovery = { mode: 'from-step', stepId: 'b', revision: 1, requestedAt: 3, targetVersion: 1, targetDigest: 'one' }; flowState.set({ snapshot: state, error: null, loading: false });
  const ask = flowAsks(state)[0]!; if (ask.type !== 'flow-restart') throw new Error('Expected recovery');
  saveDecisionDraft(`${ask.chatId}/${ask.id}`, 'Chiarisci gli effetti prima di procedere');
  const html = renderToStaticMarkup(createElement(FlowApproval, { ask, onEscape: vi.fn() }));
  expect(html).toContain('tabindex="0"'); expect(html).toContain('Chiarisci gli effetti prima di procedere'); expect(html).toContain('Completa e documenta b');
  const onEscape = vi.fn(), frame = FlowRecoveryQuestionFrame({ ask, onEscape, children: 'Question' });
  const event = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };
  frame.props.onKeyDown(event); expect(onEscape).toHaveBeenCalledOnce(); expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.stopPropagation).toHaveBeenCalledOnce(); expect(invoke).not.toHaveBeenCalled();
});

it('reports an unconfirmed stop as in progress without promising released capacity or rollback', () => {
  const pending: FlowRun = { ...run, status: 'cancelled', cancellation: { at: 3, by: 'user', expectedRevision: 4, reason: 'Arresto non ancora confermato', interruption: 'pending' } };
  const html = renderToStaticMarkup(createElement(FlowRunControls, { run: pending, onRequest: vi.fn() }));
  expect(html).toContain('Interruzione in corso'); expect(html).toContain('Arresto non ancora confermato'); expect(html).toContain('possono completarsi'); expect(html).not.toContain('Interrotta:');
});
