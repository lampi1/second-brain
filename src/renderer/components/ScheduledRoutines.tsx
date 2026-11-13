// «Pianificate» on the Routine page (ADR 0281; owner 2026-11-13: «pianificarne una tipo i pianificati di Claude
// direttamente dentro l'app»): the user's scheduled routines. Each is a request in their words and when to make it;
// at its time the app hands it to the Orchestrator, which works on it with the agents. A row says the routine, when
// it runs (in words), its next time and how the last run went, with a switch to pause it, «Esegui ora», «Modifica»
// and «Elimina». The form asks three things: a name, the request, and when (every day, working days, chosen days,
// every N hours, once, or only by hand). The Orchestrator does the same through app_schedule. The list comes from
// main (schedules:state, kept current by schedules:changed). Used by brain/pages/Routines.tsx; styles routines.css
// (.sch-*).
import { useEffect, useState } from 'react';
import type { ScheduleEdit, ScheduleWhen, ScheduledTask, SchedulesState } from '@shared/schedules';
import { sb } from '../sb';
import { locale, t } from '../i18n';
import { toast } from '../store/ui';
import { brainBridge } from '../actions';
import { Button, Modal } from './ui';
import { IconPlay, IconPlus } from './Icons';

const plain = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
type Freq = 'daily' | 'weekdays' | 'days' | 'hours' | 'once' | 'manual';
const WEEKDAYS = [1, 2, 3, 4, 5];
/** Monday first, as the user reads a week */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const dayName = (d: number, style: 'short' | 'long' = 'short') => new Date(2026, 10, 1 + d).toLocaleDateString(locale(), { weekday: style }); // 1 Nov 2026 is a Sunday

