// Script: the brain's reusable, tested scripts (ADR 0076; the owner, 2026-10-19: "una sezione dedicata agli script, tutti
// gli script creati e riutilizzabili provati che funzionano"). Dashboard look: header, three numbers, search and filters,
// then one card per script in a grid (title, what it does, language, last test, tags); a card opens in place, full width,
// with how to run it, the code (credentials already masked by main), "Copia", "Apri il file" and "Discutine" (a draft for
// the Orchestrator, never sent by itself). Read-only and zero tokens: nothing here runs a script; the Orchestrator adds,
// fixes and deletes them (brain_script_save / brain_script_delete) and every change shows on the Changelog page.
// Mounted by App.tsx's PageFrame. Data: /api/scripts, /api/script?id=… (main brain/scripts.ts).
import { useMemo, useState } from 'react';
import type { BrainScriptSummary } from '@shared/contract';
import { useBrain } from '../api';
import { normScript, normScripts } from '../types';
import { filterScripts, type ScriptFilter as Filter } from '../lib/brain-sections';
import { copyText } from '../components/ui';
import { toast } from '../../store/ui';
import { brainBridge, go, openFileViewer } from '../../actions';
import { lang, locale } from '../../i18n';
import '../../dashboard/dashboard.css';
import '../../styles/brain-sections.css';

const copy = (it: string, en: string) => lang() === 'en' ? en : it;
const day = (iso: string | null) => iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) : '';

