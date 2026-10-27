// The Routine page (ADR 0175, 0176): routines are self-contained packages run by packages/routine-runtime, in the app
// or from a terminal on this PC. The list shows each package (trigger on/off, «Credenziali da inserire») and every run
// read from the run folders (app and terminal); a package opens on its trigger and filters, a single work item start,
// its write-only credentials, its steps, the copyable terminal commands and its runs; a run opens on the live view.
// Import/export move the package zip (credentials included). Authoring a routine goes through the Orchestrator.
// A routine step's chat (pageArg `chat:<id>`) still opens in RoutineChat.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoutineRunDetail, RoutineRunRef, RoutineRunSummary, RoutineSummary, RoutineTriggerFilters, RoutinesSnapshot } from '@shared/routines';
import { sb } from '../../sb';
import { t } from '../../i18n';
import { ui, toast } from '../../store/ui';
import { useApp } from '../../store/store';
import { go, openFileViewer } from '../../actions';
import { copyText } from '../components/ui';
import { ago } from '../../lib/format';
import { RoutineChat } from '../../components/RoutineChat';
import { readRoutineChatArg, routinePlacements } from '../../lib/routine-chats';
import { useFlows } from '../../store/flows';
import { RoutineRunView, statusLabel, statusTone } from '../../components/RoutineRun';
import '../../styles/routines.css';

const plain = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const live = (status: string) => status === 'running' || status === 'waiting-human' || status === 'pending';
const list = (text: string) => text.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
const ids = (text: string) => list(text).map(Number).filter(n => Number.isInteger(n) && n > 0);
const missing = (r: RoutineSummary) => r.secretSlots.filter(s => !s.set).length;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
async function copy(text: string) { toast(await copyText(text) ? t('rs.copied') : t('rs.copyFailed'), 'info'); }

function usePoll<T>(load: () => Promise<T>, everyMs: number | null, deps: unknown[]): { value: T | null; error: string | null; reload: () => Promise<void> } {
  const [value, setValue] = useState<T | null>(null), [error, setError] = useState<string | null>(null);
  const ticket = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++ticket.current;
    try { const v = await load(); if (mine === ticket.current) { setValue(v); setError(null); } }
    catch (e) { if (mine === ticket.current) setError(plain(e)); }
  }, deps);
  useEffect(() => {
    void reload();
    if (everyMs === null) return;
    const timer = setInterval(() => void reload(), everyMs);
    return () => clearInterval(timer);
  }, [reload, everyMs]);
  return { value, error, reload };
}

function RunRow({ run, onOpen, now }: { run: RoutineRunSummary; onOpen: () => void; now: number }) {
  return <button type="button" className="rs-row" onClick={onOpen} data-testid={`routine-run-${run.runId}`} data-status={run.status}>
    <span className="rs-badge" data-tone={statusTone(run.status)}>{statusLabel(run.status)}</span>
    <span className="rs-badge" data-tone="grey">{run.source === 'app' ? t('rs.source.app') : t('rs.source.terminal')}</span>
    <strong className="rs-row-title">{run.title}</strong>
    {run.workItem !== undefined && <span>{t('rs.workItem', { id: run.workItem })}</span>}
    <span className="rs-row-step">{run.waiting ? t('rs.waitingShort') : run.step ? t('rs.stepOf', { n: run.step.n, total: run.step.total }) + ' · ' + run.step.title : run.error ?? ''}</span>
    <span className="rs-sp" />
    <span className="rs-muted">{ago(run.updatedAt, now)}</span>
  </button>;
}

