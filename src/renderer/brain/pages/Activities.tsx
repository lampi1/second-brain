// «Attività pianificate» (ADR 0373): the page that replaces Task. One row per activity: the switch, the source, what it
// does in words, the schedule in words (describeSchedule), the last run («letti · tenuti · proposte · costo», zero token
// unless a model ran), and «Esegui ora», «Dettaglio» (the last 20 runs), «Modifica», «Elimina». On top the global pause and
// the ready-made examples (activityTemplates) next to «Nuova attività»; the editor is validated by the same
// validateActivityInput as the Orchestrator's tool, so a wrong field shows its message and nothing is saved. State and
// actions: store/activities.ts (main pushes 'activities:changed'); pure parts: lib/activities.ts. Why: the owner never
// opened Task and wants to turn activities on and off ("al posto di task che non la guardo mai"). Styles: activities.css.
// Used by brain/index.tsx (page 'attivita').
import { useEffect, useState, type ReactNode } from 'react';
import { ACTIVITY_SOURCES, ACTIVITY_SOURCE_NAME, ACTIVITY_CAP_MAX, ACTIVITY_EVERY_MAX, ACTIVITY_EVERY_MIN, type ActivityRun, type ActivitySource, type ActivityView } from '@shared/activities';
import { activityHistory, removeActivity, runActivity, saveActivity, setActivityOn, setPaused, useActivities } from '../../store/activities';
import { blankDraft, draftFromInput, runLine, STATUS_TONE, validateDraft, type ActivityDraft } from '../../lib/activities';
import { IconEdit, IconPlay, IconTrash } from '../../components/Icons';
import { Empty, Loading } from '../components/States';
import { Pill } from '../components/ui';
import { fmt } from '../lib/format';
import { now as clockNow } from '../../lib/clock';
import { t, type TextKey } from '../../i18n';
import './activities.css';

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

function Switch({ on, label, onChange, testId }: { on: boolean; label: string; onChange: (on: boolean) => void; testId: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`ac-switch${on ? ' on' : ''}`} onClick={() => onChange(!on)} data-testid={testId}><span aria-hidden="true" /></button>;
}

function SourceGlyph({ source }: { source: ActivitySource }) {
  return <span className={`ac-src s-${source}`} title={ACTIVITY_SOURCE_NAME[source]} aria-label={ACTIVITY_SOURCE_NAME[source]} data-testid={`ac-src-${source}`}>{ACTIVITY_SOURCE_NAME[source].charAt(0)}</span>;
}

function RunRow({ run }: { run: ActivityRun }) {
  return (
    <li className="ac-run" data-testid="ac-run">
      <Pill tone={STATUS_TONE[run.status]}>{t(`activities.status.${run.status}` as TextKey)}</Pill>
      <span className="when" title={fmt.when(run.at)}>{fmt.when(run.at)}</span>
      <span className="ac-run-line">{run.status === 'error' && run.error ? run.error : runLine(run)}</span>
      <span className="who">{t(`activities.trigger.${run.trigger}` as TextKey)}{run.usedModel ? ` · ${t('activities.usedModel')}${run.model ? ` (${run.model})` : ''}` : ''}</span>
    </li>
  );
}

/** The last 20 runs of one activity, read again when its last run changes. */
function Detail({ a, onClose }: { a: ActivityView; onClose: () => void }) {
  const [runs, setRuns] = useState<ActivityRun[] | null>(null);
  const lastId = a.lastRun?.id ?? '';
  useEffect(() => {
    let alive = true;
    void activityHistory(a.id).then(r => { if (alive) setRuns(r); });
    return () => { alive = false; };
  }, [a.id, lastId]);
  return (
    <section className="ac-detail" aria-label={t('activities.detailsTitle', { name: a.name })} data-testid="ac-detail">
      <div className="ac-detail-head">
        <h3>{t('activities.detailsTitle', { name: a.name })}</h3>
        <button type="button" className="bx-btn s" onClick={onClose} data-testid="ac-detail-close">{t('activities.close')}</button>
      </div>
      <p className="ac-propose">{a.propose}</p>
      {runs === null ? <Loading lines={2} /> : runs.length === 0 ? <p className="ac-muted">{t('activities.noRuns')}</p> : <ul className="ac-runs">{runs.map(r => <RunRow key={r.id} run={r} />)}</ul>}
    </section>
  );
}

