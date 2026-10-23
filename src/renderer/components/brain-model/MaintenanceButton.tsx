// The «Manutenzione» button and its dialog (#150, ADR 0132). Always on the top bar (`bar`), on the Orchestrator's head
// (`compact`) and in Memoria's hero. A click opens the dialog first: the free cleanup always runs (the brain jobs, the
// app's logs, the skills nobody uses: zero tokens); «Ricerca e miglioramento» adds a research by the engine, model and
// effort the user picks (the strongest by default), with the web or not, a spending cap (5 $ by default) and the prompt
// the user sees and may change at every run (the app's fixed rules shown under it, read-only). «Avvia» runs the
// cleanup, then starts the research; the same dialog then says, job by job, what the cleanup did, the log groups (each
// with «Noto, ignora»), the cards it made and the research's live state (its cost against the cap, its cards, «Apri la
// chat», «Ferma»). Every finding ends as a card: Memoria → Proposte (the brain) or «Idee dell'app» (the app's code).
// Used by TopBar.tsx (bar), OrchestratorTile.tsx (compact) and MemoryPage.tsx. Styles: styles/memory.css (mm-maint-*, mm-r-*).
import { useEffect, useRef, useState } from 'react';
import { MAINTENANCE_JOBS } from '@shared/brain-model';
import type { Effort } from '@shared/contract';
import type { MaintenanceSetup } from '@shared/maintenance-research';
import { t } from '../../i18n';
import { go, openChatRef } from '../../actions';
import { useModelsSeen, modelOptions } from '../../lib/models';
import { useApp } from '../../store/store';
import { brainModel, markLogGroup, refreshBrainModel, runMaintenance, useBrainModel } from '../../store/brain-model';
import { startResearch, stopResearch, useMaintenance } from '../../store/maintenance';
import { HelpTip } from '../HelpTip';
import { IconSparkle } from '../Icons';
import { Select } from '../Select';
import { IconButton, Modal } from '../ui';
import { Change, when } from './MaintenancePanel';
import '../../styles/memory.css';

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const usd = (n: number) => `${n.toFixed(2)} $`;

interface Choice { research: boolean; harness: string; model: string; effort: Effort | ''; web: boolean; cap: string; prompt: string }
const choiceOf = (s: MaintenanceSetup, research: boolean): Choice => ({
  research, harness: s.defaults.harness, model: s.defaults.model ?? '', effort: s.defaults.effort ?? '', web: s.defaults.web, cap: String(s.defaults.capUsd), prompt: s.prompt,
});

/** The research's own line while it runs or after: state, live cost against the cap, cards made, its chat. */
function ResearchStatus({ setup }: { setup: MaintenanceSetup }) {
  const run = setup.running ?? setup.last;
  const chat = useApp(s => (run ? s.chats[run.chatId] : undefined));
  if (!run) return null;
  const cost = setup.running ? chat?.costUsd ?? run.costUsd : run.costUsd;
  const pct = Math.min(100, Math.round((cost / Math.max(0.01, run.capUsd)) * 100));
  const live = !!setup.running;
  return <div className="mm-r-status" data-state={live ? 'running' : run.state} data-testid="mm-r-status">
    <div className="mm-r-status-top">
      <span className="mm-job-dot" aria-hidden="true" />
      <b>{live ? t('mm.r.running') : t(`mm.r.state.${run.state}`)}</b>
      {run.why && !live && <small className="mm-r-why">{run.why}</small>}
      <span className="mm-r-cards" data-testid="mm-r-cards">{t('mm.r.cards', { n: run.proposals })}</span>
    </div>
    <div className="mm-r-meter" role="meter" aria-valuemin={0} aria-valuemax={run.capUsd} aria-valuenow={cost} aria-label={t('mm.r.costLabel')}>
      <i style={{ width: `${pct}%` }} />
    </div>
    <div className="mm-r-status-foot">
      <span>{t('mm.r.cost', { cost: usd(cost), cap: usd(run.capUsd) })}</span>
      <span className="mm-r-actions">
        {chat && <button type="button" className="btn btn-s btn-ghost" onClick={() => openChatRef(run.chatId)} data-testid="mm-r-open">{t('mm.r.openChat')}</button>}
        {live && <button type="button" className="btn btn-s btn-danger" onClick={() => void stopResearch()} data-testid="mm-r-stop">{t('mm.r.stop')}</button>}
      </span>
    </div>
  </div>;
}