function Tested({ s }: { s: BrainScriptSummary }) {
  const st = s.tested.state;
  const label = st === 'ok' ? copy('Provato', 'Tested') : st === 'failed' ? copy('Da correggere', 'Needs a fix') : copy('Non provato', 'Untested');
  return <span className={`bs-test bs-test-${st}`} title={s.tested.note || undefined} data-testid="bs-script-tested"><i aria-hidden="true">{st === 'ok' ? '✓' : st === 'failed' ? '!' : '·'}</i>{label}{s.tested.at ? ` · ${day(s.tested.at)}` : ''}</span>;
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const r = useBrain(`/api/script?id=${encodeURIComponent(id)}`, normScript);
  const d = r.data;
  if (!d) return <div className="bs-detail-body"><p className="bs-muted">{r.error ? `${copy('Non riesco a leggere lo script', 'Cannot read the script')}: ${r.error}` : copy('Carico…', 'Loading…')}</p></div>;
  const discuss = () => {
    const ok = brainBridge.draftToOrchestrator(`${copy('Script del brain', 'Brain script')}: ${d.title} (${d.file})\n${d.description}\n${copy('Ultimo test', 'Last test')}: ${d.tested.state}${d.tested.at ? ` ${d.tested.at}` : ''} ${d.tested.note}\n\n${copy('Rivediamolo: è ancora giusto? Va corretto, esteso o eliminato?', 'Let us review it: is it still right? Should it be fixed, extended or deleted?')}`, () => {});
    if (!ok) toast(copy('Apri un Orchestrator per discuterne.', 'Open an Orchestrator to discuss it.'));
  };
  return (
    <div className="bs-detail-body" data-testid="bs-script-detail">
      {d.tested.note && <p className={`bs-note bs-note-${d.tested.state}`}><b>{copy('Ultimo test', 'Last test')}:</b> {d.tested.note}</p>}
      {d.usage && <section className="bs-usage">
        <header><span className="dash-eyebrow">{copy('COME SI USA', 'HOW TO RUN IT')}</span>
          <button type="button" className="btn btn-subtle btn-s" onClick={() => void copyText(d.usage).then(ok => toast(ok ? copy('Comando copiato', 'Command copied') : copy('Copia non riuscita', 'Copy failed')))} data-testid="bs-copy-usage">{copy('Copia', 'Copy')}</button></header>
        <pre><code>{d.usage}</code></pre>
      </section>}
      <section className="bs-code">
        <header><span className="dash-eyebrow">{copy('CODICE', 'CODE')} · {d.language}</span>{d.masked > 0 && <span className="bs-masked">{d.masked === 1 ? copy('1 riga nascosta: può contenere una credenziale', '1 line hidden: it may hold a credential') : copy(`${d.masked} righe nascoste: possono contenere credenziali`, `${d.masked} lines hidden: they may hold credentials`)}</span>}
          <button type="button" className="btn btn-subtle btn-s" onClick={() => void copyText(d.code).then(ok => toast(ok ? copy('Codice copiato', 'Code copied') : copy('Copia non riuscita', 'Copy failed')))}>{copy('Copia', 'Copy')}</button></header>
        <pre data-testid="bs-script-code"><code>{d.code}</code></pre>
      </section>
      <div className="bs-detail-actions">
        <button type="button" className="btn btn-primary btn-s" onClick={discuss} data-testid="bs-script-discuss"><span aria-hidden="true">↗</span> {copy('Discutine con l’Orchestrator', 'Discuss with the Orchestrator')}</button>
        <button type="button" className="btn btn-ghost btn-s" onClick={() => openFileViewer(d.path)} data-testid="bs-script-open">{copy('Apri il file', 'Open the file')}</button>
        <button type="button" className="btn btn-ghost btn-s" onClick={() => void copyText(d.path).then(ok => toast(ok ? copy('Percorso copiato', 'Path copied') : copy('Copia non riuscita', 'Copy failed')))}>{copy('Copia percorso', 'Copy path')}</button>
        <span className="sp" />
        <button type="button" className="btn btn-subtle btn-s" onClick={onClose}>{copy('Chiudi', 'Close')}</button>
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
        <p className="bs-desc">{s.description || copy('Nessuna descrizione nell’intestazione.', 'No description in its header.')}</p>
        {s.tags.length > 0 && <span className="bs-tags">{s.tags.map(t => <span key={t}>{t}</span>)}</span>}
        <span className="bs-card-foot"><code>{s.file}</code>{s.changedAt && <small>{copy('modificato', 'changed')} {day(s.changedAt)}</small>}</span>
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
  const filters: [Filter, string][] = [['all', copy('Tutti', 'All')], ['ok', copy('Funzionanti', 'Working')], ['fix', copy('Da correggere o provare', 'To fix or test')]];
  return (
    <div className="dashboard bs-page" data-testid="brain-scripts">
      <header className="dash-header bs-header"><div><span className="dash-eyebrow">{copy('IL TUO BRAIN', 'YOUR BRAIN')}</span><h1>Script</h1>
        <p>{copy('Gli script provati e riutilizzabili dei tuoi agenti. L’Orchestrator li aggiunge, corregge ed elimina; ogni cambiamento finisce nel Changelog.', 'Your agents’ tested, reusable scripts. The Orchestrator adds, fixes and deletes them; every change lands in the Changelog.')}</p></div>
        <button type="button" className="btn btn-ghost btn-s" onClick={() => go({ page: 'changelog' })} data-testid="bs-to-changelog"><span aria-hidden="true">↗</span> Changelog</button></header>
      <div className="dash-stats">
        <div className="dash-stat"><span>{copy('Script nel brain', 'Scripts in the brain')}</span><strong data-testid="bs-count">{list.data ? all.length : '—'}</strong><small>{copy('Cartella scripts/ del brain', 'The brain’s scripts/ folder')}</small></div>
        <div className="dash-stat"><span>{copy('Provati e funzionanti', 'Tested and working')}</span><strong>{list.data ? ok : '—'}</strong><small>{copy('Ultimo test riuscito', 'Last test passed')}</small></div>
        <div className="dash-stat"><span>{copy('Da correggere o provare', 'To fix or test')}</span><strong>{list.data ? all.length - ok : '—'}</strong><small>{copy('L’Orchestrator li corregge o li elimina', 'The Orchestrator fixes or deletes them')}</small></div>
      </div>
      <div className="bs-toolbar" role="search">
        <label className="dash-search bs-search"><span aria-hidden="true">⌕</span><input type="search" value={q} onChange={e => setQ(e.target.value)} aria-label={copy('Cerca negli script', 'Search the scripts')} placeholder={copy('Cerca per cosa fa, comando, tag…', 'Search by what it does, command, tag…')} data-testid="bs-search" /></label>
        <div className="bs-chips" role="group" aria-label={copy('Filtra', 'Filter')}>{filters.map(([id, label]) => <button key={id} type="button" className="bs-chip" aria-pressed={f === id} onClick={() => setF(id)} data-testid={`bs-filter-${id}`}>{label}</button>)}</div>
      </div>
      {list.error && !list.data ? <div className="dash-empty">{copy('Non riesco a leggere gli script', 'Cannot read the scripts')}: {list.error} <button type="button" className="btn btn-subtle btn-s" onClick={() => list.reload()}>{copy('Riprova', 'Retry')}</button></div>
        : !list.data ? <div className="bs-grid">{[0, 1, 2].map(i => <div key={i} className="bs-card bs-skeleton" />)}</div>
        : !all.length ? <div className="bs-empty" data-testid="bs-empty"><span className="dash-orbit-icon" aria-hidden="true">{'</>'}</span><h2>{copy('Ancora nessuno script', 'No scripts yet')}</h2>
          <p>{copy('Quando un agente scrive uno script che funziona, l’Orchestrator lo salva qui, con come si usa e quando è stato provato. Così la prossima volta si riusa invece di riscriverlo.', 'When an agent writes a script that works, the Orchestrator saves it here, with how to run it and when it was tested. Next time it is reused instead of rewritten.')}</p></div>
        : !shown.length ? <div className="dash-empty" data-testid="bs-none">{copy('Nessuno script corrisponde alla ricerca.', 'No script matches the search.')}</div>
        : <div className="bs-grid" data-testid="bs-grid">{shown.map(s => <Card key={s.id} s={s} open={open === s.id} onToggle={() => setOpen(o => o === s.id ? null : s.id)} />)}</div>}
    </div>
  );
}

function safeDecode(s: string): string { try { return decodeURIComponent(s); } catch { return s; } }
