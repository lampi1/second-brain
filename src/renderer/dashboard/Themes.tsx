// The Dashboard's Temi tab (SPEC 23 b): ai-errors.md and ideas.md grouped by meaning, from /api/themes (main:
// search/hybrid/themes.ts). Each theme shows its size, whether it is growing (last 7 days vs the 7 before) and its
// entries; near-identical entries are flagged as duplicates. The Dashboard passes its Panel/Empty/Source (no import
// cycle); without the search model the tab says so instead of showing nothing.
import { useState, type ReactNode } from 'react';
import { normThemes, type Theme, type ThemeKind, type Themes } from '@shared/themes';
import { goTarget } from '../actions';
import { useBrain, type Loaded } from '../brain/api';
import { lang } from '../i18n';

const copy = (it: string, en: string) => lang() === 'en' ? en : it;
const FILE: Record<ThemeKind, string> = { errors: 'ai-errors.md', ideas: 'ideas.md' };
const SHOWN = 4; // entries visible per theme before «Mostra tutte»

export interface ThemesUi {
  Panel: (p: { title: string; note?: string; children: ReactNode; facts?: string; source?: string }) => ReactNode;
  Empty: (p: { children: ReactNode }) => ReactNode;
  Source: (p: { data: Loaded<unknown>; name?: string }) => ReactNode;
}

function ThemeCard({ theme }: { theme: Theme }) {
  const [all, setAll] = useState(false);
  const shown = all ? theme.entries : theme.entries.slice(0, SHOWN);
  return <article className={`dash-theme${theme.growing ? ' growing' : ''}`}>
    <header><h4>{theme.label}</h4><span className="dash-tag">{theme.entries.length}</span>
      {theme.growing && <span className="dash-tag dash-theme-up" title={copy('Ultimi 7 giorni contro i 7 prima', 'Last 7 days vs the 7 before')}>↑ {copy('in crescita', 'growing')} · {theme.recent} / {theme.before}</span>}</header>
    <ul>{shown.map(e => <li key={e.line}><small>{e.day ?? '—'}</small><span>{e.text}</span></li>)}</ul>
    {theme.entries.length > SHOWN && <button type="button" className="btn btn-subtle btn-s dash-more" aria-expanded={all} onClick={() => setAll(!all)}><span aria-hidden="true">{all ? '▴' : '▾'}</span>{all ? copy('Mostra meno', 'Show less') : `${copy('Mostra tutte', 'Show all')} (${theme.entries.length})`}</button>}
  </article>;
}

function KindPanel({ kind, data, ui }: { kind: ThemeKind; data: Loaded<Themes>; ui: ThemesUi }) {
  const { Panel, Empty } = ui, t = data.data, file = FILE[kind];
  const title = kind === 'errors' ? copy('Temi degli errori', 'Error themes') : copy('Temi delle idee', 'Idea themes');
  const facts = t?.ready ? t.themes.map(x => `${x.label}: ${x.entries.length} (${x.recent} last 7 days, ${x.before} the 7 before)${x.growing ? ', growing' : ''}`).join('\n') : undefined;
  return <Panel title={title} note={t?.ready ? `${file} · ${t.entries} ${copy('voci, raggruppate per significato', 'entries, grouped by meaning')}` : file} facts={facts} source={`/api/themes?kind=${kind}`}>
    {!t ? <Empty>{data.loading ? copy('Raggruppo per significato…', 'Grouping by meaning…') : copy('Temi non disponibili.', 'Themes unavailable.')}</Empty>
      : !t.ready ? <Empty>{copy('Il modello di ricerca non è ancora pronto: i temi compaiono quando ha letto il brain.', 'The search model is not ready yet: themes appear once it has read the brain.')}</Empty>
        : !t.themes.length ? <Empty>{t.entries ? copy('Nessun tema: le voci non si somigliano abbastanza.', 'No themes: the entries are not similar enough.') : copy(`Nessuna voce in ${file}.`, `No entries in ${file}.`)}</Empty>
          : <div className="dash-themes">{t.themes.map(x => <ThemeCard key={`${x.label}-${x.entries[0]?.line}`} theme={x} />)}</div>}
    {t?.ready && t.duplicates.length > 0 && <div className="dash-dups"><h4>{copy('Probabili doppioni', 'Likely duplicates')}</h4>
      {t.duplicates.map(d => <div className="dash-dup" key={`${d.a.line}-${d.b.line}`}><span className="dash-tag">{Math.round(d.score * 100)}%</span><p><small>{d.a.day ?? '—'}</small>{d.a.text}</p><p><small>{d.b.day ?? '—'}</small>{d.b.text}</p></div>)}
      <button type="button" className="btn btn-ghost btn-s" onClick={() => goTarget(`file/${file}`)}>{copy('Apri', 'Open')} {file}</button></div>}
  </Panel>;
}

export function ThemesTab({ ui }: { ui: ThemesUi }) {
  const errors = useBrain('/api/themes?kind=errors', normThemes, { pollMs: 60_000 });
  const ideas = useBrain('/api/themes?kind=ideas', normThemes, { pollMs: 60_000 });
  const growing = [...(errors.data?.themes ?? []), ...(ideas.data?.themes ?? [])].filter(t => t.growing).length;
  return <>
    <div className="dash-tip-intro"><span>❖</span><div><h2>{copy('Di cosa parlano errori e idee', 'What errors and ideas are about')}</h2><p>{growing
      ? (growing === 1 ? copy('1 tema in crescita questa settimana.', '1 theme growing this week.') : copy(`${growing} temi in crescita questa settimana.`, `${growing} themes growing this week.`))
      : copy('Raggruppati per significato dal modello di ricerca locale; si aggiornano quando cambiano i file.', 'Grouped by meaning by the local search model; they refresh when the files change.')}</p></div></div>
    <ui.Source data={errors} name="ai-errors.md" /><KindPanel kind="errors" data={errors} ui={ui} />
    <ui.Source data={ideas} name="ideas.md" /><KindPanel kind="ideas" data={ideas} ui={ui} />
  </>;
}
