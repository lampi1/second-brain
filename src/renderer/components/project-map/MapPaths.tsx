// The paths on a project map (ADR 0316, the owner 2026-11-15, «I percorsi»): a question about the project («Cosa succede
// quando un cliente paga?») told stop by stop on the boxes, in the order things happen. The side lists the map's paths
// and asks the Orchestrator for a new one (a Scout answers it as a path, app_project_map brief with question); a path
// being walked shows every stop, the one on screen with what happens there and the file where it happens (it opens in
// the viewer), and moves with Indietro / Avanti (or ← →). The drawing lights the boxes of the path (ProjectMapView.tsx).
import type { MapPath, ProjectMap } from '@shared/project-map';
import { t } from '../../i18n';
import { IconArrowLeft, IconArrowRight, IconX } from '../Icons';
import { FileLink } from './MapDetail';

/** the path walked and the stop on screen */
export interface Walk { path: string; i: number }

export function PathList({ map, onWalk, onAsk }: { map: ProjectMap; onWalk: (p: MapPath, stop: number) => void; onAsk: () => void }) {
  const paths = map.paths ?? [];
  return <section className="pm-group pm-paths" data-testid="pm-paths">
    <h4>{t('pm.paths')}</h4>
    {paths.length ? <ul className="pm-pathlist">{paths.map(p => <li key={p.id}>
      <button type="button" onClick={() => onWalk(p, 0)} data-testid={`pm-path-${p.id}`}>{p.question}</button>
      <small>{t('pm.stops', { n: p.stops.length })}</small>
    </li>)}</ul> : <p className="pm-muted">{t('pm.noPaths')}</p>}
    <button type="button" className="btn btn-ghost btn-s" onClick={onAsk} data-testid="pm-path-ask">{t('pm.pathAsk')}</button>
  </section>;
}

export function PathPanel({ map, path, i, onStep, onClose, onShow, onFile }: {
  map: ProjectMap; path: MapPath; i: number; onStep: (i: number) => void; onClose: () => void; onShow: (id: string) => void; onFile: (path: string) => void;
}) {
  const name = (id: string) => map.elements.find(e => e.id === id)?.name ?? id;
  return <section className="pm-detail pm-walk" data-testid="pm-walk">
    <div className="pm-walk-head">
      <span className="dash-eyebrow">{t('pm.pathEyebrow')}</span>
      <button type="button" className="btn btn-ghost btn-s" onClick={onClose} aria-label={t('pm.pathClose')} data-testid="pm-walk-close"><IconX size={13} /></button>
    </div>
    <h3>{path.question}</h3>
    <ol className="pm-stops">{path.stops.map((s, k) => <li key={k} data-s={k < i ? 'done' : k === i ? 'now' : 'todo'}>
      <button type="button" className="pm-stop" onClick={() => onStep(k)} aria-current={k === i || undefined} data-testid={`pm-stop-${k}`}><i>{k + 1}</i>{name(s.on)}</button>
      {k === i && <div className="pm-stop-now" data-testid="pm-stop-now">
        <p className="pm-long">{s.text}</p>
        {s.file && <p className="pm-stop-file"><FileLink path={s.file} onFile={onFile} testid="pm-stop-file" /></p>}
        <button type="button" className="btn btn-ghost btn-s" onClick={() => onShow(s.on)}>{t('pm.stopOpen', { name: name(s.on) })}</button>
      </div>}
    </li>)}</ol>
    <div className="pm-walk-act">
      <button type="button" className="btn btn-s" onClick={() => onStep(i - 1)} disabled={i === 0} data-testid="pm-walk-prev"><IconArrowLeft size={13} />{t('pm.pathPrev')}</button>
      <span className="pm-muted">{t('pm.stopOf', { n: i + 1, total: path.stops.length })}</span>
      <button type="button" className="btn btn-primary btn-s" onClick={() => (i + 1 < path.stops.length ? onStep(i + 1) : onClose())} data-testid="pm-walk-next">{i + 1 < path.stops.length ? t('pm.pathNext') : t('pm.pathEnd')}<IconArrowRight size={13} /></button>
    </div>
  </section>;
}
