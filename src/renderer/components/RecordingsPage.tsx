// The Registrazioni page (ADR 0154; owner 2026-10-24: «un pulsante … che alla fine la registrazione butta fuori … a zero
// token»): «Registra call» records the PC's audio and the microphone (lib/recorder.ts), the list of recordings with their
// state (transcribing with its progress, ready, failed with «Riprova»), the selected one's transcript (time, «Tu» or
// «Altri», the words; search, copy, «Chiedi all'Orchestrator» drafts a message that names it), «Importa un file» and
// «Trovate sul PC» (audio and video of the last weeks in the usual folders). Everything stays on this PC. Mounted by
// App.tsx's PageFrame; styles in styles/recordings.css.
import { useEffect, useMemo, useRef, useState } from 'react';
import { clock, turns, whoLabel, type RecFound, type RecSegment, type Recording } from '@shared/recordings';
import { importFile, importFound, recorder, recs, startRecs, toggleCall } from '../lib/recorder';
import { brainBridge } from '../actions';
import { askConfirm, toast } from '../store/ui';
import { locale, t } from '../i18n';
import { Button } from './ui';
import { IconArrowDown, IconCopy, IconFolder, IconMic, IconPlay, IconRefresh, IconSearch, IconSparkle, IconStop, IconTrash, IconFile } from './Icons';
import '../styles/recordings.css';

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
const fail = (e: unknown) => toast(`${t('rec.failed')} ${errText(e)}`, 'err');

function when(at: number): string {
  const d = new Date(at), today = new Date();
  const hm = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(today) - day(d)) / 86_400_000);
  if (diff === 0) return t('rec.today', { time: hm });
  if (diff === 1) return t('rec.yesterday', { time: hm });
  return `${d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' })} ${hm}`;
}
const minutes = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : ms < 3600_000 ? `${Math.round(ms / 60_000)} min` : clock(ms));
const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);

function Status({ r }: { r: Recording }) {
  const label = r.status === 'transcribing' ? t('rec.status.transcribing', { pct: Math.round((r.progress ?? 0) * 100) }) : t(`rec.status.${r.status}`);
  return <span className={`rec-chip rec-chip-${r.status}`} data-testid={`rec-status-${r.id}`}>{label}</span>;
}

function Meter({ label, level, off }: { label: string; level: number; off?: boolean }) {
  return (
    <span className={`rec-meter ${off ? 'off' : ''}`}>
      <span className="rec-meter-label">{label}</span>
      <span className="rec-meter-bars" aria-hidden="true">{[0.08, 0.2, 0.35, 0.5, 0.7].map((x, i) => <i key={i} className={!off && level > x ? 'on' : ''} />)}</span>
    </span>
  );
}

/** The live recording: the timer, both sides' meters, «Ferma». */
function LiveCard() {
  const rec = recorder.use(s => s);
  if (rec.phase === 'off') return null;
  return (
    <div className="rec-live" data-testid="rec-live" role="status">
      <span className="rec-live-dot" aria-hidden="true" />
      <span className="rec-live-title">{rec.phase === 'starting' ? t('rec.starting') : rec.phase === 'stopping' ? t('rec.stopping') : t('rec.recording')}</span>
      <span className="rec-live-time" data-testid="rec-live-time">{clock(rec.ms)}</span>
      <Meter label={t('rec.me')} level={rec.me} />
      <Meter label={t('rec.others')} level={rec.others} off={!rec.systemAudio && rec.phase === 'on'} />
      <span className="rec-live-src">{rec.phase === 'on' ? (rec.systemAudio ? t('rec.srcBoth') : t('rec.srcMic')) : ''}</span>
      <Button variant="danger" size="s" onClick={() => void toggleCall()} disabled={rec.phase === 'stopping'} testid="rec-stop"><IconStop size={12} />{t('rec.stop')}</Button>
    </div>
  );
}