function TriggerForm({ routine, onSaved }: { routine: RoutineSummary; onSaved: (s: RoutinesSnapshot) => void }) {
  const tr = routine.trigger!;
  const [states, setStates] = useState(tr.states.join(', ')), [include, setInclude] = useState(tr.includeTags.join(', '));
  const [exclude, setExclude] = useState(tr.excludeTags.join(', ')), [only, setOnly] = useState(tr.workItemIds.join(', '));
  const [every, setEvery] = useState(String(tr.everyMinutes)), [maxPerHour, setMax] = useState(tr.maxPerHour ? String(tr.maxPerHour) : '');
  const [busy, setBusy] = useState(false);
  const filters = (): RoutineTriggerFilters => ({
    everyMinutes: Math.max(1, Number(every) || tr.everyMinutes), states: list(states), includeTags: list(include), excludeTags: list(exclude),
    workItemIds: ids(only), ...(Number(maxPerHour) > 0 ? { maxPerHour: Number(maxPerHour) } : {}),
  });
  const save = async (enabled: boolean, withFilters: boolean) => {
    setBusy(true);
    try { onSaved(await sb.invoke('routines:setTrigger', { id: routine.id, enabled, ...(withFilters ? { filters: filters() } : {}) })); }
    catch (e) { toast(plain(e), 'err'); }
    finally { setBusy(false); }
  };
  const blocked = missing(routine) > 0;
  return <section className="rs-card" data-testid="routine-trigger">
    <header className="rs-card-head">
      <h3>{t('rs.trigger')}</h3>
      <span className="rs-muted">{tr.organization}/{tr.project} · {tr.workItemType}{tr.areaPath ? ` · ${tr.areaPath}` : ''}</span>
      <span className="rs-sp" />
      <label className="rs-switch">
        <input type="checkbox" checked={tr.enabled} disabled={busy || (blocked && !tr.enabled)} onChange={e => void save(e.target.checked, false)} data-testid="routine-trigger-toggle" />
        <span>{tr.enabled ? t('rs.triggerOn') : t('rs.triggerOff')}</span>
      </label>
    </header>
    {blocked && !tr.enabled && <p className="rs-warn">{t('rs.secretsFirst')}</p>}
    {tr.lastCheckAt && <p className="rs-muted">{t('rs.lastCheck', { when: ago(tr.lastCheckAt, Date.now()) })}{tr.lastResult ? ` · ${tr.lastResult}` : ''}</p>}
    <div className="rs-grid">
      <label>{t('rs.f.states')}<input value={states} onChange={e => setStates(e.target.value)} data-testid="routine-filter-states" /></label>
      <label>{t('rs.f.include')}<input value={include} onChange={e => setInclude(e.target.value)} data-testid="routine-filter-include" /></label>
      <label>{t('rs.f.exclude')}<input value={exclude} onChange={e => setExclude(e.target.value)} /></label>
      <label>{t('rs.f.ids')}<input value={only} onChange={e => setOnly(e.target.value)} placeholder={t('rs.f.idsHint')} /></label>
      <label>{t('rs.f.every')}<input type="number" min={1} value={every} onChange={e => setEvery(e.target.value)} /></label>
      <label>{t('rs.f.max')}<input type="number" min={0} value={maxPerHour} onChange={e => setMax(e.target.value)} /></label>
    </div>
    <div className="rs-actions"><button type="button" className="btn btn-ghost btn-s" disabled={busy} onClick={() => void save(tr.enabled, true)} data-testid="routine-filters-save">{t('rs.f.save')}</button></div>
  </section>;
}

function SecretsForm({ routine, onSaved }: { routine: RoutineSummary; onSaved: (s: RoutinesSnapshot) => void }) {
  const [values, setValues] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false);
  if (routine.secretSlots.length === 0) return null;
  const todo = missing(routine);
  const save = async () => {
    setBusy(true);
    try { onSaved(await sb.invoke('routines:setSecrets', { id: routine.id, values })); setValues({}); toast(t('rs.secretsSaved'), 'info'); }
    catch (e) { toast(plain(e), 'err'); }
    finally { setBusy(false); }
  };
  const fieldLabel = (field: string) => field === 'user' ? t('rs.s.user') : field === 'token' ? t('rs.s.token') : t('rs.s.password');
  return <section className="rs-card" data-testid="routine-secrets">
    <header className="rs-card-head"><h3>{t('rs.secrets')}</h3>{todo > 0 && <span className="rs-badge" data-tone="red">{t('rs.secretsMissing')}</span>}</header>
    <p className="rs-muted">{t('rs.secretsHint')}</p>
    <div className="rs-grid">
      {routine.secretSlots.map(s => <label key={s.slot}>
        <span>{s.label} · {fieldLabel(s.field)} {s.set ? <em className="rs-muted">{t('rs.s.set')}</em> : <em className="rs-red">{t('rs.s.missing')}</em>}</span>
        <input type="password" autoComplete="new-password" value={values[s.slot] ?? ''} placeholder={s.set ? '••••••••' : ''}
          onChange={e => setValues(v => ({ ...v, [s.slot]: e.target.value }))} data-testid={`routine-secret-${s.slot}`} />
      </label>)}
    </div>
    <div className="rs-actions"><button type="button" className="btn btn-primary btn-s" disabled={busy || !Object.values(values).some(Boolean)} onClick={() => void save()} data-testid="routine-secrets-save">{t('rs.s.save')}</button></div>
  </section>;
}

