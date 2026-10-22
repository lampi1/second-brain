// Script: the brain's reusable, tested scripts (ADR 0076; the owner, 2026-10-19: "una sezione dedicata agli script, tutti
// gli script creati e riutilizzabili provati che funzionano"), the first half of the Memoria hub's «Script & Query» tab
// since ADR 0122: one line with the count, search, then one card per working script in a grid (title, what it does, tags,
// then language, file and last test at the foot); a card opens in place, full width,
// with how to run it, the code (credentials already masked by main), "Copia", "Apri il file" and "Discuti" (a draft for
// the Orchestrator, never sent by itself). Read-only and zero tokens: nothing here runs a script; work chats add them
// (brain_script_add), the app adds reusable "Esegui" commands that worked (ADR 0096), the Orchestrator fixes and deletes
// them (brain_script_save / brain_script_delete) and every change shows on the Log page (ADR 0111). Only scripts whose last
// test passed show (the owner, 2026-10-22: "togliere la sezione di script che non funzionano o da provare"): the others
// stay in the brain for the Orchestrator to fix.
// Rendered by components/brain-model/MemoryPage.tsx ('script/<id>' links open that card). Data: /api/scripts, /api/script?id=… (main brain/scripts.ts).
import { useMemo, useState } from 'react';
import type { BrainScriptSummary } from '@shared/contract';
import { useBrain } from '../api';
import { normScript, normScripts } from '../types';
import { filterScripts } from '../lib/brain-sections';
import { copyText } from '../components/ui';
import { toast } from '../../store/ui';
import { brainBridge, go, openFileViewer } from '../../actions';
import { locale, t } from '../../i18n';
import { HubIntro } from '../../components/brain-model/HubIntro';
import '../../dashboard/dashboard.css';
import '../../styles/brain-sections.css';

const day = (iso: string | null) => iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) : '';

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
        <h3>{s.title}</h3>
        <p className="bs-desc">{s.description || t('brainText.script.noDescription')}</p>
        {s.tags.length > 0 && <span className="bs-tags">{s.tags.map(t => <span key={t}>{t}</span>)}</span>}
        <span className="bs-card-foot"><span className={`bs-lang bs-lang-${s.language.toLowerCase()}`}>{s.language}</span><code>{s.file}</code>
          {s.tested.at && <small title={s.tested.note || undefined} data-testid="bs-script-tested">{t('brainText.script.tested')} {day(s.tested.at)}</small>}</span>
      </button>
      {open && <Detail id={s.id} onClose={onToggle} />}
    </article>
  );
}

export function Script({ arg }: { arg?: string }) {
  const list = useBrain('/api/scripts', normScripts);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(arg ? safeDecode(arg) : null);
  const all = useMemo(() => filterScripts(list.data?.scripts ?? [], ''), [list.data]);
  const shown = useMemo(() => filterScripts(all, q), [all, q]);
  return (
    <div className="dashboard bs-page" data-testid="brain-scripts">
      <HubIntro lead={list.data ? t('mh.script.lead', { n: all.length }) : t('brainText.script.loading')}
        actions={<button type="button" className="btn btn-ghost btn-s" onClick={() => go({ page: 'log' })} data-testid="bs-to-log"><span aria-hidden="true">↗</span> Log</button>} />
      <span hidden data-testid="bs-count">{list.data ? all.length : ''}</span>
      <div className="bs-toolbar" role="search">
        <label className="dash-search bs-search"><span aria-hidden="true">⌕</span><input type="search" value={q} onChange={e => setQ(e.target.value)} aria-label={t('brainText.script.searchLabel')} placeholder={t('brainText.script.searchPlaceholder')} data-testid="bs-search" /></label>
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