function Transcript({ r }: { r: Recording }) {
  const [segs, setSegs] = useState<RecSegment[] | null>(null);
  const [q, setQ] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(r.title);
  useEffect(() => {
    let live = true;
    setSegs(null);
    if (r.status === 'ready') void window.sb.invoke('rec:transcript', { id: r.id }).then(x => { if (live) setSegs(x.segments); }, () => { if (live) setSegs([]); });
    return () => { live = false; };
  }, [r.id, r.status, r.transcribedAt]);
  useEffect(() => { setName(r.title); setRenaming(false); }, [r.id, r.title]);
  const lines = useMemo(() => turns(segs ?? []), [segs]);
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? lines.filter(l => words.every(w => l.text.toLowerCase().includes(w))) : lines;
  }, [lines, q]);
  const text = () => lines.map(l => `[${clock(l.start)}]${l.who ? ` ${whoLabel(l.who)}:` : ''} ${l.text}`).join('\n');
  const rename = () => { setRenaming(false); if (name.trim() && name.trim() !== r.title) void window.sb.invoke('rec:rename', { id: r.id, title: name }).catch(fail); };
  const ask = () => {
    const ok = brainBridge.draftToOrchestrator(t('rec.askDraft', { title: r.title, id: r.id }), () => {});
    if (!ok) toast(t('rec.noOrchestrator'), 'err');
  };
  const remove = () => askConfirm({ title: t('rec.delete'), body: t('rec.confirmDelete', { title: r.title }), confirmLabel: t('rec.delete'), danger: true,
    onConfirm: () => void window.sb.invoke('rec:remove', { id: r.id }).catch(fail) });
  return (
    <section className="rec-detail" data-testid="rec-detail" aria-label={r.title}>
      <header className="rec-detail-head">
        {renaming
          ? <input className="rec-rename" value={name} autoFocus onChange={e => setName(e.target.value)} onBlur={rename} onKeyDown={e => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') { setName(r.title); setRenaming(false); } }} data-testid="rec-rename" aria-label={t('rec.rename')} />
          : <h2 className="rec-detail-title" onDoubleClick={() => setRenaming(true)} data-tip={t('rec.renameTip')}>{r.title}</h2>}
        <span className="rec-detail-meta">{when(r.startedAt)} · {minutes(r.durationMs)} · {r.source === 'call' ? (r.systemAudio === false ? t('rec.srcMic') : t('rec.srcBoth')) : t('rec.srcFile', { name: r.from ?? '' })}</span>
        <span className="rec-detail-actions">
          <Button size="s" onClick={() => void window.sb.invoke('rec:open', { id: r.id, what: 'audio' }).catch(fail)} testid="rec-play"><IconPlay size={11} />{t('rec.listen')}</Button>
          {r.status === 'ready' && <Button size="s" onClick={() => void window.sb.invoke('rec:open', { id: r.id, what: 'text' }).catch(fail)} testid="rec-open-text"><IconFile size={12} />{t('rec.openText')}</Button>}
          <Button size="s" onClick={() => void window.sb.invoke('rec:open', { id: r.id, what: 'folder' }).catch(fail)} tip={t('rec.folder')} aria-label={t('rec.folder')} testid="rec-folder"><IconFolder size={12} /></Button>
          <Button size="s" onClick={remove} tip={t('rec.delete')} aria-label={t('rec.delete')} testid="rec-delete"><IconTrash size={12} /></Button>
        </span>
      </header>

      {r.status === 'transcribing' && (
        <div className="rec-progress" data-testid="rec-progress">
          <span>{t('rec.transcribingLong')}</span>
          <span className="rec-bar"><i style={{ width: `${Math.round((r.progress ?? 0) * 100)}%` }} /></span>
        </div>
      )}
      {r.status === 'queued' && <p className="rec-note">{t('rec.queuedLong')}</p>}
      {(r.status === 'saved' || r.status === 'error') && (
        <div className="rec-progress">
          <span className={r.status === 'error' ? 'rec-err' : ''}>{r.status === 'error' ? t('rec.errorLong', { error: r.error ?? '' }) : t('rec.savedLong')}</span>
          <Button variant="primary" size="s" onClick={() => void window.sb.invoke('rec:transcribe', { id: r.id }).catch(fail)} testid="rec-transcribe">
            <IconRefresh size={12} />{r.status === 'error' ? t('rec.retry') : t('rec.transcribe')}
          </Button>
        </div>
      )}

      {r.status === 'ready' && (
        <>
          <div className="rec-tools">
            <label className="rec-search"><IconSearch size={13} /><input value={q} onChange={e => setQ(e.target.value)} placeholder={t('rec.search')} data-testid="rec-search" /></label>
            <Button size="s" onClick={ask} testid="rec-ask"><IconSparkle size={12} />{t('rec.ask')}</Button>
            <Button size="s" onClick={() => void navigator.clipboard.writeText(text()).then(() => toast(t('rec.copied'), 'ok'), fail)} testid="rec-copy"><IconCopy size={12} />{t('rec.copy')}</Button>
          </div>
          <ol className="rec-lines" data-testid="rec-lines">
            {segs === null && <li className="rec-note">{t('rec.loading')}</li>}
            {segs !== null && !lines.length && <li className="rec-note">{t('rec.empty')}</li>}
            {shown.map((l, i) => (
              <li key={`${l.start}-${i}`} className={`rec-line ${l.who ?? 'one'}`}>
                <span className="rec-time">{clock(l.start)}</span>
                {l.who && <span className="rec-who">{l.who === 'me' ? t('rec.me') : t('rec.others')}</span>}
                <span className="rec-text">{l.text}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function FoundOnPc() {
  const [found, setFound] = useState<RecFound[] | null>(null);
  const [busy, setBusy] = useState(false);
  const importing = recorder.use(s => s.importing);
  const look = () => { setBusy(true); void window.sb.invoke('rec:find', undefined).then(setFound, e => { fail(e); setFound([]); }).finally(() => setBusy(false)); };
  useEffect(look, []);
  return (
    <section className="rec-found" data-testid="rec-found">
      <header><h3>{t('rec.foundTitle')}</h3><Button size="s" onClick={look} disabled={busy} tip={t('rec.foundRefresh')} aria-label={t('rec.foundRefresh')} testid="rec-found-refresh"><IconRefresh size={12} /></Button></header>
      <p className="rec-note">{t('rec.foundLead')}</p>
      {found && !found.length && <p className="rec-note">{t('rec.foundNone')}</p>}
      <ul>
        {(found ?? []).slice(0, 12).map(f => (
          <li key={f.path} className="rec-found-row" data-tip={f.path}>
            <span className="rec-found-name">{f.name}</span>
            <span className="rec-found-meta">{f.folder} · {when(f.mtime)} · {mb(f.size)}</span>
            <Button size="s" disabled={f.name in importing} onClick={() => void importFound(f.path).then(look)} testid="rec-found-import">
              {f.name in importing ? `${Math.round((importing[f.name] ?? 0) * 100)}%` : t('rec.import')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RecordingsPage() {
  startRecs();
  const state = recs.use(s => s);
  const phase = recorder.use(s => s.phase);
  const importing = recorder.use(s => s.importing);
  const [sel, setSel] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const list = state?.list ?? [];
  const current = list.find(r => r.id === sel) ?? list.find(r => r.status !== 'recording') ?? null;
  return (
    <div className="bx bx-page bx-scroll rec-page" data-testid="recordings-page" role="region" aria-label={t('brainPages.nav.registrazioni')}>
      <div className="bx-inner rec-inner">
        <header className="rec-head">
          <div>
            <h1>{t('brainPages.nav.registrazioni')}</h1>
            <p className="rec-lead">{t('rec.lead')}</p>
          </div>
          <span className="rec-head-actions">
            <input ref={file} type="file" hidden accept="audio/*,video/*,.m4a,.mkv,.opus" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} data-testid="rec-file" />
            <Button onClick={() => file.current?.click()} testid="rec-import"><IconArrowDown size={13} />{t('rec.importFile')}</Button>
            <Button variant="danger" className="rec-cta" onClick={() => void toggleCall()} disabled={phase === 'starting' || phase === 'stopping'} testid="rec-toggle" aria-pressed={phase !== 'off'}>
              {phase === 'off' ? <><span className="rec-cta-dot" aria-hidden="true" />{t('rec.start')}</> : <><IconStop size={12} />{t('rec.stop')}</>}
            </Button>
          </span>
        </header>
        <LiveCard />
        <div className="rec-body">
          <aside className="rec-side">
            <ul className="rec-list" data-testid="rec-list">
              {Object.entries(importing).map(([name, p]) => (
                <li key={`imp-${name}`} className="rec-card importing"><span className="rec-card-title">{name}</span><span className="rec-card-meta"><span className="rec-chip rec-chip-queued">{t('rec.importing', { pct: Math.round(p * 100) })}</span></span></li>
              ))}
              {list.filter(r => r.status !== 'recording').map(r => (
                <li key={r.id}>
                  <button type="button" className={`rec-card ${current?.id === r.id ? 'on' : ''}`} onClick={() => setSel(r.id)} data-testid={`rec-card-${r.id}`} aria-current={current?.id === r.id ? 'true' : undefined}>
                    <span className="rec-card-title"><span className={`rec-kind ${r.source}`} aria-hidden="true">{r.source === 'call' ? <IconMic size={11} /> : <IconFile size={11} />}</span>{r.title}</span>
                    <span className="rec-card-meta">{when(r.startedAt)} · {minutes(r.durationMs)} <Status r={r} /></span>
                  </button>
                </li>
              ))}
            </ul>
            {!list.length && !Object.keys(importing).length && (
              <div className="rec-empty" data-testid="rec-empty"><span className="rec-empty-dot" aria-hidden="true" /><p>{t('rec.emptyList')}</p></div>
            )}
            <FoundOnPc />
          </aside>
          {current ? <Transcript r={current} /> : <section className="rec-detail rec-detail-empty"><p>{t('rec.pick')}</p></section>}
        </div>
        <p className="rec-foot" data-testid="rec-foot">{t('rec.foot', { dir: state?.dir ?? '' })}</p>
      </div>
    </div>
  );
}

/** The REC pill in the top bar: on every page while a call is recorded; a click opens the page, ■ stops. */
export function RecPill({ onOpen }: { onOpen: () => void }) {
  const rec = recorder.use(s => s);
  if (rec.phase === 'off') return null;
  return (
    <span className="rec-pill" data-testid="rec-pill" role="status">
      <button type="button" className="rec-pill-main" onClick={onOpen} aria-label={t('rec.pillOpen')}>
        <span className="rec-live-dot" aria-hidden="true" /><span className="rec-pill-label">{t('rec.pill')}</span><span className="rec-pill-time">{clock(rec.ms)}</span>
        {rec.phase === 'on' && <span className="rec-pill-src">· {rec.systemAudio ? t('rec.srcBoth') : t('rec.srcMic')}</span>}
      </button>
      <button type="button" className="rec-pill-stop" onClick={() => void toggleCall()} aria-label={t('rec.stop')} data-tip={t('rec.stop')} data-testid="rec-pill-stop"><IconStop size={10} /></button>
    </span>
  );
}
