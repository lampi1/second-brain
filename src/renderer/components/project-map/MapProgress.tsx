// How far a project is, shown on its map (ADR 0326). The owner (2026-11-19): «le mappe servono per tracciare l'andamento
// di un piano, sarebbe bello ci fosse anche un progressivo, una percentuale, e più dettagli nella parte dx».
// - Meter: the bar itself, used by every count on the map (the project, a phase, a plan).
// - ProgressChip: the percentage in the map's header, always in sight.
// - ProgressCard: the side panel's first card. The percentage and the count; where the project is (the phase under
//   way), what is being done now and by whom, what waits for the user, what is blocked, what comes next; then every
//   phase with its own bar, opened by a click. With a box picked it folds to its first lines («Dettagli» opens it).
// The numbers come from shared/project-map-progress.ts (no model, no token). Used by ProjectMapView.tsx
// and MapDetail.tsx.
import { useEffect, useState, type ReactNode } from 'react';
import type { MapProgress, ProgressItem } from '@shared/project-map-progress';
import { t } from '../../i18n';

/** The bar of a count: how much is done, in the colour of its state. */
export function Meter({ pct, state, label }: { pct: number; state?: 'done' | 'now' | 'blocked' | 'todo'; label: string }) {
  return <span className="pm-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label} data-s={state ?? (pct >= 100 ? 'done' : 'now')}><i style={{ width: `${pct}%` }} /></span>;
}

/** «14 di 22 passi fatti» (a sequence) or «14 di 22 parti fatte» (the parts of a system). */
export const countText = (p: Pick<MapProgress, 'done' | 'total' | 'steps'>): string => t(p.steps ? 'pm.planSteps' : 'pm.prog.parts', { done: p.done, total: p.total });

/** The percentage in the header: what it counts is in its tip. */
export function ProgressChip({ pct, tip }: { pct: number; tip: string }) {
  return <span className="pm-prog-chip" title={tip} data-testid="pm-progress-chip"><span>{t('pm.prog.title')}</span><Meter pct={pct} label={tip} /><b>{pct}%</b></span>;
}

/** The head of a count: the percentage in large type, the bar, and under them what was counted. */
export function ProgressHead({ pct, count, state, of }: { pct: number; count: ReactNode; state?: 'done' | 'now' | 'blocked' | 'todo'; /** what the bar counts, for a screen reader (a plan's title, a box's name) */ of?: string }) {
  return <>
    <div className="pm-prog-head"><b className="pm-prog-pct" data-testid="pm-progress-pct">{pct}%</b><Meter pct={pct} {...(state ? { state } : {})} label={of ? `${t('pm.prog.title')}: ${of}` : t('pm.prog.title')} /></div>
    <p className="pm-prog-count">{count}</p>
  </>;
}

/** One line of the card: a piece (opened by a click) or a link, where it sits, who works on it, its note. */
function Item({ x, who, onShow }: { x: ProgressItem; who?: string | undefined; onShow: (id: string) => void }) {
  return <li data-testid={`pm-progress-item-${x.id}`}>
    {x.link ? <b>{x.name}</b> : <button type="button" onClick={() => onShow(x.id)}>{x.name}</button>}
    {x.within && <small>{t('pm.prog.within', { name: x.within })}</small>}
    {who && <small className="pm-prog-who">{who}</small>}
    {x.note && <span>{x.note}</span>}
  </li>;
}

export function ProgressCard({ p, compact, whoOf, onShow }: {
  p: MapProgress;
  /** something else is being read in the panel (a picked box, a path, the inside of a system): the card folds */
  compact: boolean;
  /** who works on a piece right now, in words («ci lavora Artisan») */
  whoOf: (id: string) => string | undefined;
  onShow: (id: string) => void;
}) {
  const [more, setMore] = useState(false);
  useEffect(() => { setMore(false); }, [compact]);
  const open = !compact || more;
  const closed = p.groups.filter(g => g.state === 'done').length;
  const at = p.at !== undefined ? p.groups[p.at] : undefined;
  const count = [countText(p), ...(p.ordered && p.groups.some(g => g.total > 1) ? [t('pm.prog.phases', { done: closed, total: p.groups.length })] : []), ...(p.unknown ? [t('pm.prog.unknown', { n: p.unknown })] : [])].join(' · ');
  return <section className="pm-prog" data-compact={open ? undefined : ''} data-testid="pm-progress">
    <div className="pm-prog-top"><span className="dash-eyebrow">{t('pm.prog.title')}</span>
      {compact && <button type="button" className="pm-prog-more" aria-expanded={open} onClick={() => setMore(m => !m)} data-testid="pm-progress-more">{t(open ? 'pm.prog.less' : 'pm.prog.more')}</button>}</div>
    <ProgressHead pct={p.pct} count={count} />
    {open && <dl className="pm-prog-facts">
      {p.total > 0 && p.done === p.total && !p.you.length && !p.blocked.length && <><dt>{t('pm.prog.at')}</dt><dd data-testid="pm-progress-at">{t('pm.prog.allDone')}</dd></>}
      {at && <><dt>{t('pm.prog.at')}</dt><dd data-testid="pm-progress-at"><button type="button" onClick={() => onShow(at.id)}>{at.name}</button><small>{t('pm.prog.of', { done: at.done, total: at.total })}</small></dd></>}
      {p.now.length > 0 && <><dt>{t('pm.prog.now')}</dt><dd><ul data-testid="pm-progress-now">{p.now.map(x => <Item key={x.id} x={x} who={whoOf(x.id)} onShow={onShow} />)}</ul></dd></>}
      {p.you.length > 0 && <><dt className="pm-prog-you">{t('pm.youMeans')}</dt><dd><ul data-testid="pm-progress-you">{p.you.map(x => <Item key={x.id} x={x} onShow={onShow} />)}</ul></dd></>}
      {p.blocked.length > 0 && <><dt className="pm-prog-stuck">{t('pm.state.blocked')}</dt><dd><ul data-testid="pm-progress-blocked">{p.blocked.map(x => <Item key={x.id} x={x} onShow={onShow} />)}</ul></dd></>}
      {p.next && <><dt>{t('pm.prog.next')}</dt><dd><ul data-testid="pm-progress-next"><Item x={p.next} onShow={onShow} /></ul></dd></>}
    </dl>}
    {open && p.groups.length > 1 && <ol className="pm-prog-groups" data-testid="pm-progress-groups">
      {p.groups.map((g, i) => <li key={g.id} data-s={g.state} data-at={p.at === i ? '' : undefined}>
        <button type="button" onClick={() => onShow(g.id)} title={t(`pm.prog.state.${g.state}`)} data-testid={`pm-progress-group-${g.id}`}>
          <i>{g.state === 'done' ? '✓' : g.state === 'blocked' ? '✕' : p.ordered ? i + 1 : '·'}</i><span>{g.name}</span><Meter pct={g.pct} state={g.state} label={g.name} /><small>{g.done}/{g.total}</small>
        </button>
      </li>)}
    </ol>}
  </section>;
}