function RoutineDetail({ routine, runs, onBack, onOpenRun, onSaved, now }: {
  routine: RoutineSummary; runs: RoutineRunSummary[]; onBack: () => void; onOpenRun: (r: RoutineRunRef) => void; onSaved: (s: RoutinesSnapshot) => void; now: number;
}) {
  const [item, setItem] = useState(''), [busy, setBusy] = useState(false);
  const blocked = missing(routine) > 0;
  const start = async () => {
    const workItem = Number(item);
    if (!Number.isInteger(workItem) || workItem <= 0) { toast(t('rs.badItem'), 'warn'); return; }
    setBusy(true);
    try { const ref = await sb.invoke('routines:startItem', { id: routine.id, workItem }); toast(t('rs.started'), 'info'); onOpenRun(ref); }
    catch (e) { toast(plain(e), 'err'); }
    finally { setBusy(false); }
  };
  const exportZip = async () => {
    // main writes the filled zip under the terminal's packages folder: only its path and the secrets' names come back
    try {
      const z = await sb.invoke('routines:export', { id: routine.id });
      toast(t('rs.exported', { path: z.path, filled: z.filled.length, missing: z.missing.map(m => `${m.secret} (${m.reason})`).join('; ') }), z.missing.length ? 'warn' : 'info');
    }
    catch (e) { toast(plain(e), 'err'); }
  };
  const itemCommand = routine.commands.item.replace('workItem=ID', `workItem=${Number(item) > 0 ? Number(item) : 'ID'}`);
  return <div className="rs-detail" data-testid="routine-detail">
    <header className="rs-head">
      <button type="button" className="btn btn-ghost btn-s" onClick={onBack}>← {t('rs.back')}</button>
      <div><h2>{routine.title}</h2>{routine.description && <p className="rs-muted">{routine.description}</p>}</div>
      <span className="rs-sp" />
      <button type="button" className="btn btn-ghost btn-m" onClick={() => void exportZip()} data-testid="routine-export">{t('rs.export')}</button>
    </header>
    {(routine.secrets.logins.length > 0 || routine.secrets.devopsPat || routine.secrets.testDbs > 0) && <p className="rs-warn">{t('rs.exportWarn')}</p>}

    <section className="rs-card">
      <header className="rs-card-head"><h3>{t('rs.startTitle')}</h3></header>
      <div className="rs-inline">
        <input inputMode="numeric" value={item} onChange={e => setItem(e.target.value.replace(/\D/g, ''))} placeholder={t('rs.itemPlaceholder')} data-testid="routine-item-input"
          onKeyDown={e => { if (e.key === 'Enter') void start(); }} />
        <button type="button" className="btn btn-primary btn-s" disabled={busy || blocked || !item} onClick={() => void start()} data-testid="routine-item-start">▶ {t('rs.start')}</button>
      </div>
      {blocked && <p className="rs-warn">{t('rs.secretsFirst')}</p>}
    </section>

    {routine.trigger && <TriggerForm key={JSON.stringify(routine.trigger)} routine={routine} onSaved={onSaved} />}
    <SecretsForm routine={routine} onSaved={onSaved} />

    <section className="rs-card">
      <header className="rs-card-head"><h3>{t('rs.steps')}</h3>{routine.escalation && <span className="rs-muted">{t('rs.escalation', { who: routine.escalation })}</span>}</header>
      <ol className="rs-steps">{routine.steps.map(s => <li key={s.id} className="rs-step">
        <strong>{s.title}</strong>
        <span className="rs-muted">{[s.model, s.effort, ...s.mcpServers, ...s.testDbs].filter(Boolean).join(' · ')}</span>
      </li>)}</ol>
    </section>

    <section className="rs-card" data-testid="routine-commands">
      <header className="rs-card-head"><h3>{t('rs.commands')}</h3></header>
      {([['rs.cmd.run', routine.commands.run], ['rs.cmd.item', itemCommand], ['rs.cmd.watch', routine.commands.watch]] as const).map(([label, cmd]) => <div key={label} className="rs-cmd">
        <span className="rs-muted">{t(label)}</span><code>{cmd}</code>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => void copy(cmd)}>{t('rs.copy')}</button>
      </div>)}
    </section>

    <section className="rs-card">
      <header className="rs-card-head"><h3>{t('rs.runs')}</h3></header>
      {runs.length === 0 ? <p className="rs-muted">{t('rs.noRuns')}</p> : runs.map(r => <RunRow key={`${r.source}/${r.runId}`} run={r} now={now} onOpen={() => onOpenRun(r)} />)}
    </section>
  </div>;
}

