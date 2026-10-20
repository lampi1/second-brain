// The brain's notes map (the Dashboard's former "Mappa brain" tab, moved as is by ADR 0077 to the Brain section's
// Mappa page, "Note del brain" view): notes, areas, agents and tools of the brain from /api/map, searchable, with an
// inspector, "Esplora in 3D" and the brain checks. The Dashboard keeps statistics only. Uses the Dashboard's own
// Panel, Source, Empty and Discuss and its Graph (owned by the map work, unchanged). Rendered by
// components/brain-model/MapPage.tsx.
import { useMemo, useState } from 'react';
import { goTarget } from '../actions';
import { useBrain } from '../brain/api';
import { normMap } from '../brain/types';
import { lang } from '../i18n';
import { brainChecks, neighbourhood } from './data';
import { Graph } from './Graph';
import { nodeStyle } from './graph-style';
import { Discuss, Empty, Panel, Source } from './Dashboard';
import './dashboard.css';

const copy = (it: string, en: string) => lang() === 'en' ? en : it;

export function BrainNotesMap() {
  const map = useBrain('/api/map', normMap, { pollMs: 30_000 });
  const [query, setQuery] = useState(''), [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const brainNodes = useMemo(() => neighbourhood(map.data?.nodes ?? [], map.data?.edges ?? [], query, focus), [map.data, query, focus]);
  const brainNode = map.data?.nodes.find(n => n.id === selected);
  const checks = brainChecks(map.data);
  return <><Source data={map} /><Panel title={copy('Le connessioni del tuo brain', 'Your brain connections')} note={copy('Note, aree, agenti e strumenti del brain. Clicca un nodo per vedere i suoi collegamenti.', 'Notes, areas, agents and tools in your brain. Click a node to see its connections.')} facts={`${map.data?.nodes.length ?? 'unknown'} nodes; ${map.data?.edges.length ?? 'unknown'} links`} source="/api/map">
    <div className="dash-network">
      <Graph testId="dash-map" label={copy('Mappa brain', 'Brain map')} nodes={brainNodes.map(n => ({ id: n.id, label: n.label, detail: n.what || n.kind, kind: n.kind, layer: n.layer }))} edges={map.data?.edges ?? []} selected={selected} onSelect={id => { setSelected(id || null); setFocus(id || null); setQuery(''); }}
        toolbar={<>
          <label className="dash-search"><span aria-hidden="true">⌕</span><input aria-label={copy('Cerca note', 'Search notes')} placeholder={copy('Cerca una nota, un file, un concetto…', 'Find a note, a file, a concept…')} value={query} onChange={e => { setQuery(e.target.value); setFocus(null); }} /></label>
          <span className="dash-map-count" title={copy('Nodi visibili / totali', 'Visible / total nodes')}>{brainNodes.length} / {map.data?.nodes.length ?? '—'} {copy('nodi', 'nodes')}</span>
          <button className="btn btn-subtle btn-s" type="button" disabled={!query && !focus && !selected} onClick={() => { setFocus(null); setSelected(null); setQuery(''); }}><span aria-hidden="true">◌</span>{copy('Vista completa', 'Overview')}</button>
          <button type="button" className="btn btn-ghost btn-s dash-3d" onClick={() => goTarget('mappa')}><span aria-hidden="true">◈</span>{copy('Esplora in 3D', 'Explore in 3D')}</button>
        </>}
        empty={<Empty>{map.loading ? copy('Caricamento della mappa…', 'Loading map…') : copy('Nessuna nota trovata. Verifica il brain o cambia ricerca.', 'No notes found. Check your brain or change the search.')}</Empty>}
        legend={<div className="dash-legend" aria-label={copy('Legenda', 'Legend')}>{['area', 'agent', 'skill', 'rule', 'note'].map(kind => { const style = nodeStyle(kind); return <span key={kind}><i style={{ background: style.color }} />{style.label}</span>; })}</div>} />
      <aside className="dash-inspector">{brainNode ? <><span className="dash-eyebrow">{brainNode.kind}</span><h2>{brainNode.label}</h2><p>{brainNode.what}</p><code>{brainNode.file || brainNode.id}</code><div className="dash-actions"><Discuss title={brainNode.label} facts={`${brainNode.what ?? ''}\n${brainNode.file ?? brainNode.id}`} source="/api/map" weight="primary" /><button className="btn btn-ghost btn-s" type="button" onClick={() => { setFocus(brainNode.id); setQuery(''); }}><span aria-hidden="true">⌖</span>{copy('Esplora i collegamenti', 'Explore connections')}</button>{brainNode.file && <button className="btn btn-ghost btn-s" type="button" onClick={() => goTarget(`file/${brainNode.file}`)}><span aria-hidden="true">↗</span>{copy('Apri nota', 'Open note')}</button>}</div></> : <><span className="dash-orbit-icon">⌘</span><h2>{copy('Scegli un nodo', 'Choose a node')}</h2><p>{copy('Seleziona una nota per esplorarne i collegamenti o discuterne.', 'Select a note to explore its connections or discuss it.')}</p></>}</aside>
    </div>
    {checks.length > 0 && <section className="dash-note dash-checks" data-testid="brain-checks"><h3>{copy(`${checks.length} controlli del brain da guardare`, `${checks.length} brain checks to review`)}</h3><p>{copy('Alcuni collegamenti o regole della memoria richiedono una verifica. Puoi continuare a lavorare.', 'Some memory links or rules need a review. You can keep working.')}</p><details><summary>{copy('Apri dettagli', 'Open details')}</summary><ul>{checks.map(check => <li key={check}>{check}</li>)}</ul></details></section>}
  </Panel></>;
}