/** The dialog's first view: the free cleanup, and the research with its choices and its prompt. */
function SetupView({ setup, c, set }: { setup: MaintenanceSetup; c: Choice; set: (p: Partial<Choice>) => void }) {
  const seen = useModelsSeen(c.research);
  const engine = setup.engines.find(e => e.harness === c.harness);
  const [frame, setFrame] = useState(false);
  const edited = c.prompt.trim() !== setup.defaultPrompt.trim();
  return <div className="mm-r-setup">
    <section className="mm-r-block" aria-labelledby="mm-r-free-h">
      <h3 id="mm-r-free-h" className="mm-r-h">{t('mm.r.free')}<span className="mm-r-pill">{t('mm.r.zeroTokens')}</span></h3>
      <p className="mm-r-lead">{t('mm.r.freeLead')}</p>
    </section>
    <section className={`mm-r-block mm-r-research${c.research ? ' on' : ''}`} data-testid="mm-r-research">
      <label className="mm-r-toggle">
        <input type="checkbox" checked={c.research} disabled={!setup.engines.length} onChange={e => set({ research: e.target.checked })} data-testid="mm-r-toggle" />
        <span><b>{t('mm.r.research')}</b><small>{setup.engines.length ? t('mm.r.researchLead') : t('mm.r.noEngine')}</small></span>
      </label>
      {c.research && engine && <>
        <div className="mm-r-grid">
          <label>{t('mm.r.engine')}
            <Select value={c.harness} onChange={e => { const h = e.target.value; const en = setup.engines.find(x => x.harness === h); set({ harness: h, model: h === setup.defaults.harness ? setup.defaults.model ?? '' : '', effort: en?.effort ? (c.effort || 'high') : '', web: !!en?.web && c.web }); }} data-testid="mm-r-engine">
              {setup.engines.map(e => <option key={e.harness} value={e.harness}>{e.label}</option>)}
            </Select></label>
          <label>{t('mm.r.model')}
            <Select value={c.model} onChange={e => set({ model: e.target.value })} data-testid="mm-r-model">
              {modelOptions(c.harness, seen, c.model).map(m => <option key={m.id} value={m.id}>{m.id === 'opus' ? t('mm.r.opus') : m.label}</option>)}
            </Select></label>
          {engine.effort && <label>{t('mm.r.effort')}
            <Select value={c.effort} onChange={e => set({ effort: e.target.value as Effort })} data-testid="mm-r-effort">
              {EFFORTS.map(x => <option key={x} value={x}>{t(`mm.r.effort.${x}`)}</option>)}
            </Select></label>}
          <label>{t('mm.r.cap')}
            <span className="mm-r-cap"><input type="number" min={0.5} max={50} step={0.5} value={c.cap} onChange={e => set({ cap: e.target.value })} data-testid="mm-r-cap" /><span aria-hidden="true">$</span></span></label>
        </div>
        <div className="mm-r-row">
          <label className="mm-r-check"><input type="checkbox" checked={c.web} disabled={!engine.web} onChange={e => set({ web: e.target.checked })} data-testid="mm-r-web" />{t('mm.r.web')}</label>
          <span className="mm-r-estimate" data-testid="mm-r-estimate">{setup.estimate ? t('mm.r.estimate', { cost: usd(setup.estimate.medianUsd), n: setup.estimate.n }) : t('mm.r.noEstimate')}</span>
        </div>
        <div className="mm-r-prompt">
          <div className="mm-r-prompt-head">
            <label htmlFor="mm-r-prompt">{t('mm.r.prompt')}</label>
            {edited && <span className="mm-r-edited">{t('mm.r.edited')}</span>}
            <button type="button" className="btn btn-s btn-ghost" disabled={!edited} onClick={() => set({ prompt: setup.defaultPrompt })} data-testid="mm-r-reset">{t('mm.r.reset')}</button>
          </div>
          <textarea id="mm-r-prompt" value={c.prompt} rows={10} maxLength={12000} spellCheck={false} onChange={e => set({ prompt: e.target.value })} data-testid="mm-r-prompt" />
          <button type="button" className="mm-r-frame-btn" aria-expanded={frame} onClick={() => setFrame(f => !f)} data-testid="mm-r-frame-toggle">{frame ? t('mm.r.frameHide') : t('mm.r.frameShow')}</button>
          {frame && <pre className="mm-r-frame" data-testid="mm-r-frame">{setup.frame}</pre>}
        </div>
      </>}
    </section>
  </div>;
}

