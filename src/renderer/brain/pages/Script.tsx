// Script: the brain's reusable, tested scripts (ADR 0076; the owner, 2026-10-19: "una sezione dedicata agli script, tutti
// gli script creati e riutilizzabili provati che funzionano"). Dashboard look: header, three numbers, search and filters,
// then one card per script in a grid (title, what it does, language, last test, tags); a card opens in place, full width,
// with how to run it, the code (credentials already masked by main), "Copia", "Apri il file" and "Discuti" (a draft for
// the Orchestrator, never sent by itself). Read-only and zero tokens: nothing here runs a script; work chats add them
// (brain_script_add), the app adds reusable "Esegui" commands that worked (ADR 0096), the Orchestrator fixes and deletes
// them (brain_script_save / brain_script_delete) and every change shows on the Log page (ADR 0111).
// Mounted by App.tsx's PageFrame. Data: /api/scripts, /api/script?id=… (main brain/scripts.ts).
import { useMemo, useState } from 'react';
import type { BrainScriptSummary } from '@shared/contract';
import { useBrain } from '../api';
import { normScript, normScripts } from '../types';
import { filterScripts, type ScriptFilter as Filter } from '../lib/brain-sections';
import { copyText } from '../components/ui';
import { toast } from '../../store/ui';
import { brainBridge, go, openFileViewer } from '../../actions';
import { locale, t } from '../../i18n';
import '../../dashboard/dashboard.css';
import '../../styles/brain-sections.css';

const day = (iso: string | null) => iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) : '';

function Tested({ s }: { s: BrainScriptSummary }) {
  const st = s.tested.state;
  const label = st === 'ok' ? t('brainText.script.tested') : st === 'failed' ? t('brainText.script.needsFix') : t('brainText.script.untested');
  return <span className={`bs-test bs-test-${st}`} title={s.tested.note || undefined} data-testid="bs-script-tested"><i aria-hidden="true">{st === 'ok' ? '✓' : st === 'failed' ? '!' : '·'}</i>{label}{s.tested.at ? ` · ${day(s.tested.at)}` : ''}</span>;
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const r = useBrain(`/api/script?id=${encodeURIComponent(id)}`, normScript);
  const d = r.data;
  if (!d) return <div className="bs-detail-body"><p className="bs-muted">{r.error ? `${t('brainText.script.cannotRead')}: ${r.error}` : t('brainText.script.loading')}</p></div>;
  const discuss = () => {
    const ok = brainBridge.draftToOrchestrator(`${t('brainText.script.brainScript')}: ${d.title} (${d.file})\n${d.description}\n${t('brainText.script.lastTest')}: ${d.tested.state}${d.tested.at ? ` ${d.tested.at}` : ''} ${d.tested.note}\n\n${t('brainText.script.reviewQuestion')}`, () => {});
    if (!ok) toast(t('brainText.script.openOrchestrator'));
  };
  return (
    <div className="bs-detail-body" data-testid="bs-script-detail">
      {d.tested.note && <p className={`bs-note bs-note-${d.tested.state}`}><b>{t('brainText.script.lastTest')}:</b> {d.tested.note}</p>}
      {d.usage && <section className="bs-usage">
        <header><span className="dash-eyebrow">{t('brainText.script.howTo')}</span>
          <button type="button" className="btn btn-subtle btn-s" onClick={() => void copyText(d.usage).then(ok => toast(ok ? t('brainText.common.commandCopied') : t('brainText.common.copyFailed')))} data-testid="bs-copy-usage">{t('brainText.common.copy')}</button></header>
        <pre><code>{d.usage}</code></pre>
      </section>}
      <section className="bs-code">
        <header><span className="dash-eyebrow">{t('brainText.script.code')} · {d.language}</span>{d.masked > 0 && <span className="bs-masked">{d.masked === 1 ? t('brainText.script.hiddenOne') : t('brainText.script.hiddenMany', { n: d.masked })}</span>}
          <button type="button" className="btn btn-subtle btn-s" onClick={() => void copyText(d.code).then(ok => toast(ok ? t('brainText.script.codeCopied') : t('brainText.common.copyFailed')))}>{t('brainText.common.copy')}</button></header>
        <pre data-testid="bs-script-code"><code>{d.code}</code></pre>
      </section>
      <div className="bs-detail-actions">
        <button type="button" className="btn btn-primary btn-s" onClick={discuss} data-testid="bs-script-discuss"><span aria-hidden="true">↗</span> {t('brainText.script.discuss')}</button>
        <button type="button" className="btn btn-ghost btn-s" onClick={() => openFileViewer(d.path)} data-testid="bs-script-open">{t('brainText.script.openFile')}</button>
        <button type="button" className="btn btn-ghost btn-s" onClick={() => void copyText(d.path).then(ok => toast(ok ? t('brainText.script.pathCopied') : t('brainText.common.copyFailed')))}>{t('brainText.script.copyPath')}</button>
        <span className="sp" />
        <button type="button" className="btn btn-subtle btn-s" onClick={onClose}>{t('brainText.script.close')}</button>
      </div>
    </div>
  );
}