function RunPage({ runRef, onBack }: { runRef: RoutineRunRef; onBack: () => void }) {
  const [following, setFollowing] = useState(true);
  const { value: run, error, reload } = usePoll<RoutineRunDetail>(() => sb.invoke('routines:run', runRef), following ? 1500 : null, [runRef.source, runRef.routineId, runRef.runId, following]);
  useEffect(() => { if (run && !live(run.status)) setFollowing(false); }, [run]);
  const cancel = async () => {
    try { await sb.invoke('routines:cancel', runRef); toast(t('rs.cancelled'), 'info'); setFollowing(true); void reload(); }
    catch (e) { toast(plain(e), 'err'); }
  };
  return <div className="rs-detail">
    <header className="rs-head">
      <button type="button" className="btn btn-ghost btn-s" onClick={onBack}>← {t('rs.back')}</button>
      <h2>{run?.title ?? runRef.routineId}</h2>
    </header>
    {error && <p className="rs-error" role="alert">{error}</p>}
    {run && <RoutineRunView run={run} onOpenFile={path => openFileViewer(path)} onCopy={text => void copy(text)} onCancel={() => void cancel()} />}
  </div>;
}

type View = { kind: 'list' } | { kind: 'routine'; id: string } | { kind: 'run'; ref: RoutineRunRef; from?: string };

