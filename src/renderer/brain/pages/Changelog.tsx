// Changelog: every change the agents and the app made to the brain, newest first (ADR 0076; the owner, 2026-10-19: "i
// cambiamenti finiscono nel changelog del brain che farei una sezione a parte"). Dashboard look: header, three numbers,
// search and one filter per kind of change, then one card per day with its changes (time, kind, what was done, the file,
// who, why). A file that still exists opens in the viewer; a script opens on the Script page. Read-only: the lines come
// from the brain's changelog.md (main brain/changelog.ts), written by the Orchestrator's tools.
// Mounted by App.tsx's PageFrame. Data: /api/changelog.
import { useMemo, useState } from 'react';
import type { ChangelogEntry, ChangelogKind } from '@shared/contract';
import { useBrain } from '../api';
import { normChangelog } from '../types';
import { dayLabel, groupChangelog, isoDay } from '../lib/brain-sections';
import { brainBridge, go, goTarget } from '../../actions';
import { toast } from '../../store/ui';
import { lang } from '../../i18n';
import { now } from '../../lib/clock';
import '../../dashboard/dashboard.css';
import '../../styles/brain-sections.css';

const copy = (it: string, en: string) => lang() === 'en' ? en : it;
const KIND: Record<ChangelogKind, [string, string]> = {
  script: ['Script', 'Script'], rule: ['Regola', 'Rule'], procedure: ['Procedura', 'Procedure'], note: ['Nota', 'Note'],
  agent: ['Agente', 'Agent'], skill: ['Skill', 'Skill'], other: ['Altro', 'Other'],
};
const ACTION: Record<ChangelogEntry['action'], [string, string]> = {
  added: ['aggiunto', 'added'], edited: ['modificato', 'edited'], fixed: ['corretto', 'fixed'], deleted: ['eliminato', 'deleted'], restored: ['ripristinato', 'restored'],
};
const kindLabel = (k: ChangelogKind) => copy(...KIND[k]);

function Entry({ e }: { e: ChangelogEntry }) {
  const script = e.kind === 'script' && /^scripts\/[^/]+$/.test(e.target);
  const openable = e.action !== 'deleted' && /\.[a-z0-9]+$/i.test(e.target) && !e.target.includes('..');
  const open = () => script ? go({ page: 'script', arg: encodeURIComponent(e.target.slice('scripts/'.length)) }) : goTarget(`file/${e.target}`);
  const discuss = () => {
    if (!brainBridge.draftToOrchestrator(`${copy('Cambiamento al brain', 'Brain change')} ${e.at}: ${kindLabel(e.kind)} ${copy(...ACTION[e.action])} · ${e.target}\n${e.summary} (${e.by})\n\n${copy('Era giusto? Va tenuto, corretto o annullato?', 'Was it right? Keep, fix or undo?')}`, () => {}))
      toast(copy('Apri un Orchestrator per discuterne.', 'Open an Orchestrator to discuss it.'));
  };
  return (
    <li className={`bc-entry bc-${e.kind}`} data-testid="bc-entry" data-kind={e.kind}>
      <time>{e.at.slice(11)}</time>
      <span className="bc-dot" aria-hidden="true" />
      <div className="bc-body">
        <div className="bc-line"><span className={`bc-kind bc-kind-${e.kind}`}>{kindLabel(e.kind)}</span><span className={`bc-action bc-action-${e.action}`}>{copy(...ACTION[e.action])}</span>
          {openable ? <button type="button" className="bc-target" onClick={open} title={copy('Apri', 'Open')}>{e.target}</button> : <code className="bc-target off">{e.target}</code>}</div>
        <p>{e.summary}</p>
        <small>{copy('da', 'by')} {e.by}</small>
      </div>
      <button type="button" className="btn btn-subtle btn-s dash-discuss dash-discuss-quiet bc-discuss" onClick={discuss} aria-label={`${copy('Discuti', 'Discuss')}: ${e.target}`}><span aria-hidden="true">↗</span> {copy('Discuti', 'Discuss')}</button>
    </li>
  );
}

