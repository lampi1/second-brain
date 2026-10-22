// The brain's notes map (the Dashboard's former "Mappa brain" tab, moved as is by ADR 0077 to the Brain section's
// Mappa page, "Note del brain" view): notes, areas, agents and tools of the brain from /api/map, searchable, with an
// inspector, "Esplora in 3D" and the brain checks. The Dashboard keeps statistics only. Uses the Dashboard's own
// Panel, Source, Empty and Discuss and its Graph (owned by the map work, unchanged). Rendered by
// components/brain-model/MapPage.tsx.
import { useMemo, useState } from 'react';
import { goTarget } from '../actions';
import { useBrain } from '../brain/api';
import { normMap } from '../brain/types';
import { t } from '../i18n';
import { brainChecks, neighbourhood } from './data';
import { Graph } from './Graph';
import { nodeStyle } from './graph-style';
import { Discuss, Empty, Panel, Source } from './Dashboard';
import './dashboard.css';

export function BrainNotesMap() {
  const map = useBrain('/api/map', normMap, { pollMs: 30_000 });
  const [query, setQuery] = useState(''), [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const brainNodes = useMemo(() => neighbourhood(map.data?.nodes ?? [], map.data?.edges ?? [], query, focus), [map.data, query, focus]);
  const brainNode = map.data?.nodes.find(n => n.id === selected);
  const checks = brainChecks(map.data);
  return <><Source data={map} /><Panel title={t('brainText.notesMap.title')} note={t('brainText.notesMap.note')} facts={`${map.data?.nodes.length ?? 'unknown'} nodes; ${map.data?.edges.length ?? 'unknown'} links`} source="/api/map">
    <div className="dash-network">
      <Graph testId="dash-map" label={t('brainText.notesMap.label')} nodes={brainNodes.map(n => ({ id: n.id, label: n.label, detail: n.what || n.kind, kind: n.kind, layer: n.layer }))} edges={map.data?.edges ?? []} selected={selected} onSelect={id => { setSelected(id || null); setFocus(id || null); setQuery(''); }}
        toolbar={<>
          <label className="dash-search"><span aria-hidden="true">⌕</span><input aria-label={t('brainText.notesMap.searchLabel')} placeholder={t('brainText.notesMap.search')} value={query} onChange={e => { setQuery(e.target.value); setFocus(null); }} /></label>
          <span className="dash-map-count" title={t('brainText.notesMap.countTip')}>{brainNodes.length} / {map.data?.nodes.length ?? '—'} {t('brainText.notesMap.nodes')}</span>
          <button className="btn btn-subtle btn-s" type="button" disabled={!query && !focus && !selected} onClick={() => { setFocus(null); setSelected(null); setQuery(''); }}><span aria-hidden="true">◌</span>{t('brainText.notesMap.overview')}</button>
          <button type="button" className="btn btn-ghost btn-s dash-3d" onClick={() => goTarget('mappa')}><span aria-hidden="true">◈</span>{t('brainText.notesMap.explore3d')}</button>
        </>}
        empty={<Empty>{map.loading ? t('brainText.notesMap.loading') : t('brainText.notesMap.noNotes')}</Empty>}
        legend={<div className="dash-legend" aria-label={t('brainText.notesMap.legend')}>{['area', 'agent', 'skill', 'rule', 'note'].map(kind => { const style = nodeStyle(kind); return <span key={kind}><i style={{ background: style.color }} />{style.label}</span>; })}</div>} />
      <aside className="dash-inspector">{brainNode ? <><span className="dash-eyebrow">{brainNode.kind}</span><h2>{brainNode.label}</h2><p>{brainNode.what}</p><code>{brainNode.file || brainNode.id}</code><div className="dash-actions"><Discuss title={brainNode.label} facts={`${brainNode.what ?? ''}\n${brainNode.file ?? brainNode.id}`} source="/api/map" weight="primary" /><button className="btn btn-ghost btn-s" type="button" onClick={() => { setFocus(brainNode.id); setQuery(''); }}><span aria-hidden="true">⌖</span>{t('brainText.notesMap.exploreLinks')}</button>{brainNode.file && <button className="btn btn-ghost btn-s" type="button" onClick={() => goTarget(`file/${brainNode.file}`)}><span aria-hidden="true">↗</span>{t('brainText.notesMap.openNote')}</button>}</div></> : <><span className="dash-orbit-icon">⌘</span><h2>{t('brainText.notesMap.choose')}</h2><p>{t('brainText.notesMap.chooseBody')}</p></>}</aside>
    </div>
    {checks.length > 0 && <section className="dash-note dash-checks" data-testid="brain-checks"><h3>{t('brainText.notesMap.checks', { n: checks.length })}</h3><p>{t('brainText.notesMap.checksBody')}</p><details><summary>{t('brainText.notesMap.details')}</summary><ul>{checks.map(check => <li key={check}>{check}</li>)}</ul></details></section>}
  </Panel></>;
}