export function Routines() {
  const { snapshot: flows } = useFlows();
  const chatArg = ui.use(state => state.page === 'flussi' ? readRoutineChatArg(state.pageArg) : null);
  const routineChat = useApp(state => chatArg && routinePlacements(state.chats, flows).has(chatArg.chatId) ? chatArg.chatId : null);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [override, setOverride] = useState<RoutinesSnapshot | null>(null);
  const { value, error, reload } = usePoll<RoutinesSnapshot>(() => sb.invoke('routines:list', undefined), view.kind === 'run' ? null : 3000, []);
  useEffect(() => { if (value) setOverride(null); }, [value]);
  const snapshot = override ?? value;
  const fileInput = useRef<HTMLInputElement>(null);
  const now = Date.now();
  const saved = (s: RoutinesSnapshot) => { setOverride(s); void reload(); };
  const importZip = async (file: File) => {
    try { saved(await sb.invoke('routines:import', { data: toBase64(await file.arrayBuffer()) })); toast(t('rs.imported'), 'info'); }
    catch (e) { toast(plain(e), 'err'); }
  };
  const convert = async (flowId: string) => {
    try { saved(await sb.invoke('routines:convert', { flowId })); }
    catch (e) { toast(plain(e), 'err'); }
  };
  if (routineChat) return <RoutineChat chatId={routineChat} tabId={chatArg?.tabId} onClose={() => go({ page: 'flussi' })} />;

  const opened = view.kind === 'routine' ? snapshot?.routines.find(r => r.id === view.id) : undefined;
  return <section className="rs-page" data-testid="routines-page">
    {view.kind === 'run' ? <RunPage runRef={view.ref} onBack={() => setView(view.from ? { kind: 'routine', id: view.from } : { kind: 'list' })} />
      : opened ? <RoutineDetail routine={opened} runs={snapshot!.runs.filter(r => r.routineId === opened.id)} now={now} onSaved={saved}
          onBack={() => setView({ kind: 'list' })} onOpenRun={ref => setView({ kind: 'run', ref, from: opened.id })} />
      : <>
        <header className="rs-head">
          <div><h1>{t('rs.title')}</h1><p className="rs-muted">{t('rs.intro')}</p></div>
          <span className="rs-sp" />
          <input ref={fileInput} type="file" accept=".zip,application/zip" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importZip(f); }} data-testid="routine-import-file" />
          <button type="button" className="btn btn-ghost btn-m" onClick={() => fileInput.current?.click()} data-testid="routine-import">{t('rs.import')}</button>
        </header>
        {(error ?? snapshot?.error) && <p className="rs-error" role="alert">{error ?? snapshot?.error}</p>}
        {!snapshot && !error && <p role="status" className="rs-muted">{t('rs.loading')}</p>}
        {snapshot && snapshot.legacy.length > 0 && <section className="rs-card">
          <header className="rs-card-head"><h3>{t('rs.legacy')}</h3></header>
          {snapshot.legacy.map(l => <div key={l.flowId} className="rs-inline">
            <strong>{l.title}</strong><span className="rs-error">{l.error}</span><span className="rs-sp" />
            <button type="button" className="btn btn-ghost btn-s" onClick={() => void convert(l.flowId)}>{t('rs.convert')}</button>
          </div>)}
        </section>}
        {snapshot && <>
          <h3 className="rs-section">{t('rs.routines')}</h3>
          {snapshot.routines.length === 0 ? <p className="rs-muted" data-testid="routines-empty">{t('rs.empty')}</p>
            : <div className="rs-cards">{snapshot.routines.map(r => {
              const runs = snapshot.runs.filter(x => x.routineId === r.id), waiting = runs.filter(x => x.status === 'waiting-human' || x.status === 'needs-human').length;
              return <button key={r.id} type="button" className="rs-routine" onClick={() => setView({ kind: 'routine', id: r.id })} data-testid={`routine-card-${r.id}`}>
                <strong>{r.title}</strong>
                <span className="rs-muted">{t('rs.stepsCount', { n: r.steps.length })}</span>
                <span className="rs-badges">
                  {r.trigger && <span className="rs-badge" data-tone={r.trigger.enabled ? 'green' : 'grey'}>{r.trigger.enabled ? t('rs.triggerOn') : t('rs.triggerOff')}</span>}
                  {missing(r) > 0 && <span className="rs-badge" data-tone="red">{t('rs.secretsMissing')}</span>}
                  {waiting > 0 && <span className="rs-badge" data-tone="red">{t('rs.waitingCount', { n: waiting })}</span>}
                </span>
              </button>;
            })}</div>}
          <h3 className="rs-section">{t('rs.runs')}</h3>
          {snapshot.runs.length === 0 ? <p className="rs-muted">{t('rs.noRuns')}</p>
            : <div className="rs-rows">{snapshot.runs.map(r => <RunRow key={`${r.source}/${r.routineId}/${r.runId}`} run={r} now={now} onOpen={() => setView({ kind: 'run', ref: r })} />)}</div>}
          <p className="rs-muted rs-dir">{t('rs.dirs', { app: snapshot.dirs.appRuns, terminal: snapshot.dirs.terminalRuns })}</p>
        </>}
      </>}
  </section>;
}