function Row({ a, paused, open, onDetail, onEdit }: { a: ActivityView; paused: boolean; open: boolean; onDetail: () => void; onEdit: () => void }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const run = async () => { setBusy(true); try { await runActivity(a.id, a.name); } finally { setBusy(false); } };
  const last = a.lastRun;
  return (
    <div className={`ac-row${a.enabled ? ' on' : ''}`} data-testid="ac-row" data-activity={a.name}>
      <Switch on={a.enabled} label={t('activities.enable', { name: a.name })} onChange={on => void setActivityOn(a.id, on)} testId="ac-switch" />
      <SourceGlyph source={a.source} />
      <div className="ac-main">
        <div className="ac-name"><b>{a.name}</b>{a.running ? <Pill tone="blue">{t('activities.running')}</Pill> : <span className="ac-state">{a.enabled ? t('activities.on') : t('activities.off')}</span>}</div>
        <div className="ac-sched" data-testid="ac-sched">{a.scheduleText}{a.enabled && !paused && a.nextAt !== null && !a.running ? ` · ${t('activities.next', { when: fmt.when(a.nextAt) })}` : ''}</div>
        <div className="ac-last" data-testid="ac-last">
          {last ? <><span>{t('activities.lastAt', { ago: fmt.ago(last.at, clockNow()) })}</span> · <span>{last.status === 'error' && last.error ? last.error : runLine(last)}</span></> : t('activities.lastNone')}
          {a.todayTriage > 0 && <span> · {t('activities.today', { n: a.todayTriage, cap: a.dailyCap })}</span>}
        </div>
        {a.usesModelToRead && <div className="ac-warn" data-testid="ac-gmail-note">{t('activities.gmailNote')}</div>}
      </div>
      <div className="ac-actions">
        {confirm ? (
          <>
            <span className="ac-confirm">{t('activities.removeConfirm', { name: a.name })}</span>
            <button type="button" className="bx-btn s danger" onClick={() => void removeActivity(a.id)} data-testid="ac-remove-yes">{t('activities.remove')}</button>
            <button type="button" className="bx-btn s" onClick={() => setConfirm(false)}>{t('activities.form.cancel')}</button>
          </>
        ) : (
          <>
            <button type="button" className="bx-btn s" disabled={busy || a.running} onClick={() => void run()} data-testid="ac-run-now"><IconPlay /> {t('activities.runNow')}</button>
            <button type="button" className={`bx-btn s${open ? ' on' : ''}`} aria-expanded={open} onClick={onDetail} data-testid="ac-details">{t('activities.details')}</button>
            <button type="button" className="bx-btn s icon" aria-label={t('activities.edit')} title={t('activities.edit')} onClick={onEdit} data-testid="ac-edit"><IconEdit /></button>
            <button type="button" className="bx-btn s icon" aria-label={t('activities.remove')} title={t('activities.remove')} onClick={() => setConfirm(true)} data-testid="ac-remove"><IconTrash /></button>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={`ac-field${wide ? ' wide' : ''}`}><span>{label}</span>{children}</label>;
}

function Editor({ id, initial, gmailConnector, onClose }: { id?: string; initial: ActivityDraft; gmailConnector: boolean; onClose: () => void }) {
  const [d, setD] = useState(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ActivityDraft>(k: K, v: ActivityDraft[K]) => setD(x => ({ ...x, [k]: v }));
  const submit = async () => {
    const v = validateDraft(d);
    if (!v.ok) { setErrors(v.errors); return; }
    setErrors([]);
    setBusy(true);
    try { if (await saveActivity(v.input, id)) onClose(); } finally { setBusy(false); }
  };
  return (
    <form className="ac-form" onSubmit={e => { e.preventDefault(); void submit(); }} aria-label={t(id ? 'activities.form.titleEdit' : 'activities.form.titleNew')} data-testid="ac-form">
      <h3>{t(id ? 'activities.form.titleEdit' : 'activities.form.titleNew')}</h3>
      <div className="ac-grid">
        <Field label={t('activities.form.name')}><input value={d.name} onChange={e => set('name', e.target.value)} data-testid="ac-f-name" /></Field>
        <Field label={t('activities.form.source')}>
          <select value={d.source} onChange={e => set('source', e.target.value as ActivitySource)} data-testid="ac-f-source">
            {ACTIVITY_SOURCES.map(s => <option key={s} value={s}>{ACTIVITY_SOURCE_NAME[s]}</option>)}
          </select>
        </Field>
        <Field label={t('activities.form.every')}><input type="number" min={ACTIVITY_EVERY_MIN} max={ACTIVITY_EVERY_MAX} value={d.everyMin} onChange={e => set('everyMin', e.target.value)} data-testid="ac-f-every" /></Field>
        <Field label={t('activities.form.cap')}><input type="number" min={1} max={ACTIVITY_CAP_MAX} value={d.dailyCap} onChange={e => set('dailyCap', e.target.value)} data-testid="ac-f-cap" /></Field>
        <div className="ac-field wide">
          <span>{t('activities.form.days')}</span>
          <div className="ac-days" role="group" aria-label={t('activities.form.days')}>
            {DAYS.map(n => <button key={n} type="button" aria-pressed={d.days.includes(n)} className={d.days.includes(n) ? 'on' : ''} onClick={() => set('days', d.days.includes(n) ? d.days.filter(x => x !== n) : [...d.days, n].sort())} data-testid={`ac-f-day-${n}`}>{t(`activities.day.${n}` as TextKey)}</button>)}
          </div>
        </div>
        <div className="ac-field wide ac-window">
          <label className="ac-check"><input type="checkbox" checked={d.useWindow} onChange={e => set('useWindow', e.target.checked)} data-testid="ac-f-window" /> {t('activities.form.window')}</label>
          {d.useWindow && <span className="ac-times"><label>{t('activities.form.from')} <input type="time" value={d.from} onChange={e => set('from', e.target.value)} data-testid="ac-f-from" /></label><label>{t('activities.form.to')} <input type="time" value={d.to} onChange={e => set('to', e.target.value)} data-testid="ac-f-to" /></label></span>}
        </div>
        <Field label={t('activities.form.senders')}><input value={d.senders} onChange={e => set('senders', e.target.value)} data-testid="ac-f-senders" /></Field>
        <Field label={t('activities.form.words')}><input value={d.subjectWords} onChange={e => set('subjectWords', e.target.value)} data-testid="ac-f-words" /></Field>
        <div className="ac-field wide ac-flags">
          <label className="ac-check"><input type="checkbox" checked={d.mentionsOnly} onChange={e => set('mentionsOnly', e.target.checked)} /> {t('activities.form.mentionsOnly')}</label>
          <label className="ac-check"><input type="checkbox" checked={d.unreadOnly} onChange={e => set('unreadOnly', e.target.checked)} /> {t('activities.form.unreadOnly')}</label>
          <label className="ac-check"><input type="checkbox" checked={d.excludeNoReply} onChange={e => set('excludeNoReply', e.target.checked)} /> {t('activities.form.excludeNoReply')}</label>
        </div>
        <Field label={t('activities.form.propose')} wide>
          <textarea rows={2} value={d.propose} onChange={e => set('propose', e.target.value)} data-testid="ac-f-propose" />
          <small>{t('activities.form.proposeHint')}</small>
        </Field>
      </div>
      {d.source === 'gmail' && !gmailConnector && <p className="ac-warn">{t('activities.gmailNote')}</p>}
      {errors.length > 0 && <div className="ac-errors" role="alert" data-testid="ac-errors"><b>{t('activities.form.errors')}</b><ul>{errors.map(e => <li key={e}>{e}</li>)}</ul></div>}
      <div className="ac-form-actions">
        <button type="submit" className="bx-btn" disabled={busy} data-testid="ac-save">{t('activities.form.save')}</button>
        <button type="button" className="bx-btn" onClick={onClose} data-testid="ac-cancel">{t('activities.form.cancel')}</button>
      </div>
    </form>
  );
}

export function ActivitiesPage() {
  const state = useActivities(s => s);
  const [editing, setEditing] = useState<{ id?: string; draft: ActivityDraft } | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  if (!state) return <section className="ac-page" data-testid="activities-page"><Loading label={t('activities.loading')} lines={4} /></section>;
  return (
    <section className="ac-page" aria-label={t('activities.title')} data-testid="activities-page">
      <header className="ac-head">
        <div>
          <h1>{t('activities.title')}</h1>
          <p className="ac-lead">{t('activities.lead')}</p>
        </div>
        <div className="ac-pause" data-testid="ac-pause">
          <Switch on={state.paused} label={t('activities.pause')} onChange={p => void setPaused(p)} testId="ac-pause-switch" />
          <span><b>{t('activities.pause')}</b><small>{state.paused ? t('activities.pauseOn') : t('activities.pauseOff')}</small></span>
        </div>
      </header>
      <div className="ac-toolbar" data-testid="ac-toolbar">
        <button type="button" className="bx-btn" onClick={() => setEditing({ draft: blankDraft() })} data-testid="ac-new">{t('activities.new')}</button>
        <span className="ac-muted">{t('activities.fromTemplate')}:</span>
        {state.templates.map(tp => <button key={tp.id} type="button" className="bx-btn s" onClick={() => setEditing({ draft: draftFromInput(tp.input) })} data-testid={`ac-template-${tp.id}`}>{tp.label}</button>)}
      </div>
      {editing && <Editor key={editing.id ?? 'new'} id={editing.id} initial={editing.draft} gmailConnector={state.gmailConnector} onClose={() => setEditing(null)} />}
      {state.activities.length === 0 && !editing ? <Empty title={t('activities.title')}>{t('activities.empty')}</Empty> : (
        <ul className="ac-list" data-testid="ac-list">
          {state.activities.map(a => (
            <li key={a.id} className="ac-item">
              <Row a={a} paused={state.paused} open={detail === a.id} onDetail={() => setDetail(d => d === a.id ? null : a.id)}
                onEdit={() => setEditing({ id: a.id, draft: draftFromInput(a) })} />
              {detail === a.id && <Detail a={a} onClose={() => setDetail(null)} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
