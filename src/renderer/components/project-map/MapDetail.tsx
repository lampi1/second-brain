// What the project map tells about one piece, beside the drawing (ADR 0307). The owner (2026-11-14): «hanno un gran
// potenziale ma il contenuto testuale non è molto dettagliato». A box shows one line; here is the rest: how the piece
// works (its details, written by the agent that drew it), its status and what is missing, the files it was read from,
// every passage in and out with what goes along it, and the plan steps on it. A picked arrow tells its passages the
// same way. A piece drawn before the details existed says so and points to «Aggiorna». Used by ProjectMapView.tsx.
// More substance (ADR 0316, the owner 2026-11-15: «vorrei capire bene come è strutturato senza vederlo … troppi pochi
// dettagli», «un link al file chiave … che lo apre nel viewer»): the rules it applies, what it keeps and where, how it is
// built inside, how big it is (counted by the app from its files, no token), why it is made so, its key files (each opens
// in the viewer) and the paths that go through it.
import { useEffect, useState, type ReactNode } from 'react';
import { descendantsOf, passagesOf, type MapElement, type MapLink, type MapPath, type MapState, type MapWork, type ProjectMap } from '@shared/project-map';
import { t } from '../../i18n';
import { IconChat, IconFile } from '../Icons';
import { Turn } from './PlanFlow';

type Shown = MapState | 'stale';
const WORK_MARK = { todo: '○', now: '●', done: '✓', blocked: '✕' } as const;
const Paras = ({ text }: { text: string }) => <>{text.split('\n').map((p, i) => <p key={i} className="pm-long">{p}</p>)}</>;
const List = ({ items, id }: { items: string[]; id: string }) => <ul className="pm-facts" data-testid={id}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;

/** A file of the project, opened in the app's viewer: the path relative to the map's folder, in code type. */
export function FileLink({ path, onFile, testid }: { path: string; onFile: (path: string) => void; testid?: string }) {
  return <button type="button" className="pm-file" onClick={() => onFile(path)} title={t('pm.openFile')} data-testid={testid}><IconFile size={12} /><code>{path}</code></button>;
}

/** «Quanto è grande»: files and lines under the paths the piece was read from, counted by the app (projectmap:size). */
function Size({ project, id }: { project: string; id: string }) {
  const [size, setSize] = useState<{ files: number; lines: number; capped: boolean } | null>(null);
  useEffect(() => {
    let on = true;
    setSize(null);
    void window.sb.invoke('projectmap:size', { project, element: id }).then(v => { if (on) setSize(v); }, () => {});
    return () => { on = false; };
  }, [project, id]);
  if (!size || !size.files) return null;
  const p = { files: size.files.toLocaleString(), lines: size.lines.toLocaleString() };
  return <><h4>{t('pm.size')}</h4><p data-testid="pm-size">{t(size.capped ? 'pm.sizeAtLeast' : 'pm.sizeIs', p)}</p></>;
}

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

export function ElementDetail({ map, el, state, stateOfLink, confirmed, works, onTalk, onShow, onFile, onWalk, testid = 'pm-detail', lead }: {
  map: ProjectMap; el: MapElement; state: Shown; stateOfLink: (l: MapLink) => Shown; confirmed: string; works: MapWork[];
  onTalk: () => void; onShow: (id: string) => void; onFile: (path: string) => void; onWalk: (path: MapPath, stop: number) => void; testid?: string; lead?: ReactNode;
}) {
  const byId = new Map(map.elements.map(e => [e.id, e]));
  const parts = map.elements.filter(e => e.parent === el.id);
  const inner = descendantsOf(map, el.id);
  const kidsOf = (id: string) => map.elements.filter(e => e.parent === id).length;
  // the paths with a stop here (or on a piece inside), each opened at its first stop here
  const through = (map.paths ?? []).flatMap(p => { const i = p.stops.findIndex(s => s.on === el.id || inner.has(s.on)); return i < 0 ? [] : [{ p, i }]; });
  // a system's passages are its parts' too, as the drawing lifts them onto its box: what leaves it and what enters it
  const { out, into } = passagesOf(map, el.id);
  return <section className="pm-detail" data-testid={testid}>
    <span className="dash-eyebrow">{lead ?? t(`pm.kind.${el.kind}`).toUpperCase()}</span>
    <h3>{el.name}</h3>
    {el.description && <p>{el.description}</p>}
    <p><i className={`pm-dot s-${state}`} />{t(`pm.state.${state}`)}{el.note ? `: ${el.note}` : ''}</p>
    <h4>{t('pm.how')}</h4>
    {el.details ? <Paras text={el.details} /> : <p className="pm-muted" data-testid="pm-no-details">{t('pm.noDetails')}</p>}
    {el.rules?.length ? <><h4>{t('pm.rules')}</h4><List items={el.rules} id="pm-rules" /></> : null}
    {el.keeps?.length ? <><h4>{t('pm.keeps')}</h4><List items={el.keeps} id="pm-keeps" /></> : null}
    {parts.length > 0 && <><h4>{t('pm.partsOf')}</h4><ul className="pm-partlist">{parts.map(p => <li key={p.id}><button type="button" onClick={() => onShow(p.id)}>{p.name}{kidsOf(p.id) ? <small> · {t('pm.parts', { n: kidsOf(p.id) })}</small> : null}</button>{p.description ? <span>{p.description}</span> : null}</li>)}</ul></>}
    {(out.length > 0 || into.length > 0) && <><h4>{t('pm.passages')}</h4><ul className="pm-passes" data-testid="pm-passes">
      {out.map(l => <Passage key={l.id} l={l} other={byId.get(l.to)} dir="out" state={stateOfLink(l)} onShow={onShow} />)}
      {into.map(l => <Passage key={l.id} l={l} other={byId.get(l.from)} dir="in" state={stateOfLink(l)} onShow={onShow} />)}
    </ul></>}
    {el.evidence.length > 0 && <Size project={map.project} id={el.id} />}
    {el.why?.length ? <><h4>{t('pm.why')}</h4><List items={el.why} id="pm-why" /></> : null}
    {el.keyFiles?.length ? <><h4>{t('pm.keyFiles')}</h4><ul className="pm-keyfiles" data-testid="pm-keyfiles">{el.keyFiles.map(f => <li key={f.path}><FileLink path={f.path} onFile={onFile} testid={`pm-keyfile-${f.path}`} />{f.what ? <span>{f.what}</span> : null}</li>)}</ul></> : null}
    {through.length > 0 && <><h4>{t('pm.pathsHere')}</h4><ul className="pm-pathlist" data-testid="pm-paths-here">{through.map(({ p, i }) => <li key={p.id}><button type="button" onClick={() => onWalk(p, i)}>{p.question}</button><small>{t('pm.stopOf', { n: i + 1, total: p.stops.length })}</small></li>)}</ul></>}
    {works.length > 0 && <><h4>{t('pm.worksOn')}</h4><ul className="pm-worklist" data-testid="pm-worklist">{works.map(w => <li key={`${w.chatId}-${w.step}`} data-s={w.state}><i>{WORK_MARK[w.state]}</i><Turn wave={w.wave} par={w.par} /><span>{w.title}{w.added && <em className="pm-new">{t('pm.new')}</em>}</span>{w.role && <small>{w.role}</small>}</li>)}</ul></>}
    <p className="pm-muted">{confirmed}</p>
    {el.evidence.length > 0 && <p className="pm-muted pm-evidence">{t('pm.files')} {el.evidence.map(f => (f.endsWith('/') ? <code key={f} className="pm-folder">{f}</code> : <FileLink key={f} path={f} onFile={onFile} />))}</p>}
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
