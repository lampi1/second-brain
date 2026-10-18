// "Crea agente": a short questionnaire (role and goal, tools and data, autonomy, summary) whose answers become one
// message the user sends to the Orchestrator through the normal send path, so it counts as the user's own request
// for agent_create (#49). Only the goal is required; the Orchestrator asks for what is missing and creates the agent.
// Opened by the header button of AgentCatalogPage.tsx; starts the Orchestrator first when none is open.
import { useRef, useState } from 'react';
import { focusChat } from '../actions';
import { t } from '../i18n';
import { AGENT_AUTONOMY, AGENT_KINDS, AGENT_NEEDS, CREATE_LIMITS, CREATE_STEPS, agentRequestMessage, canSend, emptyAnswers, type AgentCreateAnswers } from '../lib/agent-create';
import { orchestratorIdOf } from '../lib/regia-route';
import { useAgents } from '../store/agents';
import { app, ensureOrchestrator, send, useApp } from '../store/store';
import { toast } from '../store/ui';
import { Select } from './Select';
import { Modal } from './ui';
import '../styles/agent-create.css';

export function AgentCreateDialog({ onClose }: { onClose: () => void }) {
  const { catalog } = useAgents();
  const info = useApp(s => s.info), settings = useApp(s => s.settings);
  const regia = useApp(s => orchestratorIdOf(s));
  const [answers, setAnswers] = useState<AgentCreateAnswers>(emptyAnswers);
  const [step, setStep] = useState(0), [touched, setTouched] = useState(false);
  const [regiaEngine, setRegiaEngine] = useState('');
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState(false);
  const working = useRef(false);
  const change = (patch: Partial<AgentCreateAnswers>) => { setAnswers(a => ({ ...a, ...patch })); setProblem(false); };
  // the engines an Orchestrator may start on: the same list as the Orchestrator column's own setup (RegiaTile)
  const regiaEngines = (info?.engines ?? []).filter(e => e.trusted && settings?.engineOn[e.id] === true && settings.engines[e.id] !== false);
  const regiaPick = regiaEngines.find(e => e.id === regiaEngine) ?? regiaEngines[0];
  const agentEngines = catalog?.models.filter(m => m.enabled && m.trusted) ?? [];
  const goalMissing = !canSend(answers);
  const blocked = goalMissing || !regia && (!info?.brainRoot || !regiaPick);
  const last = step === CREATE_STEPS.length - 1;
  const next = () => { if (step === 0 && goalMissing) { setTouched(true); return; } setStep(s => Math.min(s + 1, CREATE_STEPS.length - 1)); };
  const submit = async () => {
    if (working.current) return;
    if (goalMissing) { setTouched(true); setStep(0); return; }
    if (blocked) return;
    working.current = true; setBusy(true); setProblem(false);
    try {
      let target = regia;
      if (!target) { const chat = await ensureOrchestrator(regiaPick!.id); target = chat?.id ?? null; }
      // a store send = what Enter in the Orchestrator's input does ('chat:send'): the message is the user's own
      const result = target && app.get().chats[target] ? send(target, agentRequestMessage(answers)) : 'empty';
      if (result === 'empty' || !target) { setProblem(true); return; }
      const id = target;
      onClose();
      focusChat(id);
      toast(t(result === 'sent' ? 'agentCreate.sent' : 'agentCreate.queued'), 'ok', { label: t('agentCreate.open'), run: () => focusChat(id) });
    } finally { working.current = false; setBusy(false); }
  };
  const choice = (name: string, checked: boolean, onChange: () => void, label: string, hint?: string, type: 'radio' | 'checkbox' = 'radio') =>
    <label key={label} className={`agent-create-choice${checked ? ' on' : ''}`}><input type={type} name={name} checked={checked} onChange={onChange} disabled={busy} /><span><b>{label}</b>{hint && <small>{hint}</small>}</span></label>;
  return <Modal onClose={onClose} label={t('agentCreate.title')} testid="agent-create" className="modal-agent-create">
    <form onSubmit={e => { e.preventDefault(); if (last) void submit(); else next(); }} onKeyDown={e => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!e.repeat) void submit(); } }}>
      <div className="modal-head"><h2>{t('agentCreate.title')}</h2><span className="sp" /><small className="modal-head-hint">{t('agentCreate.step', { n: step + 1, total: CREATE_STEPS.length })}</small></div>
      <div className="modal-body">
        <ol className="agent-create-steps" aria-label={t('agentCreate.steps')}>{CREATE_STEPS.map((s, i) => <li key={s} aria-current={i === step ? 'step' : undefined} className={i < step ? 'done' : ''}>
          <button type="button" className="link-btn" disabled={busy || i > 0 && goalMissing} onClick={() => setStep(i)}>{t(`agentCreate.step.${s}`)}</button></li>)}</ol>
        {step === 0 && <>
          <p className="agent-create-intro">{t('agentCreate.intro')}</p>
          <fieldset className="agent-create-group"><legend>{t('agentCreate.kind')}</legend><div className="agent-create-chips">
            {AGENT_KINDS.map(kind => choice('agent-kind', answers.kind === kind, () => change({ kind }), t(`agentCreate.kind.${kind}`)))}
          </div></fieldset>
          <label className="field"><span>{t('agentCreate.goal')}</span><textarea rows={4} aria-required maxLength={CREATE_LIMITS.goal} value={answers.goal} disabled={busy} data-autofocus
            aria-invalid={touched && goalMissing} placeholder={t('agentCreate.goalHint')} onChange={e => change({ goal: e.target.value })} data-testid="agent-create-goal" />
            {touched && goalMissing && <small role="alert" className="field-error">{t('agentCreate.goalRequired')}</small>}</label>
          <label className="field"><span>{t('agentCreate.name')}</span><input maxLength={CREATE_LIMITS.name} value={answers.name} disabled={busy} placeholder={t('agentCreate.nameHint')} onChange={e => change({ name: e.target.value })} data-testid="agent-create-name" /></label>
        </>}
        {step === 1 && <>
          <fieldset className="agent-create-group"><legend>{t('agentCreate.tools')}</legend><div className="agent-create-chips">
            {AGENT_NEEDS.map(need => choice('agent-need', answers.needs.includes(need), () => change({ needs: answers.needs.includes(need) ? answers.needs.filter(n => n !== need) : [...answers.needs, need] }), t(`agentCreate.tool.${need}`), undefined, 'checkbox'))}
          </div><small className="agent-create-note">{t('agentCreate.toolsNote')}</small></fieldset>
          <label className="field"><span>{t('agentCreate.sources')}</span><textarea rows={3} maxLength={CREATE_LIMITS.sources} value={answers.sources} disabled={busy} placeholder={t('agentCreate.sourcesHint')} onChange={e => change({ sources: e.target.value })} /></label>
        </>}
        {step === 2 && <>
          <fieldset className="agent-create-group"><legend>{t('agentCreate.autonomy')}</legend><div className="agent-create-stack">
            {AGENT_AUTONOMY.map(level => choice('agent-autonomy', answers.autonomy === level, () => change({ autonomy: level }), t(`agentCreate.autonomy.${level}`), t(`agentCreate.autonomy.${level}Hint`)))}
          </div></fieldset>
          <label className="field"><span>{t('agentCreate.limits')}</span><textarea rows={2} maxLength={CREATE_LIMITS.limits} value={answers.limits} disabled={busy} placeholder={t('agentCreate.limitsHint')} onChange={e => change({ limits: e.target.value })} /></label>
          {agentEngines.length > 1 && <label className="field"><span>{t('agentCreate.engine')}</span><Select value={answers.engine} disabled={busy} onChange={e => change({ engine: e.target.value })}>
            <option value="">{t('agentCreate.engineAny')}</option>{agentEngines.map(m => <option key={m.engine} value={m.label}>{m.label}</option>)}</Select></label>}
        </>}
        {last && <>
          <section className="agent-create-preview" aria-label={t('agentCreate.preview')}><h3>{t('agentCreate.preview')}</h3><pre data-testid="agent-create-preview">{agentRequestMessage(answers)}</pre></section>
          {!regia && info?.brainRoot && regiaEngines.length > 0 && <label className="field"><span>{t('agentCreate.regiaEngine')}</span><Select value={regiaPick?.id ?? ''} disabled={busy} onChange={e => setRegiaEngine(e.target.value)} data-testid="agent-create-regia-engine">
            {regiaEngines.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}</Select></label>}
        </>}
        {!regia && (!info?.brainRoot ? <p role="status" className="agent-create-note">{t('agentCreate.noRoot')}</p> : !regiaEngines.length && <p role="status" className="agent-create-note">{t('agentCreate.noEngine')}</p>)}
        {problem && <p role="alert" className="field-error">{t('agentCreate.error')}</p>}
      </div>
      <div className="modal-foot">
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>{t('agentCreate.cancel')}</button><span className="sp" />
        {step > 0 && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setStep(s => s - 1)}>{t('agentCreate.back')}</button>}
        {!last && <button type="submit" className="btn btn-ghost" disabled={busy} data-testid="agent-create-next">{t('agentCreate.next')}</button>}
        <button type="button" className="btn btn-primary" disabled={busy || blocked} onClick={() => void submit()} data-testid="agent-create-send">{t(busy ? 'agentCreate.sending' : 'agentCreate.send')}</button>
      </div>
    </form>
  </Modal>;
}