export function MaintenanceButton({ testId = 'bm-maint-now', compact = false, bar = false }: { testId?: string; compact?: boolean; bar?: boolean }) {
  const { state, busy } = useBrainModel(!compact && !bar);
  const [open, setOpen] = useState(false);
  const { setup, error: setupError } = useMaintenance(open);
  const [phase, setPhase] = useState<'setup' | 'run'>('setup');
  const [c, setC] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ran, setRan] = useState(false);
  // the changes there were before this pass: what is new afterwards is what this pass did (clock-free: the frozen demo
  // stamps every change with the same time)
  const before = useRef<Set<string>>(new Set());
  // the dialog's choices start from what the app suggests and the prompt last run; a running research opens on its state
  useEffect(() => { if (open && setup && !c) { setC(choiceOf(setup, false)); if (setup.running) setPhase('run'); } }, [open, setup, c]);
  const openDialog = () => { setError(null); setRan(false); setPhase('setup'); setC(null); setOpen(true); };
  const start = async () => {
    if (!c) return;
    const cap = Number(c.cap);
    if (c.research && (!Number.isFinite(cap) || cap < 0.5 || cap > 50)) { setError(t('mm.r.capBad')); return; }
    if (c.research && !c.prompt.trim()) { setError(t('mm.r.promptEmpty')); return; }
    // the compact icon has not read the model yet: read it first, so only this pass's changes count as new
    if (!brainModel.get().state) await refreshBrainModel();
    before.current = new Set((brainModel.get().state?.changes ?? []).map(x => x.id));
    setError(null); setRan(false); setPhase('run');
    const err = await runMaintenance();
    if (!err && c.research) {
      const r = await startResearch({ harness: c.harness, model: c.model || null, effort: c.effort || null, web: c.web, capUsd: cap, prompt: c.prompt });
      setError(r);
    } else setError(err);
    setRan(true);
  };
  const fresh = ran ? (state?.changes ?? []).filter(x => !before.current.has(x.id)) : [];
  const jobs = ran ? state?.lastRun?.jobs ?? [] : [];
  const logs = ran ? state?.lastRun?.logs : undefined, cards = ran ? state?.lastRun?.cards : undefined;
  const freshGroups = logs?.groups.filter(g => !g.known).length ?? 0;
  const running = !!setup?.running;
  const label = running ? t('mm.r.runningShort') : busy ? t('mm.maint.running') : t('mm.maint.button');
  const toHub = (tab: string) => { setOpen(false); go({ page: 'memoria', arg: tab }); };
  const runView = <>
    <ul className="mm-jobs" aria-label={t('mm.maint.jobsLabel')} aria-busy={!ran}>
      {MAINTENANCE_JOBS.map(id => {
        const j = jobs.find(x => x.job === id);
        const status = !ran ? 'running' : j?.note ? 'note' : j?.changes ? 'changed' : 'clean';
        return <li key={id} className="mm-job" data-status={status} data-testid={`mm-job-${id}`}>
          <span className="mm-job-dot" aria-hidden="true" />
          <span className="mm-job-main"><b>{t(`bm.job.${id}`)}</b><small>{t(`mm.job.${id}`)}</small>{j?.note && <small className="mm-job-note">{j.note}</small>}</span>
          <span className="mm-job-result">{!ran ? t('mm.maint.wait') : j?.changes ? t('mm.maint.changes', { n: j.changes }) : j?.note ? t('mm.maint.stopped') : t('mm.maint.clean')}</span>
        </li>;
      })}
      <li className="mm-job" data-status={!ran ? 'running' : freshGroups ? 'note' : 'clean'} data-testid="mm-job-logs">
        <span className="mm-job-dot" aria-hidden="true" />
        <span className="mm-job-main"><b>{t('mm.job.logs.name')}</b><small>{t('mm.job.logs')}</small></span>
        <span className="mm-job-result">{!ran ? t('mm.maint.wait') : freshGroups ? t('mm.maint.groups', { n: freshGroups }) : t('mm.maint.noGroups')}</span>
      </li>
      <li className="mm-job" data-status={!ran ? 'running' : cards?.forget ? 'changed' : 'clean'} data-testid="mm-job-forget">
        <span className="mm-job-dot" aria-hidden="true" />
        <span className="mm-job-main"><b>{t('mm.job.forget.name')}</b><small>{t('mm.job.forget')}</small></span>
        <span className="mm-job-result">{!ran ? t('mm.maint.wait') : cards?.forget ? t('mm.maint.forgetCards', { n: cards.forget }) : t('mm.maint.clean')}</span>
      </li>
    </ul>
    {setup && (setup.running || (c?.research && ran)) && <><h3 className="mm-maint-h">{t('mm.r.research')}</h3><ResearchStatus setup={setup} /></>}
    {ran && (cards?.bugs || cards?.forget || setup?.running || c?.research) ? <div className="mm-r-links">
      <button type="button" className="btn btn-m" onClick={() => toHub('proposte')} data-testid="mm-r-to-proposals">{t('mm.r.toProposals')}</button>
      <button type="button" className="btn btn-m" onClick={() => toHub('app')} data-testid="mm-r-to-ideas">{cards?.bugs ? t('mm.r.toIdeasN', { n: cards.bugs }) : t('mm.r.toIdeas')}</button>
    </div> : null}
    {logs && logs.groups.length > 0 && <>
      <h3 className="mm-maint-h">{t('mm.maint.logsTitle')}</h3>
      <ul className="mm-logs" aria-label={t('mm.maint.logsLabel')} data-testid="mm-logs">
        {logs.groups.map(g => <li key={g.key} className={`mm-log${g.known ? ' known' : ''}`} data-lvl={g.lvl} data-testid="mm-log">
          <span className="mm-log-main"><b>{g.scope} · {g.msg}</b>{g.cause && <small>{g.cause}</small>}</span>
          <span className="mm-log-n">×{g.count}</span>
          <button type="button" className="btn btn-s" disabled={busy} data-tip={g.known ? undefined : t('mm.maint.knownTip')} onClick={() => void markLogGroup(g.key, !g.known)} data-testid="mm-log-known">{g.known ? t('mm.maint.unknown') : t('mm.maint.known')}</button>
        </li>)}
      </ul>
    </>}
    {ran && fresh.length > 0 && <>
      <h3 className="mm-maint-h">{t('mm.maint.what')}</h3>
      <ul className="bm-changes" aria-label={t('bm.maint.listLabel')}>{fresh.map(x => <Change key={x.id} c={x} busy={busy} />)}</ul>
    </>}
  </>;
  const lead = phase === 'setup' ? t('mm.r.setupLead') : !ran && !running ? t('mm.maint.runningLead') : ran ? t('mm.maint.doneLead', { n: fresh.length }) : t('mm.r.runningLead');
  return <div className={`mm-maint${compact ? ' compact' : ''}${bar ? ' bar' : ''}`} data-testid={testId}>
    {compact
      ? <IconButton label={label} onClick={openDialog} testid={`${testId}-run`}><IconSparkle size={14} /></IconButton>
      : bar
        ? <button type="button" className={`btn btn-ghost btn-m mm-maint-bar${running ? ' busy' : ''}`} onClick={openDialog} data-testid={`${testId}-run`} aria-label={label} data-tip={t('mm.r.barTip')}>
          <IconSparkle size={14} /><span>{label}</span></button>
        : <>
          <button type="button" className="btn btn-primary btn-m mm-maint-btn" disabled={!state?.root} onClick={openDialog} data-testid={`${testId}-run`}>
            <IconSparkle /> {label}
          </button>
          <span className="mm-maint-last">{state?.lastRun ? t('bm.maint.last', { at: when(state.lastRun.at) }) : t('bm.maint.never')}</span>
          <HelpTip title={t('mm.maint.helpTitle')} label={t('mm.maint.button')} wide guide="maintenance">
            <p>{t('mm.maint.help1')}</p><p>{t('mm.maint.help2')}</p><p>{t('mm.maint.help3')}</p>
          </HelpTip>
        </>}
    {open && <Modal onClose={() => setOpen(false)} label={t('mm.maint.dialog')} testid={`${testId}-dialog`} className="mm-maint-modal" size="m"
      icon={<IconSparkle size={16} />} title={t('mm.maint.dialog')} subtitle={<span className="mm-maint-lead">{lead}</span>}
      footer={phase === 'setup'
        ? <><button type="button" className="btn btn-ghost btn-m" onClick={() => setOpen(false)} data-testid={`${testId}-cancel`}>{t('mm.r.cancel')}</button>
          <button type="button" className="btn btn-primary btn-m" disabled={!c || busy} onClick={() => void start()} data-testid={`${testId}-start`} data-autofocus>{c?.research ? t('mm.r.startResearch') : t('mm.r.startFree')}</button></>
        : <button type="button" className="btn btn-primary btn-m" onClick={() => setOpen(false)} data-testid={`${testId}-close`}>{t('mm.maint.close')}</button>}>
      {(error || setupError) && <p role="alert" className="mm-maint-error" data-testid="mm-maint-error">{error ?? setupError}</p>}
      {phase === 'setup'
        ? setup && c ? <SetupView setup={setup} c={c} set={p => setC(x => (x ? { ...x, ...p } : x))} /> : <p className="mm-r-lead">{t('bm.loading')}</p>
        : runView}
      {phase === 'run' && <p className="bm-note">{t('bm.maint.approvalNote')}</p>}
    </Modal>}
  </div>;
}