/** The rule in the user's words: «ogni giorno alle 08:00», «lun, mer alle 09:30», «ogni 2 ore», «una volta, ven 14 nov 10:00». */
export function whenLabel(w: ScheduleWhen): string {
  if (w.kind === 'manual') return t('rs.sch.when.manual');
  if (w.kind === 'once') return t('rs.sch.when.once', { at: new Date(w.at).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) });
  if (w.kind === 'every') return w.minutes % 60 === 0 ? t('rs.sch.when.hours', { n: w.minutes / 60 }) : t('rs.sch.when.minutes', { n: w.minutes });
  const days = w.days ?? [];
  if (!days.length) return t('rs.sch.when.daily', { time: w.time });
  if (days.join() === WEEKDAYS.join()) return t('rs.sch.when.weekdays', { time: w.time });
  return t('rs.sch.when.days', { days: DAY_ORDER.filter(d => days.includes(d)).map(d => dayName(d)).join(', '), time: w.time });
}
const stamp = (at: number) => new Date(at).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const localInput = (at: number) => { const d = new Date(at), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

function Form({ task, seed, onClose, onSaved }: { task?: ScheduledTask; seed?: { name: string; prompt: string }; onClose: () => void; onSaved: (s: SchedulesState) => void }) {
  const w = task?.when;
  const [name, setName] = useState(task?.name ?? seed?.name ?? '');
  const [prompt, setPrompt] = useState(task?.prompt ?? seed?.prompt ?? '');
  const [freq, setFreq] = useState<Freq>(!w ? 'daily' : w.kind === 'manual' ? 'manual' : w.kind === 'once' ? 'once' : w.kind === 'every' ? 'hours' : !w.days?.length ? 'daily' : w.days.join() === WEEKDAYS.join() ? 'weekdays' : 'days');
  const [time, setTime] = useState(w?.kind === 'daily' ? w.time : '08:00');
  const [days, setDays] = useState<number[]>(w?.kind === 'daily' && w.days?.length ? w.days : [1]);
  const [hours, setHours] = useState(w?.kind === 'every' ? Math.max(1, Math.round(w.minutes / 60)) : 2);
  const [once, setOnce] = useState(() => localInput(w?.kind === 'once' ? w.at : Date.now() + 3_600_000));
  const [busy, setBusy] = useState(false);
  // an edit that leaves the rule alone does not send it: the next run stays where it was, and a rule the form cannot
  // show exactly (every 90 minutes, made by the Orchestrator) is not rounded
  const [ruleChanged, setRuleChanged] = useState(false);
  const when = (): ScheduleWhen => freq === 'manual' ? { kind: 'manual' } : freq === 'once' ? { kind: 'once', at: new Date(once).getTime() } : freq === 'hours' ? { kind: 'every', minutes: hours * 60 }
    : { kind: 'daily', time, ...(freq === 'weekdays' ? { days: WEEKDAYS } : freq === 'days' ? { days } : {}) };
  const ok = prompt.trim().length > 0 && (freq !== 'days' || days.length > 0);
  const save = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try {
      onSaved(await sb.invoke('schedules:edit', task ? { op: 'update', id: task.id, name: name.trim() || task.name, prompt: prompt.trim(), ...(ruleChanged ? { when: when() } : {}) } : { op: 'create', name: name.trim(), prompt: prompt.trim(), when: when() }));
      onClose();
    } catch (e) { toast(plain(e), 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label={t(task ? 'rs.sch.edit' : 'rs.sch.new')} title={t(task ? 'rs.sch.edit' : 'rs.sch.new')} subtitle={t('rs.sch.formLead')} closeButton testid="schedule-form" onSubmit={() => void save()}
      footer={<><Button onClick={onClose}>{t('rs.sch.cancel')}</Button><Button variant="primary" type="submit" disabled={!ok || busy} testid="schedule-save">{t(task ? 'rs.sch.save' : 'rs.sch.create')}</Button></>}>
      <div className="sch-form">
        <label className="sch-f">{t('rs.sch.name')}
          <input value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder={t('rs.sch.namePh')} data-testid="schedule-name" />
        </label>
        <label className="sch-f">{t('rs.sch.request')}
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={4000} rows={5} placeholder={t('rs.sch.requestPh')} data-testid="schedule-prompt" autoFocus />
        </label>
        <div className="sch-when" onChange={() => setRuleChanged(true)}>
          <label className="sch-f">{t('rs.sch.freq')}
            <select value={freq} onChange={e => setFreq(e.target.value as Freq)} data-testid="schedule-freq">
              {(['daily', 'weekdays', 'days', 'hours', 'once', 'manual'] as const).map(f => <option key={f} value={f}>{t(`rs.sch.freq.${f}`)}</option>)}
            </select>
          </label>
          {(freq === 'daily' || freq === 'weekdays' || freq === 'days') && <label className="sch-f">{t('rs.sch.time')}<input type="time" value={time} onChange={e => setTime(e.target.value || '08:00')} data-testid="schedule-time" /></label>}
          {freq === 'hours' && <label className="sch-f">{t('rs.sch.everyHours')}<input type="number" min={1} max={168} value={hours} onChange={e => setHours(Math.max(1, Math.min(168, Math.round(Number(e.target.value)) || 1)))} data-testid="schedule-hours" /></label>}
          {freq === 'once' && <label className="sch-f">{t('rs.sch.onceAt')}<input type="datetime-local" value={once} onChange={e => setOnce(e.target.value)} data-testid="schedule-once" /></label>}
        </div>
        {freq === 'days' && (
          <div className="sch-days" role="group" aria-label={t('rs.sch.days')} onClick={() => setRuleChanged(true)}>
            {DAY_ORDER.map(d => <button key={d} type="button" aria-pressed={days.includes(d)} className={days.includes(d) ? 'on' : ''} onClick={() => setDays(x => (x.includes(d) ? x.filter(y => y !== d) : [...x, d].sort((a, b) => a - b)))} data-testid={`schedule-day-${d}`}>{dayName(d)}</button>)}
          </div>
        )}
        <p className="sch-note">{t('rs.sch.formNote')}</p>
      </div>
    </Modal>
  );
}

export function ScheduledRoutines() {
  const [state, setState] = useState<SchedulesState | null>(null);
  const [form, setForm] = useState<{ task?: ScheduledTask; seed?: { name: string; prompt: string } } | null>(null);
  const [sure, setSure] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const off = sb.on('schedules:changed', s => { if (live) setState(s); });
    void sb.invoke('schedules:state', undefined).then(s => { if (live) setState(x => x ?? s); }, () => {});
    return () => { live = false; off(); };
  }, []);
  const edit = async (e: ScheduleEdit) => { try { const s = await sb.invoke('schedules:edit', e); setState(s); return s; } catch (err) { toast(plain(err), 'err'); return null; } };
  const run = async (task: ScheduledTask) => { if (await edit({ op: 'run', id: task.id })) toast(t('rs.sch.started', { name: task.name }), 'ok'); };
  const tasks = state?.tasks ?? [];
  const examples = [1, 2, 3].map(n => ({ name: t(`rs.sch.ex${n}.name` as 'rs.sch.ex1.name'), prompt: t(`rs.sch.ex${n}.prompt` as 'rs.sch.ex1.prompt') }));
  return (
    <section className="sch" data-testid="schedules">
      <header className="sch-head">
        <div><h3 className="rs-section">{t('rs.sch.title')}</h3><p className="rs-muted">{t('rs.sch.lead')}</p></div>
        <span className="rs-sp" />
        <Button variant="primary" onClick={() => setForm({})} testid="schedule-new"><IconPlus size={13} />{t('rs.sch.new')}</Button>
      </header>
      {state && tasks.length === 0 && (
        <div className="sch-empty" data-testid="schedules-empty">
          <p>{t('rs.sch.empty')}</p>
          <div className="sch-ex">{examples.map(x => <button key={x.name} type="button" onClick={() => setForm({ seed: x })}><b>{x.name}</b><span>{x.prompt}</span></button>)}</div>
        </div>
      )}
      {tasks.length > 0 && (
        <ul className="sch-list">
          {tasks.map(task => {
            const last = task.runs[0];
            return (
              <li key={task.id} className={task.on ? '' : 'off'} data-testid={`schedule-${task.id}`}>
                <button type="button" role="switch" aria-checked={task.on} aria-label={`${t('rs.sch.on')}: ${task.name}`} className={`ip-switch ${task.on ? 'on' : ''}`} onClick={() => void edit({ op: 'update', id: task.id, on: !task.on })} data-testid={`schedule-toggle-${task.id}`}><b aria-hidden="true" /></button>
                <div className="sch-main">
                  <strong>{task.name}</strong>
                  <p className="sch-prompt">{task.prompt}</p>
                  <div className="sch-meta">
                    <span className="rs-badge" data-tone="blue">{whenLabel(task.when)}</span>
                    {!task.on ? <span>{t('rs.sch.paused')}</span> : task.nextAt !== null ? <span data-testid="schedule-next">{t('rs.sch.next', { at: stamp(task.nextAt) })}</span> : task.when.kind === 'manual' ? null : <span>{t('rs.sch.noNext')}</span>}
                    {last && (last.ok
                      ? <button type="button" className="sch-last ok" onClick={() => { if (last.chatId) brainBridge.showChat(last.chatId); }} data-testid="schedule-last">● {t('rs.sch.lastOk', { at: stamp(last.at) })}{last.late ? ` · ${t('rs.sch.late', { n: last.late })}` : ''}</button>
                      : <span className="sch-last err" data-testid="schedule-last">● {t('rs.sch.lastErr', { at: stamp(last.at), why: last.error ?? '' })}</span>)}
                    {task.by === 'orchestrator' && <span>{t('rs.sch.byOrchestrator')}</span>}
                  </div>
                </div>
                <div className="sch-acts">
                  <Button size="s" onClick={() => void run(task)} testid={`schedule-run-${task.id}`}><IconPlay size={12} />{t('rs.sch.runNow')}</Button>
                  <Button size="s" variant="ghost" onClick={() => setForm({ task })} testid={`schedule-edit-${task.id}`}>{t('rs.sch.editShort')}</Button>
                  {sure === task.id
                    ? <Button size="s" variant="danger" onClick={() => { setSure(null); void edit({ op: 'delete', id: task.id }); }} testid={`schedule-delete-sure-${task.id}`}>{t('rs.sch.deleteSure')}</Button>
                    : <Button size="s" variant="ghost" onClick={() => setSure(task.id)} testid={`schedule-delete-${task.id}`}>{t('rs.sch.delete')}</Button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {form && <Form {...(form.task ? { task: form.task } : {})} {...(form.seed ? { seed: form.seed } : {})} onClose={() => setForm(null)} onSaved={setState} />}
    </section>
  );
}
