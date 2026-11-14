// What the project map tells about one piece, beside the drawing (ADR 0307). The owner (2026-11-14): «hanno un gran
// potenziale ma il contenuto testuale non è molto dettagliato». A box shows one line; here is the rest: how the piece
// works (its details, written by the agent that drew it), its status and what is missing, the files it was read from,
// every passage in and out with what goes along it, and the plan steps on it. A picked arrow tells its passages the
// same way. A piece drawn before the details existed says so and points to «Aggiorna». Used by ProjectMapView.tsx.
import type { ReactNode } from 'react';
import { passagesOf, type MapElement, type MapLink, type MapState, type MapWork, type ProjectMap } from '@shared/project-map';
import { t } from '../../i18n';
import { IconChat } from '../Icons';
import { Turn } from './PlanFlow';

type Shown = MapState | 'stale';
const WORK_MARK = { todo: '○', now: '●', done: '✓', blocked: '✕' } as const;
const Paras = ({ text }: { text: string }) => <>{text.split('\n').map((p, i) => <p key={i} className="pm-long">{p}</p>)}</>;

function Passage({ l, other, dir, state, onShow }: { l: MapLink; other: MapElement | undefined; dir: 'out' | 'in'; state: Shown; onShow: (id: string) => void }) {
  return <li className="pm-pass" data-dir={dir} data-testid={`pm-pass-${l.id}`}>
    <div className="pm-pass-head">
      <span aria-label={t(dir === 'out' ? 'pm.goesTo' : 'pm.comesFrom')} role="img">{dir === 'out' ? '→' : '←'}</span>
      <button type="button" onClick={() => onShow(dir === 'out' ? l.to : l.from)}>{other?.name ?? (dir === 'out' ? l.to : l.from)}</button>
      <b>{l.label}</b>
      {state !== 'ok' && <span className="pm-pass-st"><i className={`pm-dot s-${state}`} />{t(`pm.state.${state}`)}</span>}
    </div>
    {l.note && <p className="pm-muted">{l.note}</p>}
    {l.details && <Paras text={l.details} />}
  </li>;
}

export function ElementDetail({ map, el, state, stateOfLink, confirmed, works, onTalk, onShow, testid = 'pm-detail', lead }: {
  map: ProjectMap; el: MapElement; state: Shown; stateOfLink: (l: MapLink) => Shown; confirmed: string; works: MapWork[];
  onTalk: () => void; onShow: (id: string) => void; testid?: string; lead?: ReactNode;
}) {
  const byId = new Map(map.elements.map(e => [e.id, e]));
  const parts = map.elements.filter(e => e.parent === el.id);
  // a system's passages are its parts' too, as the drawing lifts them onto its box: what leaves it and what enters it
  const { out, into } = passagesOf(map, el.id);
  return <section className="pm-detail" data-testid={testid}>
    <span className="dash-eyebrow">{lead ?? t(`pm.kind.${el.kind}`).toUpperCase()}</span>
    <h3>{el.name}</h3>
    {el.description && <p>{el.description}</p>}
    <p><i className={`pm-dot s-${state}`} />{t(`pm.state.${state}`)}{el.note ? `: ${el.note}` : ''}</p>
    <h4>{t('pm.how')}</h4>
    {el.details ? <Paras text={el.details} /> : <p className="pm-muted" data-testid="pm-no-details">{t('pm.noDetails')}</p>}
    {parts.length > 0 && <><h4>{t('pm.partsOf')}</h4><ul className="pm-partlist">{parts.map(p => <li key={p.id}><button type="button" onClick={() => onShow(p.id)}>{p.name}</button>{p.description ? <span>{p.description}</span> : null}</li>)}</ul></>}
    {(out.length > 0 || into.length > 0) && <><h4>{t('pm.passages')}</h4><ul className="pm-passes" data-testid="pm-passes">
      {out.map(l => <Passage key={l.id} l={l} other={byId.get(l.to)} dir="out" state={stateOfLink(l)} onShow={onShow} />)}
      {into.map(l => <Passage key={l.id} l={l} other={byId.get(l.from)} dir="in" state={stateOfLink(l)} onShow={onShow} />)}
    </ul></>}
    {works.length > 0 && <><h4>{t('pm.worksOn')}</h4><ul className="pm-worklist" data-testid="pm-worklist">{works.map(w => <li key={`${w.chatId}-${w.step}`} data-s={w.state}><i>{WORK_MARK[w.state]}</i><Turn wave={w.wave} par={w.par} /><span>{w.title}{w.added && <em className="pm-new">{t('pm.new')}</em>}</span>{w.role && <small>{w.role}</small>}</li>)}</ul></>}
    <p className="pm-muted">{confirmed}</p>
    {el.evidence.length > 0 && <p className="pm-muted">{t('pm.files')} {el.evidence.join(', ')}</p>}
    <button type="button" className="btn btn-s" onClick={onTalk} data-testid={`${testid}-talk`}><IconChat size={13} />{t('pm.talk')}</button>
  </section>;
}

/** A picked arrow: every passage it stands for, each with what goes along it. */
export function LinkDetail({ map, links, stateOfLink, onShow }: { map: ProjectMap; links: MapLink[]; stateOfLink: (l: MapLink) => Shown; onShow: (id: string) => void }) {
  const name = (id: string) => map.elements.find(e => e.id === id)?.name ?? id;
  return <section className="pm-detail" data-testid="pm-link-detail">
    <span className="dash-eyebrow">{t('pm.passage').toUpperCase()}</span>
    {links.map(l => <div key={l.id} className="pm-linkcard">
      <h3>{l.label}</h3>
      <p className="pm-linkends"><button type="button" onClick={() => onShow(l.from)}>{name(l.from)}</button><span aria-hidden>→</span><button type="button" onClick={() => onShow(l.to)}>{name(l.to)}</button></p>
      <p><i className={`pm-dot s-${stateOfLink(l)}`} />{t(`pm.state.${stateOfLink(l)}`)}{l.note ? `: ${l.note}` : ''}</p>
      {l.details ? <Paras text={l.details} /> : <p className="pm-muted">{t('pm.noLinkDetails')}</p>}
    </div>)}
  </section>;
}
