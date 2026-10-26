// The Routine page's parts (ADR 0155, mockup B v2 in docs/mockups/routines/): «Adesso» (what needs the user first,
// then the runs working by themselves), «Routine» (each routine in plain words, its trigger and queue), the open
// routine (steps with role, engine and model the user can switch for experiments, scripts by hash, «se fallisce»,
// trigger filters, queue), «Storico» (finished runs with their receipts), the start dialog (one work item with its
// preview, a pasted list or a file as attachment, typed params) and the dry-run. A prod command runs only from its
// «Esegui» button here. Used by brain/pages/Flows.tsx.
import { useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { FlowDefinition, FlowDryRun, FlowItemPreview, FlowRun, FlowSnapshot, FlowStep, FlowVersion } from '@shared/flows';
import type { FlowAutomationRule } from '@shared/flow-automation';
import type { Effort } from '@shared/contract';
import { roleOf } from '@shared/routine';
import { flowAsks } from '../lib/flow-ask';
import { openQueue } from '../lib/later';
import { activeVersion, ago, definitionOf, duration, itemOf, lastHeal, list, needsYou, prodSteps, queued, retrying, ruleFor, stepLook, working, type StepLook } from '../lib/routine-view';
import { stepAgentLabel } from '../lib/flow-step-agent';
import { FlowConnectorDetails } from './FlowExecutionDetails';
import { FlowBrowserDetails } from './FlowDefinition';
import { RoutineInspect } from './RoutineInspect';
import { RoutineExport } from './RoutinePackage';
import { controlFlowAutomation, decideFlow, exportFlowDefinition, flowState, plain, routineControl } from '../store/flows';
import { sb } from '../sb';
import { toast } from '../store/ui';
import { useApp } from '../store/store';
import { openChatRef } from '../actions';
import { t, locale } from '../i18n';
import { AgentAvatar } from './AgentAvatar';
import { Modal } from './ui';

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const short = (hash?: string) => hash ? `${hash.slice(0, 4)}…${hash.slice(-2)}` : '';

function Switch({ on, label, disabled, onChange, testid }: { on: boolean; label: string; disabled?: boolean; onChange: (on: boolean) => void; testid?: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`rt-switch${on ? ' on' : ''}`} onClick={() => onChange(!on)} data-testid={testid}><span aria-hidden="true" /></button>;
}
function Chip({ tone, children, title }: { tone?: 'green' | 'red' | 'amber' | 'blue' | 'mono'; children: ReactNode; title?: string }) {
  return <span className="rt-chip" data-tone={tone} title={title}>{children}</span>;
}
/** One routine's toggle: its approved DevOps/interval trigger on or paused. A routine without a trigger has none. */
function RuleSwitch({ snapshot, rule }: { snapshot: FlowSnapshot; rule?: FlowAutomationRule }) {
  const [busy, setBusy] = useState(false);
  if (!rule || rule.approvedRevision !== rule.revision || !['enabled', 'paused'].includes(rule.status)) return null;
  return <Switch on={rule.status === 'enabled'} label={t('rt.toggle')} disabled={busy || !!snapshot.automation?.storageError} testid="rt-rule-switch"
    onChange={async on => { setBusy(true); try { await controlFlowAutomation(snapshot.contextKey, { id: rule.id, expectedRevision: rule.revision, paused: !on }); } finally { setBusy(false); } }} />;
}
function triggerText(rule?: FlowAutomationRule): string {
  if (!rule) return t('rt.manualOnly');
  const trigger = rule.config.trigger;
  return trigger.kind === 'manual' ? t('flows.manualTrigger') : trigger.kind === 'devops' ? t('rt.trigDevops', { type: trigger.workItemType }) : t('rt.trigEvery', { min: trigger.everyMinutes });
}
function FilterChips({ rule }: { rule: FlowAutomationRule }) {
  const trigger = rule.config.trigger;
  if (trigger.kind !== 'devops') return <span className="rt-muted">—</span>;
  const chips = [...(trigger.includeTags ?? []).map(tag => <Chip key={`+${tag}`} tone="green">+ {tag}</Chip>), ...(trigger.excludeTags ?? []).map(tag => <Chip key={`-${tag}`} tone="red">− {tag}</Chip>),
    ...(trigger.iterationPath ? [<Chip key="it">{trigger.iterationPath}</Chip>] : []), ...(trigger.workItemIds?.length ? [<Chip key="ids">#{trigger.workItemIds.join(', #')}</Chip>] : []),
    ...(trigger.maxPerHour ? [<Chip key="max">{t('rt.maxHour', { n: trigger.maxPerHour })}</Chip>] : [])];
  return chips.length ? <span className="rt-chips">{chips}</span> : <span className="rt-muted">{t('rt.all')}</span>;
}

/** The proposal of this routine waiting for the user (a new version or its trigger), reopened in the questions window. */
const proposalOf = (snapshot: FlowSnapshot, flowId: string) => flowAsks(snapshot).find(ask => (ask.type === 'flow-definition' && ask.draft.definition.id === flowId) || (ask.type === 'flow-automation' && ask.rule.config.flowId === flowId));
function DecideButton({ snapshot, flowId }: { snapshot: FlowSnapshot; flowId: string }) {
  const ask = proposalOf(snapshot, flowId);
  return ask ? <button type="button" className="btn btn-amber btn-s" onClick={() => openQueue(`${ask.chatId}/${ask.id}`)} data-testid="rt-proposal">{t(ask.type === 'flow-automation' ? 'rt.decideTrigger' : 'rt.decideVersion')}</button> : null;
}

// ---------------------------------------------------------------- Adesso

/** A prod step's card: the exact command, what was proven before, «Esegui» (the only way it runs). */
function ProdCard({ snapshot, run, definition }: { snapshot: FlowSnapshot; run: FlowRun; definition?: FlowDefinition }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [later, setLater] = useState(false);
  const step = definition?.steps[run.currentStep], done = run.steps.filter(s => s.status === 'completed' && s.receipt);
  if (!run.awaitingUser || !step) return null;
  const go = async () => {
    setBusy(true); setError(null);
    const failed = await routineControl('flows:runCommand', snapshot.contextKey, { runId: run.id, expectedRevision: run.revision, stepId: step.id, command: run.awaitingUser!.command });
    setBusy(false); if (failed) setError(failed);
  };
  return <article className="rt-card rt-you rt-prod" data-collapsed={later || undefined} data-testid="rt-prod-card">
    <header className="rt-card-head"><span className="rt-mark">{(definition?.title ?? run.flowId).charAt(0)}</span><strong>{definition?.title ?? run.flowId}</strong>
      <span className="rt-muted">{t('rt.stepOf', { at: run.currentStep + 1, of: run.steps.length })}</span><Chip tone="red">prod</Chip><span className="rt-sp" /><span className="rt-muted">{t('rt.waitingSince', { ago: ago(run.awaitingUser.at) })}</span></header>
    <RoutineInspect snapshot={snapshot} definition={definition} run={run} />
    <h3 className="rt-q">{t('rt.prodQuestion', { step: step.title })}</h3>
    {!later && <div className="rt-prod-body">
      <div className="rt-prod-main">
        <pre className="rt-cmd" data-testid="rt-prod-command">{run.awaitingUser.command}</pre>
        <ul className="rt-proof">
          {done.slice(-3).map(s => <li key={s.stepId}>✓ {definition?.steps.find(d => d.id === s.stepId)?.title}: {s.receipt!.summary}</li>)}
          {step.action?.hash && <li>✓ {t('rt.pinned', { ref: step.action.ref, hash: short(step.action.hash) })}</li>}
          {itemOf(run) && <li>{itemOf(run)!.url ? <a href={itemOf(run)!.url} target="_blank" rel="noreferrer">{itemOf(run)!.title}</a> : itemOf(run)!.title}</li>}
        </ul>
      </div>
      <div className="rt-prod-side">
        <button type="button" className="rt-run" disabled={busy} onClick={() => void go()} data-testid="rt-prod-run">{busy ? t('rt.running') : `▶ ${t('rt.run')}`}</button>
        <p className="rt-then"><b>{t('rt.then')}</b> {t('rt.thenText')}</p>
        <button type="button" className="btn btn-ghost btn-s" onClick={() => setLater(true)}>{t('rt.later')}</button>
      </div>
    </div>}
    {later && <button type="button" className="btn btn-ghost btn-s" onClick={() => setLater(false)}>{t('rt.show')}</button>}
    {error && <p className="flow-block" role="alert">{error}</p>}
  </article>;
}
/** A run that stopped for the user: the reason in words and what they can do. */
function StoppedCard({ snapshot, run, definition, onRecovery }: { snapshot: FlowSnapshot; run: FlowRun; definition?: FlowDefinition; onRecovery: (run: FlowRun, mode: 'from-step' | 'from-start' | 'cancel') => void }) {
  const step = run.steps[run.currentStep], spec = definition?.steps[run.currentStep];
  const ask = flowAsks(snapshot).find(a => (a.type === 'flow-run' || a.type === 'flow-restart' || a.type === 'flow-cancel') && a.run.id === run.id);
  const canRetry = run.status === 'blocked' && !!spec && !!step && step.attempts < spec.maxAttempts && ask?.type === 'flow-run';
  return <article className="rt-card rt-you" data-testid="rt-stopped-card">
    <header className="rt-card-head"><span className="rt-mark">{(definition?.title ?? run.flowId).charAt(0)}</span><strong>{definition?.title ?? run.flowId}</strong>
      <span className="rt-muted">{t('rt.stepOf', { at: run.currentStep + 1, of: run.steps.length })}</span><span className="rt-sp" /><span className="rt-muted">{ago(run.updatedAt)}</span></header>
    <h3 className="rt-q">{run.status === 'approval' ? t('rt.gate', { step: spec?.title ?? '' }) : t('rt.stopped', { step: spec?.title ?? '' })}</h3>
    {itemOf(run) && <p className="rt-muted">{itemOf(run)!.url ? <a href={itemOf(run)!.url} target="_blank" rel="noreferrer">{itemOf(run)!.title}</a> : itemOf(run)!.title}</p>}
    {step?.reason && <p className="rt-reason">{step.reason}</p>}
    {spec && <><FlowBrowserDetails step={spec} run={run} /><FlowConnectorDetails step={spec} run={run} /></>}
    <div className="rt-actions">
      <RoutineInspect snapshot={snapshot} definition={definition} run={run} />
      {canRetry && <button type="button" className="btn btn-primary btn-s" onClick={() => void decideFlow(ask, 'yes')} data-testid="rt-retry">{t('rt.retry')}</button>}
      {ask && !canRetry && <button type="button" className="btn btn-amber btn-s" onClick={() => openQueue(`${ask.chatId}/${ask.id}`)} data-testid="rt-decide">{t('rt.decide')}</button>}
      <button type="button" className="btn btn-ghost btn-s" onClick={() => onRecovery(run, 'from-step')} data-testid="rt-from-step">{t('rt.fromStep')}</button>
      <button type="button" className="btn btn-ghost btn-s" onClick={() => onRecovery(run, 'from-start')} data-testid="rt-from-start">{t('rt.fromStart')}</button>
      <button type="button" className="btn btn-ghost btn-s" onClick={() => onRecovery(run, 'cancel')} data-testid="rt-cancel">{t('rt.cancel')}</button>
    </div>
  </article>;
}
const LOOK_DOT: Record<StepLook, string> = { done: 'done', now: 'now', retry: 'retry', you: 'you', todo: 'todo', sent: 'retry' };
function WorkingCard({ snapshot, run, definition, onRecovery, open, onToggle }: { snapshot: FlowSnapshot; run: FlowRun; definition?: FlowDefinition; onRecovery: (run: FlowRun, mode: 'from-step' | 'from-start' | 'cancel') => void; open: boolean; onToggle: () => void }) {
  const roles = snapshot.roles ?? {}, heal = lastHeal(run), item = itemOf(run);
  const [busy, setBusy] = useState(false);
  // the chat working on the current step, while it still exists
  const chatId = run.steps[run.currentStep]?.chatId, chat = useApp(s => chatId && s.chats[chatId] ? chatId : null);
  const pause = async () => { setBusy(true); const failed = await routineControl('flows:pauseRun', snapshot.contextKey, { runId: run.id, expectedRevision: run.revision, paused: !run.paused }); setBusy(false); if (failed) toast(failed, 'err'); };
  const healed = heal && run.status !== 'blocked' && run.steps[run.currentStep]?.stepId === (heal.to ?? heal.stepId);
  const steps = definition?.steps ?? [];
  const next = steps.slice(run.currentStep + 1);
  return <article className="rt-card rt-work" data-paused={run.paused ? true : undefined} data-testid="rt-working-card">
    <button type="button" className="rt-work-head" aria-expanded={open} onClick={onToggle}>
      <span className="rt-dot" data-look={run.paused ? 'todo' : retrying(snapshot, run) ? 'retry' : 'now'} />
      <strong>{item?.title ?? definition?.title ?? run.flowId}</strong>
      <span className="rt-muted">{definition?.title}{item?.id ? ` · #${item.id}` : ''} · {t('rt.stepShort', { at: run.currentStep + 1, title: steps[run.currentStep]?.title ?? '' })}{run.paused ? ` · ${t('rt.pausedBadge')}` : ''}</span>
      <span className="rt-sp" />
      {!open && <span className="rt-segs" aria-hidden="true">{run.steps.map((_, i) => <i key={i} data-look={LOOK_DOT[stepLook(snapshot, run, i)]} />)}</span>}
    </button>
    {open && <>
      {(healed || retrying(snapshot, run)) && heal && <p className="rt-heal" data-testid="rt-heal">↻ {heal.action === 'goto'
        ? t('rt.healGoto', { from: steps.find(s => s.id === heal.stepId)?.title ?? heal.stepId, to: steps.find(s => s.id === heal.to)?.title ?? heal.to ?? '' })
        : t('rt.healRetry', { step: steps.find(s => s.id === heal.stepId)?.title ?? heal.stepId })} <span className="rt-muted">«{heal.reason.slice(0, 160)}»</span> · {t('rt.healAttempt', { at: heal.attempt, of: steps.find(s => s.id === (heal.to ?? heal.stepId))?.maxAttempts ?? heal.attempt })}<span className="rt-sp" /><span className="rt-muted">{t('rt.healCallsYou')}</span></p>}
      <ol className="rt-steps">
        {steps.slice(0, run.currentStep + 1).map((spec, i) => {
          const look = stepLook(snapshot, run, i), state = run.steps[i]!;
          return <li key={spec.id} data-look={look}><span className="rt-dot" data-look={LOOK_DOT[look]} />
            <div><b>{i + 1} · {spec.title}</b> <span className="rt-muted">{spec.kind === 'agent' ? stepAgentLabel(spec, roles[roleOf(spec)]) : spec.action?.kind === 'script' || spec.action?.kind === 'query' ? `${spec.action.ref}${state.status === 'running' && state.startedAt ? ` · ${duration(Date.now() - state.startedAt)}` : ''}` : t(`rt.k.${spec.kind}`)}{state.status === 'running' && state.startedAt && spec.kind === 'agent' ? ` · ${duration(Date.now() - state.startedAt)}` : ''}{state.attempts > 1 ? ` · ${t('rt.round', { n: state.attempts })}` : ''}</span>{state.receipt?.summary && <span className="rt-muted rt-proofline" title={state.receipt.summary}>{state.receipt.summary}</span>}<FlowBrowserDetails step={spec} run={run} /><FlowConnectorDetails step={spec} run={run} /></div>
            <Chip tone={look === 'done' ? 'green' : look === 'now' ? 'blue' : look === 'you' ? 'red' : look === 'todo' ? undefined : 'amber'}>{t(`rt.s.${look}`)}</Chip></li>;
        })}
        {next.length > 0 && <li data-look="todo"><span className="rt-dot" data-look="todo" /><span className="rt-muted">{t('rt.next')}: {next.map((s, i) => `${run.currentStep + 2 + i} · ${s.title}`).join(' → ')}</span><Chip>{t('rt.s.todo')}</Chip></li>}
      </ol>
      <footer className="rt-actions">
        <RoutineInspect snapshot={snapshot} definition={definition} run={run} />
        {item?.url && <a className="btn btn-ghost btn-s" href={item.url} target="_blank" rel="noreferrer">{t('rt.openItem')}</a>}
        {chat && <button type="button" className="btn btn-ghost btn-s" onClick={() => openChatRef(chat)} data-testid="flow-open-agent">{t('flows.openAgent')}</button>}
        <span className="rt-sp" />
        <button type="button" className="btn btn-ghost btn-s" disabled={busy} onClick={() => void pause()} data-testid="rt-pause">{run.paused ? `▶ ${t('rt.resume')}` : `❚❚ ${t('rt.pause')}`}</button>
        <button type="button" className="btn btn-ghost btn-s" onClick={() => onRecovery(run, 'cancel')}>{t('rt.cancel')}</button>
        <span className="rt-muted">{t('rt.updated', { ago: ago(run.updatedAt) })}</span>
      </footer>
    </>}
  </article>;
}
export function RoutineNow({ snapshot, onRecovery }: { snapshot: FlowSnapshot; onRecovery: (run: FlowRun, mode: 'from-step' | 'from-start' | 'cancel') => void }) {
  const runs = [...snapshot.runs].sort((a, b) => b.updatedAt - a.updatedAt);
  const yours = runs.filter(run => needsYou(snapshot, run)), busy = runs.filter(run => working(snapshot, run));
  const [opened, setOpened] = useState<string | null>(null);
  const shown = opened && busy.some(run => run.id === opened) ? opened : busy[0]?.id;
  return <div className="rt-now" data-testid="rt-now">
    {snapshot.runner?.owner === 'other' && <p className="rt-note" role="status">{t('rt.otherRunner')}</p>}
    {yours.length > 0 && <section><div className="rt-sec"><span className="rt-label">{t('rt.yours')} · {yours.length}</span><span className="rt-muted">{t('rt.yoursWhy')}</span></div>
      {yours.map(run => run.awaitingUser
        ? <ProdCard key={run.id} snapshot={snapshot} run={run} definition={definitionOf(snapshot, run)} />
        : <StoppedCard key={run.id} snapshot={snapshot} run={run} definition={definitionOf(snapshot, run)} onRecovery={onRecovery} />)}
    </section>}
    <section><div className="rt-sec"><span className="rt-label">{t('rt.working')} · {busy.length}</span><span className="rt-muted">{t('rt.workingWhy')}</span><span className="rt-sp" />
      <span className="rt-legend"><span><i className="rt-dot" data-look="done" />{t('rt.s.done')}</span><span><i className="rt-dot" data-look="now" />{t('rt.s.now')}</span><span><i className="rt-dot" data-look="retry" />{t('rt.s.retry')}</span><span><i className="rt-dot" data-look="you" />{t('rt.s.you')}</span></span></div>
      {busy.length ? busy.map(run => <WorkingCard key={run.id} snapshot={snapshot} run={run} definition={definitionOf(snapshot, run)} onRecovery={onRecovery} open={run.id === shown} onToggle={() => setOpened(run.id === shown ? '' : run.id)} />)
        : <p className="rt-calm">{yours.length ? t('rt.calmBusy') : t('rt.calm')}</p>}
    </section>
  </div>;
}

// ---------------------------------------------------------------- Routine

export function RoutineList({ snapshot, onOpen }: { snapshot: FlowSnapshot; onOpen: (flowId: string) => void }) {
  const ids = [...new Set([...snapshot.versions.map(v => v.definition.id), ...snapshot.drafts.map(d => d.definition.id)])];
  return <div className="rt-grid" data-testid="rt-list">{ids.map(id => {
    const version = activeVersion(snapshot, id), draft = snapshot.drafts.filter(d => d.definition.id === id).sort((a, b) => b.revision - a.revision)[0];
    const definition = version?.definition ?? draft!.definition, rule = ruleFor(snapshot, id), waiting = rule ? queued(snapshot, rule.id) : [];
    const runs = snapshot.runs.filter(run => run.flowId === id).sort((a, b) => b.updatedAt - a.updatedAt), last = runs.find(run => run.status === 'completed'), open = runs.filter(run => run.status !== 'completed' && run.status !== 'cancelled');
    const prod = prodSteps(definition), status = !version ? 'draft' : rule?.status === 'paused' ? 'paused' : 'active';
    return <article key={id} className="rt-card rt-rcard" data-status={status} data-testid="rt-routine-card"
      // the whole card opens the routine; its own switch and links keep their click
      onClick={e => { if (!(e.target as HTMLElement).closest('button, a, input, label')) onOpen(id); }}>
      <header className="rt-card-head"><RuleSwitch snapshot={snapshot} rule={rule} /><button type="button" className="rt-title-btn" onClick={() => onOpen(id)}>{definition.title}</button><span className="rt-sp" />
        <Chip tone={status === 'active' ? 'green' : status === 'paused' ? undefined : 'amber'}>{t(status === 'active' ? 'rt.active' : status === 'paused' ? 'rt.pausedBadge' : 'rt.draft')}</Chip>{version && <Chip>v{version.version}</Chip>}</header>
      <p className="rt-desc">{definition.description}</p>
      {proposalOf(snapshot, id) && <p className="rt-actions"><DecideButton snapshot={snapshot} flowId={id} /></p>}
      <dl className="rt-kv">
        <dt>{t('rt.when')}</dt><dd>{triggerText(rule)}{rule?.config.trigger.kind === 'devops' && <> <Chip>{rule.config.trigger.areaPath}</Chip></>}</dd>
        {rule?.config.trigger.kind === 'devops' && <><dt>{t('rt.onlyIf')}</dt><dd><FilterChips rule={rule} /></dd></>}
        {prod.length > 0 && <><dt>{t('rt.prod')}</dt><dd><Chip tone="red">{t('rt.prodSteps', { n: prod.length })}</Chip></dd></>}
        {rule && <><dt>{t('rt.waiting')}</dt><dd>{waiting.length ? <><Chip tone="amber">{t('rt.events', { n: waiting.length })}</Chip> <button type="button" className="rt-link" onClick={() => onOpen(id)}>{t('rt.clear')}</button></> : t('rt.none')}</dd></>}
        <dt>{t('rt.last')}</dt><dd>{[last ? `${ago(last.updatedAt)} ✓` : '', open.length ? t('rt.inProgress', { n: open.length }) : ''].filter(Boolean).join(' · ') || '—'}</dd>
      </dl>
    </article>;
  })}</div>;
}

// ---------------------------------------------------------------- open routine

function StepModel({ snapshot, version, step }: { snapshot: FlowSnapshot; version: FlowVersion; step: FlowStep }) {
  const engines = snapshot.engines ?? [], roleId = roleOf(step), role = snapshot.roles?.[roleId], [busy, setBusy] = useState(false);
  const engine = engines.find(e => e.id === step.engine);
  const apply = async (patch: { engine?: string | null; model?: string | null; effort?: Effort | null }) => {
    setBusy(true);
    const next = { engine: step.engine ?? null, model: step.model ?? null, effort: step.effort ?? null, ...patch };
    if (patch.engine !== undefined && patch.model === undefined) next.model = null;
    const failed = await routineControl('flows:editStepModel', snapshot.contextKey, { flowId: version.definition.id, version: version.version, stepId: step.id, ...next });
    setBusy(false); if (failed) toast(failed, 'err'); else toast(t('rt.modelSaved'), 'info');
  };
  if (step.kind !== 'agent') return null;
  return <span className="rt-model" data-testid="rt-step-model">
    <select aria-label={t('rt.engine')} disabled={busy} value={step.engine ?? ''} onChange={e => void apply({ engine: e.target.value || null })}>
      <option value="">{t('rt.engineOf', { name: role?.name ?? roleId })}</option>{engines.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
    <select aria-label={t('rt.model')} disabled={busy} value={step.model ?? ''} onChange={e => void apply({ model: e.target.value || null })}>
      <option value="">{step.engine ? t('rt.engineDefault') : role?.models?.[step.tier ?? role.tier] ?? role?.model ?? t('rt.byRole')}</option>
      {(engine ?? engines.find(e => e.models.includes(step.model ?? '')) ?? { models: engines.flatMap(e => e.models) }).models.map(m => <option key={m} value={m}>{m}</option>)}</select>
    <select aria-label={t('rt.effort')} disabled={busy} value={step.effort ?? ''} onChange={e => void apply({ effort: (e.target.value || null) as Effort | null })}>
      <option value="">{t('rt.effortRole')}</option>{EFFORTS.map(v => <option key={v} value={v}>{t(`rt.e.${v}`)}</option>)}</select>
  </span>;
}
function FiltersEditor({ snapshot, rule, onDone }: { snapshot: FlowSnapshot; rule: FlowAutomationRule; onDone: () => void }) {
  const trigger = rule.config.trigger.kind === 'devops' ? rule.config.trigger : undefined;
  const [inc, setInc] = useState((trigger?.includeTags ?? []).join(', ')), [exc, setExc] = useState((trigger?.excludeTags ?? []).join(', '));
  const [ids, setIds] = useState((trigger?.workItemIds ?? []).join(', ')), [iteration, setIteration] = useState(trigger?.iterationPath ?? ''), [max, setMax] = useState(trigger?.maxPerHour ? String(trigger.maxPerHour) : '');
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const save = async () => {
    const numbers = list(ids).map(Number);
    if (numbers.some(n => !Number.isSafeInteger(n) || n < 1) || (max && !/^\d{1,4}$/.test(max))) { setError(t('rt.filtersInvalid')); return; }
    setBusy(true);
    const failed = await routineControl('flows:editFilters', snapshot.contextKey, { id: rule.id, expectedRevision: rule.revision, includeTags: list(inc), excludeTags: list(exc), workItemIds: numbers, ...(iteration.trim() ? { iterationPath: iteration.trim() } : {}), ...(max ? { maxPerHour: Number(max) } : {}) });
    setBusy(false); if (failed) setError(failed); else onDone();
  };
  return <div className="rt-filters" data-testid="rt-filters-edit">
    <label>{t('rt.tagsIn')}<input value={inc} onChange={e => setInc(e.target.value)} placeholder={t('rt.tagsPh')} /></label>
    <label>{t('rt.tagsOut')}<input value={exc} onChange={e => setExc(e.target.value)} placeholder={t('rt.tagsPh')} /></label>
    <label>{t('rt.ids')}<input value={ids} onChange={e => setIds(e.target.value)} placeholder={t('rt.idsPh')} /></label>
    <label>{t('rt.iteration')}<input value={iteration} onChange={e => setIteration(e.target.value)} placeholder={trigger?.project ?? ''} /></label>
    <label>{t('rt.limit')}<input value={max} onChange={e => setMax(e.target.value)} placeholder={t('rt.maxPh')} inputMode="numeric" /></label>
    {error && <p className="flow-block" role="alert">{error}</p>}
    <div className="rt-actions"><span className="rt-sp" /><button type="button" className="btn btn-ghost btn-s" onClick={onDone}>{t('rt.close')}</button><button type="button" className="btn btn-primary btn-s" disabled={busy} onClick={() => void save()}>{t('rt.save')}</button></div>
  </div>;
}
function Queue({ snapshot, rule }: { snapshot: FlowSnapshot; rule: FlowAutomationRule }) {
  const waiting = queued(snapshot, rule.id), [asking, setAsking] = useState<number | null>(null), [busy, setBusy] = useState(false);
  const clear = async () => {
    setBusy(true);
    const failed = await routineControl('flows:clearQueue', snapshot.contextKey, { id: rule.id, count: asking! });
    setBusy(false); setAsking(null); if (failed) toast(failed, 'err');
  };
  return <section className="rt-card rt-side" data-testid="rt-queue"><div className="rt-sec"><span className="rt-label">{t('rt.queue')} · {waiting.length}</span><span className="rt-sp" />
    {waiting.length > 0 && asking === null && <button type="button" className="btn btn-danger btn-s" onClick={() => setAsking(waiting.length)} data-testid="rt-clear">{t('rt.clearN', { n: waiting.length })}</button>}</div>
    {asking !== null && <div className="rt-confirm"><p>{t('rt.clearQ', { n: asking })}</p><div className="rt-actions"><span className="rt-sp" /><button type="button" className="btn btn-ghost btn-s" onClick={() => setAsking(null)}>{t('rt.keep')}</button><button type="button" className="btn btn-danger btn-s" disabled={busy} onClick={() => void clear()} data-testid="rt-clear-yes">{t('rt.clearYes')}</button></div></div>}
    {waiting.length === 0 ? <p className="rt-muted">{t('rt.queueEmpty')}</p> : <ul className="rt-qlist">{waiting.slice(0, 5).map(event => <li key={event.id}><span>{event.title}</span><span className="rt-muted">{new Date(event.createdAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}</span></li>)}</ul>}
    {waiting.length > 5 && <p className="rt-muted">{t('rt.moreQueued', { n: waiting.length - 5 })}</p>}
  </section>;
}
export function RoutineDetail({ snapshot, flowId, onBack, onStart, onDryRun, onAsk }: { snapshot: FlowSnapshot; flowId: string; onBack: () => void; onStart: (flowId: string) => void; onDryRun: (flowId: string) => void; onAsk: (version?: FlowVersion) => void }) {
  const version = activeVersion(snapshot, flowId), draft = snapshot.drafts.filter(d => d.definition.id === flowId).sort((a, b) => b.revision - a.revision)[0];
  const definition = version?.definition ?? draft?.definition, rule = ruleFor(snapshot, flowId), [editing, setEditing] = useState(false), [packing, setPacking] = useState(false);
  if (!definition) return null;
  const trigger = rule?.config.trigger.kind === 'devops' ? rule.config.trigger : undefined;
  return <div className="rt-detail" data-testid="rt-detail">
    <header className="rt-detail-head"><button type="button" className="btn btn-ghost btn-s" onClick={onBack}>‹ {t('rt.title')}</button><RuleSwitch snapshot={snapshot} rule={rule} /><h2>{definition.title}</h2>{version && <Chip>v{version.version}</Chip>}<span className="rt-sp" />
      {version && <><span className="rt-export" data-testid="rt-export"><button type="button" className="btn btn-ghost btn-s" title={t('rt.exportPackTip')} onClick={() => setPacking(true)} data-testid="rt-export-package">⇪ {t('rt.exportPack')}</button><button type="button" className="btn btn-ghost btn-s" title={t('rt.exportJsonTip')} onClick={() => void exportFlowDefinition(snapshot.contextKey, flowId, version.version, 'json')} data-testid="flow-export-json">JSON</button><button type="button" className="btn btn-ghost btn-s" onClick={() => void exportFlowDefinition(snapshot.contextKey, flowId, version.version, 'markdown')} data-testid="flow-export-markdown">Markdown</button></span>
        <button type="button" className="btn btn-ghost btn-s" onClick={() => onDryRun(flowId)} data-testid="rt-dry">◎ {t('rt.dry')}</button></>}
      <RoutineInspect snapshot={snapshot} definition={definition} version={version?.version} />
      <DecideButton snapshot={snapshot} flowId={flowId} />
      <button type="button" className="btn btn-ghost btn-s" onClick={() => onAsk(version)}>✎ {t('rt.edit')}</button>
      {version && <button type="button" className="btn btn-primary btn-s" onClick={() => onStart(flowId)} data-testid="rt-start-here">▶ {t('rt.start')}</button>}</header>
    {packing && version && <RoutineExport contextKey={snapshot.contextKey} flowId={flowId} version={version.version} onClose={() => setPacking(false)} />}
    <p className="rt-desc">{definition.description}</p>
    <div className="rt-detail-body">
      <section><div className="rt-sec"><span className="rt-label">{t('rt.steps')}</span></div>
        <ol className="rt-pipe">{definition.steps.map((step, i) => {
          const prod = step.env === 'prod' || step.effect === 'production', role = step.kind === 'agent' ? snapshot.roles?.[roleOf(step)] : undefined;
          return <li key={step.id} data-prod={prod || undefined}><span className="rt-num">{i + 1}</span><div className="rt-card rt-step">
            <header className="rt-card-head"><strong>{step.title}</strong><span className="rt-sp" />
              {step.kind === 'agent' && <span className="rt-who">{role && <AgentAvatar avatar={role.avatar} name={role.name} size={18} />}{role?.name ?? roleOf(step)}</span>}
              {version && <StepModel snapshot={snapshot} version={version} step={step} />}
              {step.kind !== 'agent' && <Chip tone={prod ? 'red' : step.kind === 'check' ? 'green' : 'amber'}>{prod ? t('rt.prodYou') : step.kind === 'check' ? t('rt.auto') : t(`rt.k.${step.kind}`)}</Chip>}</header>
            {step.kind === 'agent' && !step.role && <p className="rt-muted">{t('rt.roleAuto')}</p>}
            <p className="rt-muted rt-instr">{step.instructions}</p>
            <FlowBrowserDetails step={step} />
            <span className="rt-chips">
              {(step.action?.kind === 'script' || step.action?.kind === 'query') && <Chip tone="mono" title={step.action.hash}>{t(step.action.kind === 'script' ? 'rt.script' : 'rt.query')} {step.action.ref} · sha {short(step.action.hash)} ✓</Chip>}
              {step.args && Object.entries(step.args).map(([k, v]) => <Chip key={k} tone="mono">-{k} {v}</Chip>)}
              {step.env && <Chip tone={step.env === 'prod' ? 'red' : 'blue'}>{step.env}</Chip>}
              {step.kind !== 'approval' && step.kind !== 'manual' && !prod && <Chip tone="amber">{step.onFail ? t('rt.ifFails', { to: (definition.steps.findIndex(s => s.id === step.onFail!.goto) + 1), max: step.maxAttempts }) : t('rt.ifFailsSelf', { max: step.maxAttempts })}</Chip>}
            </span>
          </div></li>;
        })}</ol>
        <p className="rt-muted">{t('rt.modelHint')}</p>
      </section>
      <aside className="rt-detail-side">
        <section className="rt-card rt-side"><div className="rt-sec"><span className="rt-label">{t('rt.when')}</span><span className="rt-sp" />{trigger && !editing && <button type="button" className="btn btn-ghost btn-s" onClick={() => setEditing(true)} data-testid="rt-filters-open">{t('rt.editFilters')}</button>}</div>
          {editing && rule ? <FiltersEditor snapshot={snapshot} rule={rule} onDone={() => setEditing(false)} /> : <dl className="rt-kv">
            <dt>{t('rt.event')}</dt><dd>{triggerText(rule)}</dd>
            {trigger && <><dt>{t('rt.area')}</dt><dd><Chip>{trigger.areaPath}</Chip>{trigger.iterationPath && <Chip>{trigger.iterationPath}</Chip>}</dd>
              <dt>{t('rt.tagsIn')}</dt><dd>{trigger.includeTags?.length ? <span className="rt-chips">{trigger.includeTags.map(tag => <Chip key={tag} tone="green">+ {tag}</Chip>)}</span> : '—'}</dd>
              <dt>{t('rt.tagsOut')}</dt><dd>{trigger.excludeTags?.length ? <span className="rt-chips">{trigger.excludeTags.map(tag => <Chip key={tag} tone="red">− {tag}</Chip>)}</span> : '—'}</dd>
              <dt>{t('rt.ids')}</dt><dd>{trigger.workItemIds?.length ? trigger.workItemIds.map(id => `#${id}`).join(', ') : t('rt.all')}</dd>
              <dt>{t('rt.limit')}</dt><dd>{trigger.maxPerHour ? `${t('rt.maxHour', { n: trigger.maxPerHour })} · ` : ''}{t('rt.perItem')}</dd></>}
          </dl>}
        </section>
        {rule && <Queue snapshot={snapshot} rule={rule} />}
      </aside>
    </div>
  </div>;
}

// ---------------------------------------------------------------- Storico

export function RoutineHistory({ snapshot }: { snapshot: FlowSnapshot }) {
  const runs = snapshot.runs.filter(run => run.status === 'completed' || run.status === 'cancelled').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 200);
  const [open, setOpen] = useState<string | null>(null);
  if (!runs.length) return <p className="rt-calm">{t('rt.histEmpty')}</p>;
  return <div className="rt-history-scroll"><table className="rt-table" data-testid="rt-history"><thead><tr><th>{t('rt.colRoutine')}</th><th>{t('rt.colItem')}</th><th>{t('rt.colResult')}</th><th>{t('rt.colTime')}</th><th>{t('rt.colWhen')}</th></tr></thead>
    <tbody>{runs.map(run => {
      const definition = definitionOf(snapshot, run), item = itemOf(run);
      return [<tr key={run.id} onClick={() => setOpen(open === run.id ? null : run.id)} aria-expanded={open === run.id}>
        <td>{definition?.title ?? run.flowId}<RoutineInspect snapshot={snapshot} definition={definition} run={run} /></td><td>{item?.url ? <a href={item.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>{item.title}</a> : item?.title ?? '—'}</td>
        <td><Chip tone={run.status === 'completed' ? 'green' : undefined}>{t(run.disposition?.kind === 'skipped' ? 'flows.skipped' : run.disposition?.kind === 'needs-human' ? 'flows.needsHuman' : run.status === 'completed' ? 'rt.completed' : 'rt.cancelled')}</Chip>{run.heal?.length ? <span className="rt-muted"> · ↻ {run.heal.length}</span> : null}</td>
        <td>{duration(run.updatedAt - run.createdAt)}</td><td>{new Date(run.updatedAt).toLocaleString(locale())}</td></tr>,
        open === run.id && <tr key={`${run.id}-x`} className="rt-hist-open"><td colSpan={5}>
          <ol className="rt-hsteps">{(definition?.steps ?? []).map((spec, i) => <li key={spec.id}><b>{i + 1} · {spec.title}</b> <span className="rt-muted">{run.steps[i]?.receipt?.summary ?? (run.steps[i]?.status === 'completed' ? '✓' : '—')}</span><FlowBrowserDetails step={spec} run={run} /><FlowConnectorDetails step={spec} run={run} /></li>)}</ol>
          {run.receipts?.length ? <><div className="rt-label">{t('rt.receipts')}</div><ul className="rt-receipts">{run.receipts.map(r => <li key={r.id}><code>{r.command}</code><span className="rt-muted">{r.env} · sha {short(r.sha256)} · {t(r.by === 'user' ? 'rt.byUser' : 'rt.byRunner')} · {new Date(r.startedAt).toLocaleTimeString(locale())}{r.endedAt ? `–${new Date(r.endedAt).toLocaleTimeString(locale())}` : ''} · {r.exitCode === undefined ? '…' : t('rt.exit', { code: r.exitCode ?? '?' })}</span>{r.output && <pre>{r.output.slice(-600)}</pre>}</li>)}</ul></> : null}
          {run.cancellation?.reason && <p className="rt-muted">{run.cancellation.reason}</p>}
        </td></tr>];
    })}</tbody></table></div>;
}

// ---------------------------------------------------------------- start and dry-run

export function DryRunView({ result, title, onClose }: { result: FlowDryRun; title: string; onClose: () => void }) {
  const auto = result.steps.filter(s => s.auto).length, yours = result.steps.filter(s => s.prod).length;
  return <Modal onClose={onClose} label={t('rt.dryTitle', { name: title })} title={<>{t('rt.dryTitle', { name: title })} <Chip tone="green">{t('rt.dryNothing')}</Chip></>} closeButton testid="rt-dry-modal" className="rt-dry-modal"
    aside={<span className="rt-chips"><Chip>{t('rt.dryAuto', { n: auto })}</Chip>{yours > 0 && <Chip tone="red">{t('rt.dryYou', { n: yours })}</Chip>}</span>}>
    {result.problems.length > 0 && <div className="flow-block" role="status"><strong>{t('rt.dryProblems')}</strong><ul>{result.problems.map(p => <li key={p}>{p}</li>)}</ul></div>}
    <ol className="rt-pipe">{result.steps.map((step, i) => <li key={step.stepId} data-prod={step.prod || undefined}><span className="rt-num">{i + 1}</span><div className="rt-card rt-step">
      <header className="rt-card-head"><strong>{step.title}</strong><span className="rt-sp" /><span className="rt-muted">{step.who}</span><Chip tone={step.prod ? 'red' : step.auto ? 'green' : 'amber'}>{step.prod ? t('rt.prodYou') : step.auto ? t('rt.auto') : t('rt.you')}</Chip></header>
      {step.command && <pre className="rt-cmd">{step.command}</pre>}
      {step.problems.map(p => <p key={p} className="rt-reason">{p}</p>)}
    </div></li>)}</ol>
  </Modal>;
}
interface Pasted { name: string; content: string }
export function RoutineStart({ snapshot, flowId: initial, onClose, onDryRun }: { snapshot: FlowSnapshot; flowId?: string; onClose: () => void; onDryRun: (result: FlowDryRun, title: string) => void }) {
  const actives = useMemo(() => Object.keys(snapshot.active).map(id => activeVersion(snapshot, id)!).filter(Boolean), [snapshot]);
  const [flowId, setFlowId] = useState(initial ?? actives[0]?.definition.id ?? '');
  const version = actives.find(v => v.definition.id === flowId), definition = version?.definition, rule = ruleFor(snapshot, flowId);
  const [item, setItem] = useState(''), [preview, setPreview] = useState<FlowItemPreview | null>(null), [params, setParams] = useState<Record<string, string>>({});
  const [paste, setPaste] = useState<Pasted>({ name: 'lista.txt', content: '' }), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachments = paste.content.trim() ? [paste] : [];
  const lines = paste.content.split(/\r?\n/).filter(line => line.trim()).length;
  const fileParams = (definition?.params ?? []).filter(p => p.type === 'file');
  // the preview has its own busy flag: a click on «Prova a vuoto» blurs the field first, and that must not disable it
  const [looking, setLooking] = useState(false);
  const look = async () => {
    if (!item.trim() || looking) return;
    setLooking(true); setError(null);
    try { setPreview(await sb.invoke('flows:previewItem', { contextKey: snapshot.contextKey, flowId, workItem: item })); }
    catch (e) { setPreview(null); setError(plain(e)); } finally { setLooking(false); }
  };
  const go = async (dryRun: boolean) => {
    setBusy(true); setError(null);
    const values = { ...params };
    for (const p of fileParams) if (!values[p.name] && attachments[0]) values[p.name] = attachments[0].name;
    try {
      const result = await sb.invoke('flows:startItem', { contextKey: snapshot.contextKey, flowId, ...(item.trim() ? { workItem: item.trim() } : {}), ...(Object.keys(values).length ? { params: values } : {}), ...(attachments.length ? { attachments } : {}), ...(dryRun ? { dryRun: true } : {}) });
      if ('steps' in result && !('revision' in result)) onDryRun(result as FlowDryRun, definition?.title ?? flowId);
      else { toast(t('rt.started'), 'info'); onClose(); }
    } catch (e) { setError(plain(e)); } finally { setBusy(false); }
  };
  const drop = (event: DragEvent) => {
    event.preventDefault(); const file = event.dataTransfer.files[0];
    if (file) void file.text().then(content => setPaste({ name: file.name.replace(/[^A-Za-z0-9 ._-]/g, '_').slice(0, 100) || 'allegato.txt', content }));
  };
  const prod = definition ? prodSteps(definition) : [];
  return <Modal onClose={onClose} label={t('rt.startTitle')} title={t('rt.startTitle')} closeButton backdropCloses={false} testid="rt-start" className="rt-start-modal"
    aside={prod.length > 0 && <Chip tone="red">{t('rt.prodSteps', { n: prod.length })}</Chip>}
    footer={<><button type="button" className="btn btn-ghost btn-m" onClick={onClose}>{t('rt.close')}</button><span className="sp" /><button type="button" className="btn btn-ghost btn-m" disabled={busy || !version} onClick={() => void go(true)} data-testid="rt-start-dry">◎ {t('rt.dry')}</button><button type="button" className="btn btn-primary btn-m" disabled={busy || !version || !!preview?.blocking.length} onClick={() => void go(false)} data-testid="rt-start-go">▶ {t('rt.go')}</button></>}>
    {!actives.length ? <p className="rt-muted">{t('rt.noActive')}</p> : <div className="rt-start">
      <label className="rt-field">{t('rt.pick')}<select value={flowId} onChange={e => { setFlowId(e.target.value); setPreview(null); setParams({}); }} data-testid="rt-start-flow">{actives.map(v => <option key={v.definition.id} value={v.definition.id}>{v.definition.title} · v{v.version}</option>)}</select></label>
      <div className="rt-start-cols">
        <div>
          <label className="rt-field">{t('rt.item')}<span className="rt-inline"><input value={item} onChange={e => { setItem(e.target.value); setPreview(null); }} onBlur={() => { if (!preview) void look(); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void look(); } }} placeholder={rule?.config.trigger.kind === 'devops' ? t('rt.itemPh') : t('rt.itemPhUrl')} data-testid="rt-start-item" /><button type="button" className="btn btn-ghost btn-s" disabled={looking || !item.trim()} onClick={() => void look()}>{t('rt.preview')}</button></span></label>
          {preview && <div className="rt-preview" data-testid="rt-preview"><span className="rt-chips"><Chip>{preview.type}</Chip><Chip>{preview.state}</Chip>{preview.tags.map(tag => <Chip key={tag}>{tag}</Chip>)}</span><a href={preview.url} target="_blank" rel="noreferrer">#{preview.id} {preview.title}</a><span className="rt-muted">{preview.areaPath}</span>
            {preview.why.length > 0 && <p className="rt-warn">{t('rt.itemWarn')} {preview.why.join('; ')}</p>}
            {preview.blocking.length > 0 && <p className="flow-block">{t('rt.itemBlock')} {preview.blocking.join('; ')}</p>}</div>}
          {(definition?.params ?? []).filter(p => p.type !== 'file').length > 0 && <div className="rt-params"><span className="rt-label">{t('rt.params')}</span>{definition!.params!.filter(p => p.type !== 'file').map(p => <label key={p.name} className="rt-field">{p.label ?? p.name}{p.required ? ' *' : ''}
            {p.type === 'enum' || p.type === 'env' ? <select value={params[p.name] ?? p.default ?? ''} onChange={e => setParams({ ...params, [p.name]: e.target.value })}><option value="">—</option>{(p.type === 'env' ? ['test', 'prod'] : p.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}</select>
              : p.type === 'list' ? <textarea rows={3} value={params[p.name] ?? p.default ?? ''} onChange={e => setParams({ ...params, [p.name]: e.target.value })} />
              : <input value={params[p.name] ?? p.default ?? ''} inputMode={p.type === 'int' ? 'numeric' : undefined} onChange={e => setParams({ ...params, [p.name]: e.target.value })} />}</label>)}</div>}
        </div>
        <div className="rt-attach" onDragOver={e => e.preventDefault()} onDrop={drop} data-testid="rt-attach">
          <span className="rt-label">{t('rt.attach')}</span>
          <span className="rt-inline"><input aria-label={t('rt.attachName')} value={paste.name} onChange={e => setPaste({ ...paste, name: e.target.value })} /><button type="button" className="btn btn-ghost btn-s" onClick={() => fileRef.current?.click()}>{t('rt.pickFile')}</button>
            <input ref={fileRef} type="file" hidden onChange={e => { const file = e.target.files?.[0]; if (file) void file.text().then(content => setPaste({ name: file.name.replace(/[^A-Za-z0-9 ._-]/g, '_').slice(0, 100) || 'allegato.txt', content })); }} /></span>
          <textarea rows={7} value={paste.content} onChange={e => setPaste({ ...paste, content: e.target.value })} placeholder={t('rt.attachPh')} data-testid="rt-attach-text" />
          {lines > 0 && <p className="rt-muted">{t('rt.attachLines', { n: lines })}{fileParams[0] ? ` · ${t('rt.attachParam', { name: fileParams[0].label ?? fileParams[0].name })}` : ''}</p>}
        </div>
      </div>
      {error && <p className="flow-block" role="alert">{error}</p>}
    </div>}
  </Modal>;
}
/** The Orchestrator-side ask for a routine that has no version yet, or to change one. */
export const routineName = (snapshot: FlowSnapshot, flowId: string): string => activeVersion(snapshot, flowId)?.definition.title ?? flowState.get().snapshot?.drafts.find(d => d.definition.id === flowId)?.definition.title ?? flowId;
