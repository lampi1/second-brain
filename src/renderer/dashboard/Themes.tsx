// The Dashboard's Temi tab (SPEC 23 b): ai-errors.md and ideas.md grouped by meaning, from /api/themes (main:
// search/hybrid/themes.ts). Each theme shows its size, whether it is growing (last 7 days vs the 7 before) and its
// entries; near-identical entries are flagged as duplicates. The Dashboard passes its Panel/Empty/Source (no import
// cycle); without the search model the tab says so instead of showing nothing.
import { useState, type ReactNode } from 'react';
import { normThemes, type Theme, type ThemeKind, type Themes } from '@shared/themes';
import { goTarget } from '../actions';
import { useBrain, type Loaded } from '../brain/api';
import { t as tr } from '../i18n';

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
      {theme.growing && <span className="dash-tag dash-theme-up" title={tr('brainText.themes.growingTip')}>↑ {tr('brainText.themes.growing')} · {theme.recent} / {theme.before}</span>}</header>
    <ul>{shown.map(e => <li key={e.line}><small>{e.day ?? '—'}</small><span>{e.text}</span></li>)}</ul>
    {theme.entries.length > SHOWN && <button type="button" className="btn btn-subtle btn-s dash-more" aria-expanded={all} onClick={() => setAll(!all)}><span aria-hidden="true">{all ? '▴' : '▾'}</span>{all ? tr('brainText.themes.showLess') : `${tr('brainText.themes.showAll')} (${theme.entries.length})`}</button>}
  </article>;
}

function KindPanel({ kind, data, ui }: { kind: ThemeKind; data: Loaded<Themes>; ui: ThemesUi }) {
  const { Panel, Empty } = ui, t = data.data, file = FILE[kind];
  const title = kind === 'errors' ? tr('brainText.themes.errors') : tr('brainText.themes.ideas');
  const facts = t?.ready ? t.themes.map(x => `${x.label}: ${x.entries.length} (${x.recent} last 7 days, ${x.before} the 7 before)${x.growing ? ', growing' : ''}`).join('\n') : undefined;
  return <Panel title={title} note={t?.ready ? `${file} · ${t.entries} ${tr('brainText.themes.entries')}` : file} facts={facts} source={`/api/themes?kind=${kind}`}>
    {!t ? <Empty>{data.loading ? tr('brainText.themes.grouping') : tr('brainText.themes.unavailable')}</Empty>
      : !t.ready ? <Empty>{tr('brainText.themes.notReady')}</Empty>
        : !t.themes.length ? <Empty>{t.entries ? tr('brainText.themes.noThemes') : tr('brainText.themes.noEntries', { file })}</Empty>
          : <div className="dash-themes">{t.themes.map(x => <ThemeCard key={`${x.label}-${x.entries[0]?.line}`} theme={x} />)}</div>}
    {t?.ready && t.duplicates.length > 0 && <div className="dash-dups"><h4>{tr('brainText.themes.duplicates')}</h4>
      {t.duplicates.map(d => <div className="dash-dup" key={`${d.a.line}-${d.b.line}`}><span className="dash-tag">{Math.round(d.score * 100)}%</span><p><small>{d.a.day ?? '—'}</small>{d.a.text}</p><p><small>{d.b.day ?? '—'}</small>{d.b.text}</p></div>)}
      <button type="button" className="btn btn-ghost btn-s" onClick={() => goTarget(`file/${file}`)}>{tr('brainText.common.open')} {file}</button></div>}
  </Panel>;
}

export function ThemesTab({ ui }: { ui: ThemesUi }) {
  const errors = useBrain('/api/themes?kind=errors', normThemes, { pollMs: 60_000 });
  const ideas = useBrain('/api/themes?kind=ideas', normThemes, { pollMs: 60_000 });
  const growing = [...(errors.data?.themes ?? []), ...(ideas.data?.themes ?? [])].filter(t => t.growing).length;
  return <>
    <div className="dash-tip-intro"><span>❖</span><div><h2>{tr('brainText.themes.title')}</h2><p>{growing
      ? tr('brainText.themes.growingCount', { n: growing })
      : tr('brainText.themes.lead')}</p></div></div>
    <ui.Source data={errors} name="ai-errors.md" /><KindPanel kind="errors" data={errors} ui={ui} />
    <ui.Source data={ideas} name="ideas.md" /><KindPanel kind="ideas" data={ideas} ui={ui} />
  </>;
}