export function Changelog() {
  const log = useBrain('/api/changelog', normChangelog);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<ChangelogKind | 'all'>('all');
  const all = log.data?.entries ?? [];
  const days = useMemo(() => groupChangelog(all, q, kind), [all, q, kind]);
  const today = new Date(now());
  const weekAgo = isoDay(new Date(today.getTime() - 6 * 864e5));
  const week = all.filter(e => e.at.slice(0, 10) >= weekAgo).length;
  const scripts = new Set(all.filter(e => e.kind === 'script').map(e => e.target)).size;
  const present = (Object.keys(KIND) as ChangelogKind[]).filter(k => all.some(e => e.kind === k));
  return (
    <div className="dashboard bs-page" data-testid="brain-changelog">
      <header className="dash-header bs-header"><div><span className="dash-eyebrow">{copy('IL TUO BRAIN', 'YOUR BRAIN')}</span><h1>Changelog</h1>
        <p>{copy('Ogni cambiamento che gli agenti fanno al tuo brain: script, regole, skill, note. Il più recente in alto.', 'Every change the agents make to your brain: scripts, rules, skills, notes. Newest first.')}</p></div>
        <button type="button" className="btn btn-ghost btn-s" onClick={() => go({ page: 'script' })} data-testid="bc-to-scripts"><span aria-hidden="true">↗</span> Script</button></header>
      <div className="dash-stats">
        <div className="dash-stat"><span>{copy('Cambiamenti in 7 giorni', 'Changes in 7 days')}</span><strong data-testid="bc-week">{log.data ? week : '—'}</strong><small>{copy('Da changelog.md nel brain', 'From changelog.md in the brain')}</small></div>
        <div className="dash-stat"><span>{copy('Script toccati', 'Scripts touched')}</span><strong>{log.data ? scripts : '—'}</strong><small>{copy('Aggiunti, corretti o eliminati', 'Added, fixed or deleted')}</small></div>
        <div className="dash-stat"><span>{copy('Ultimo cambiamento', 'Last change')}</span><strong className="bs-stat-text">{all[0] ? dayLabel(all[0].at.slice(0, 10), today) : '—'}</strong><small>{all[0] ? `${all[0].at.slice(11)} · ${all[0].target}` : copy('Ancora nessuno', 'None yet')}</small></div>
      </div>
      <div className="bs-toolbar" role="search">
        <label className="dash-search bs-search"><span aria-hidden="true">⌕</span><input type="search" value={q} onChange={e => setQ(e.target.value)} aria-label={copy('Cerca nel changelog', 'Search the changelog')} placeholder={copy('Cerca un file, un motivo, chi…', 'Search a file, a reason, who…')} data-testid="bc-search" /></label>
        {present.length > 1 && <div className="bs-chips" role="group" aria-label={copy('Tipo di cambiamento', 'Kind of change')}>
          <button type="button" className="bs-chip" aria-pressed={kind === 'all'} onClick={() => setKind('all')} data-testid="bc-filter-all">{copy('Tutti', 'All')}</button>
          {present.map(k => <button key={k} type="button" className="bs-chip" aria-pressed={kind === k} onClick={() => setKind(k)} data-testid={`bc-filter-${k}`}>{kindLabel(k)}</button>)}
        </div>}
      </div>
      {log.error && !log.data ? <div className="dash-empty">{copy('Non riesco a leggere il changelog', 'Cannot read the changelog')}: {log.error} <button type="button" className="btn btn-subtle btn-s" onClick={() => log.reload()}>{copy('Riprova', 'Retry')}</button></div>
        : !log.data ? <div className="bc-days"><div className="dash-panel bs-skeleton" /></div>
        : !all.length ? <div className="bs-empty" data-testid="bc-empty"><span className="dash-orbit-icon" aria-hidden="true">↻</span><h2>{copy('Ancora nessun cambiamento', 'No changes yet')}</h2>
          <p>{copy('Quando l’Orchestrator aggiunge, corregge o elimina uno script, o cambia una regola o una skill del brain, lo trovi qui con il motivo.', 'When the Orchestrator adds, fixes or deletes a script, or changes a rule or skill of the brain, you find it here with the reason.')}</p></div>
        : !days.length ? <div className="dash-empty" data-testid="bc-none">{copy('Nessun cambiamento corrisponde alla ricerca.', 'No change matches the search.')}</div>
        : <div className="bc-days" data-testid="bc-days">{days.map(([d, es]) => (
          <section key={d} className="dash-panel bc-day" aria-label={dayLabel(d, today)}>
            <header><div><h3>{dayLabel(d, today)}</h3><p>{es.length === 1 ? copy('1 cambiamento', '1 change') : copy(`${es.length} cambiamenti`, `${es.length} changes`)}</p></div></header>
            <ol className="bc-list">{es.map((e, i) => <Entry key={`${e.at}-${i}`} e={e} />)}</ol>
          </section>
        ))}</div>}
    </div>
  );
}
