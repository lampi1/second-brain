// "Mappa" (G B, ADR 0077): who uses what. The default view draws the links graph agent → skills → rules → memory
// (lib/brain-model-view.ts linkGraph) with an inspector: an agent shows its skills and opens its page, a skill shows
// who uses it and opens the Skill page, a rule or a memory opens its file. "Note del brain" is the brain's notes map,
// moved as is from the old Dashboard (dashboard/BrainNotesMap.tsx), with "Esplora in 3D". Both use dashboard/Graph.tsx
// unchanged. "Progetti" (ADR 0271) draws the user's projects (project-map/ProjectMapView.tsx); its place is the page's
// arg: progetti/<project>/<system> (app_project_map open lands there). Rendered by App.tsx PageFrame for 'collegamenti'.
import { useEffect, useMemo, useState } from 'react';
import { go, goTarget } from '../../actions';
import { t } from '../../i18n';
import { useBrainModel } from '../../store/brain-model';
import { linkGraph, type LinkNode } from '../../lib/brain-model-view';
import { Seg } from '../../brain/components/ui';
import { Graph } from '../../dashboard/Graph';
import { BrainNotesMap } from '../../dashboard/BrainNotesMap';
import { ui } from '../../store/ui';
import { ProjectMapView } from '../project-map/ProjectMapView';
import '../../dashboard/dashboard.css';
import '../../styles/brain-model.css';

type View = 'links' | 'notes' | 'projects';
const PROJECTS = 'progetti';
const KINDS = ['agent', 'skill', 'rule', 'memory'] as const;
const COLOR: Record<LinkNode['kind'], string> = { agent: '#aa83ed', skill: '#36aaa5', rule: '#e17891', memory: '#659ad5' };

function Inspector({ node, nodes, edges }: { node: LinkNode | undefined; nodes: LinkNode[]; edges: { from: string; to: string }[] }) {
  if (!node) return <aside className="dash-inspector"><span className="dash-orbit-icon">◎</span><h2>{t('bm.map.choose')}</h2><p>{t('bm.map.chooseHint')}</p></aside>;
  const near = edges.flatMap(e => (e.from === node.id ? [e.to] : e.to === node.id ? [e.from] : [])).map(id => nodes.find(n => n.id === id)).filter((n): n is LinkNode => !!n);
  const key = node.id.slice(node.id.indexOf(':') + 1);
  const skills = near.filter(n => n.kind === 'skill');
  return <aside className="dash-inspector" data-testid="bm-map-inspector">
    <span className="dash-eyebrow">{t(`bm.map.legend.${node.kind}`).toUpperCase()}</span>
    <h2>{node.label}</h2>
    {node.detail && <p>{node.detail}</p>}
    {node.kind === 'agent' && <p>{t('bm.map.agentSkills', { n: skills.length })}{skills.length ? `: ${skills.map(s => s.label).join(', ')}` : ''}</p>}
    {node.kind === 'skill' && <p>{t('bm.map.usedBy', { n: near.length })}{near.length ? `: ${near.map(n => n.label).join(', ')}` : ''}</p>}
    {node.kind === 'rule' && <p>{t('bm.map.allRules')}</p>}
    <div className="dash-actions">
      {node.kind === 'agent' && <button type="button" className="btn btn-primary btn-s" onClick={() => go({ page: 'agenti', arg: key })}>{t('bm.map.openAgent')}</button>}
      {node.kind === 'skill' && <button type="button" className="btn btn-primary btn-s" onClick={() => go({ page: 'skill', arg: key })}>{t('bm.map.openSkill')}</button>}
      {(node.kind === 'rule' || node.kind === 'memory') && <button type="button" className="btn btn-primary btn-s" onClick={() => goTarget(`file/${key}`)}>{t('bm.map.openFile')}</button>}
    </div>
  </aside>;
}

export function MapPage() {
  const { state } = useBrainModel();
  const arg = ui.use(s => (s.page === 'collegamenti' ? s.pageArg : null));
  const inProjects = arg === PROJECTS || !!arg?.startsWith(`${PROJECTS}/`);
  const [view, setView] = useState<View>(inProjects ? 'projects' : 'links');
  useEffect(() => { if (inProjects) setView('projects'); }, [inProjects]);
  const pick = (v: View) => { setView(v); setSelected(null); if (v === 'projects' && !inProjects) go({ page: 'collegamenti', arg: PROJECTS }); else if (v !== 'projects' && inProjects) go({ page: 'collegamenti', arg: null }); };
  const [selected, setSelected] = useState<string | null>(null);
  const g = useMemo(() => linkGraph(state), [state]);
  return <div className="dashboard bm-dash bm-map" data-testid="bm-map-page">
    <header className="dash-header"><div><span className="dash-eyebrow">{t('bm.map.eyebrow')}</span><h1>{t('bm.map.title')}</h1><p>{view === 'projects' ? t('pm.lead') : t('bm.map.lead')}</p></div></header>
    <div className="bx bm-map-views"><Seg items={[{ id: 'projects', label: t('bm.map.view.projects') }, { id: 'links', label: t('bm.map.view.links') }, { id: 'notes', label: t('bm.map.view.notes') }]} value={view} onChange={pick} label={t('bm.map.viewLabel')} /></div>
    {view === 'projects' ? <ProjectMapView arg={inProjects ? arg!.slice(PROJECTS.length + 1) || null : null} onArg={a => go({ page: 'collegamenti', arg: a ? `${PROJECTS}/${a}` : PROJECTS })} />
      : view === 'notes' ? <BrainNotesMap /> : <section className="dash-panel" data-testid="bm-map-links">
      <header><div><h3>{t('bm.map.view.links')}</h3><p>{t('bm.map.lead')}</p></div></header>
      <div className="dash-network">
        <Graph testId="bm-map-graph" label={t('bm.map.title')} nodes={g.nodes.map(n => ({ id: n.id, label: n.label, detail: n.detail || t(`bm.map.legend.${n.kind}`), kind: n.kind === 'memory' ? 'note' : n.kind }))} edges={g.edges}
          selected={selected} onSelect={id => setSelected(id || null)}
          empty={<div className="dash-empty">{state ? t('bm.map.empty') : t('bm.loading')}</div>}
          legend={<div className="dash-legend" aria-label={t('bm.map.legendLabel')}>{KINDS.map(k => <span key={k}><i style={{ background: COLOR[k] }} />{t(`bm.map.legend.${k}`)}</span>)}</div>} />
        <Inspector node={g.nodes.find(n => n.id === selected)} nodes={g.nodes} edges={g.edges} />
      </div>
    </section>}
  </div>;
}