function Card({ s, open, onToggle }: { s: BrainScriptSummary; open: boolean; onToggle: () => void }) {
  return (
    <article className={`bs-card${open ? ' open' : ''}`} data-testid="bs-script-card" data-id={s.id}>
      <button type="button" className="bs-card-main" aria-expanded={open} onClick={onToggle}>
        <span className="bs-card-top"><span className={`bs-lang bs-lang-${s.language.toLowerCase()}`}>{s.language}</span><Tested s={s} /></span>
        <h3>{s.title}</h3>
        <p className="bs-desc">{s.description || t('brainText.script.noDescription')}</p>
        {s.tags.length > 0 && <span className="bs-tags">{s.tags.map(t => <span key={t}>{t}</span>)}</span>}
        <span className="bs-card-foot"><code>{s.file}</code>{s.changedAt && <small>{t('brainText.script.changed')} {day(s.changedAt)}</small>}</span>
      </button>
      {open && <Detail id={s.id} onClose={onToggle} />}
    </article>
  );
}

export function Script({ arg }: { arg?: string }) {
  const list = useBrain('/api/scripts', normScripts);
  const [q, setQ] = useState('');
  const [f, setF] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(arg ? safeDecode(arg) : null);
  const all = list.data?.scripts ?? [];
  const shown = useMemo(() => filterScripts(all, q, f), [all, q, f]);
  const ok = all.filter(s => s.tested.state === 'ok').length;
  const filters: [Filter, string][] = [['all', t('brainText.script.filter.all')], ['ok', t('brainText.script.filter.ok')], ['fix', t('brainText.script.filter.fix')]];
  return (
    <div className="dashboard bs-page" data-testid="brain-scripts">
      <header className="dash-header bs-header"><div><span className="dash-eyebrow">{t('brainText.script.eyebrow')}</span><h1>Script</h1>
        <p>{t('brainText.script.lead')}</p></div>
        <button type="button" className="btn btn-ghost btn-s" onClick={() => go({ page: 'log' })} data-testid="bs-to-log"><span aria-hidden="true">↗</span> Log</button></header>
      <div className="dash-stats">
        <div className="dash-stat"><span>{t('brainText.script.inBrain')}</span><strong data-testid="bs-count">{list.data ? all.length : '—'}</strong><small>{t('brainText.script.folder')}</small></div>
        <div className="dash-stat"><span>{t('brainText.script.okTitle')}</span><strong>{list.data ? ok : '—'}</strong><small>{t('brainText.script.okNote')}</small></div>
        <div className="dash-stat"><span>{t('brainText.script.filter.fix')}</span><strong>{list.data ? all.length - ok : '—'}</strong><small>{t('brainText.script.fixNote')}</small></div>
      </div>
      <div className="bs-toolbar" role="search">
        <label className="dash-search bs-search"><span aria-hidden="true">⌕</span><input type="search" value={q} onChange={e => setQ(e.target.value)} aria-label={t('brainText.script.searchLabel')} placeholder={t('brainText.script.searchPlaceholder')} data-testid="bs-search" /></label>
        <div className="bs-chips" role="group" aria-label={t('brainText.script.filterLabel')}>{filters.map(([id, label]) => <button key={id} type="button" className="bs-chip" aria-pressed={f === id} onClick={() => setF(id)} data-testid={`bs-filter-${id}`}>{label}</button>)}</div>
      </div>
      {list.error && !list.data ? <div className="dash-empty">{t('brainText.script.cannotReadAll')}: {list.error} <button type="button" className="btn btn-subtle btn-s" onClick={() => list.reload()}>{t('brainText.common.retry')}</button></div>
        : !list.data ? <div className="bs-grid">{[0, 1, 2].map(i => <div key={i} className="bs-card bs-skeleton" />)}</div>
        : !all.length ? <div className="bs-empty" data-testid="bs-empty"><span className="dash-orbit-icon" aria-hidden="true">{'</>'}</span><h2>{t('brainText.script.emptyTitle')}</h2>
          <p>{t('brainText.script.emptyBody')}</p></div>
        : !shown.length ? <div className="dash-empty" data-testid="bs-none">{t('brainText.script.noMatch')}</div>
        : <div className="bs-grid" data-testid="bs-grid">{shown.map(s => <Card key={s.id} s={s} open={open === s.id} onToggle={() => setOpen(o => o === s.id ? null : s.id)} />)}</div>}
    </div>
  );
}

function safeDecode(s: string): string { try { return decodeURIComponent(s); } catch { return s; } }
