// A work map's plan drawn (ADR 0343; the owner, 2026-11-23: «il piano che propone deve essere solo la mappa»): the steps as
// boxes, one row per turn, an arrow from a turn to the following one; the steps of one turn sit in a dashed frame with a
// point where the arrow splits and one where it joins, and a label that counts them live. A box says who does it (role and
// its card's preset, never a model: ADR 0346), how far it is and what it is doing now, and carries its chats as buttons. The steps a replan takes away are under the drawing:
// they lead nowhere. Pure drawing: WorkMapView.tsx owns the map and the picked box.
import type { ReactNode } from 'react';
import { ROLE_DEFAULTS } from '@shared/roles';
import type { WorkBox, WorkLink } from '@shared/work-map';
import { openChatRef } from '../../actions';
import { t } from '../../i18n';
import { withoutImages } from '../../lib/askImages';
import { chatsOf, liveKind, rowsOf } from '../../lib/work-maps';
import { useApp } from '../../store/store';
import { AgentAvatar } from '../AgentAvatar';
import { IconChat } from '../Icons';
import { groupLabel, stateOf, whoOf } from '../project-map/plan-words';
import { LiveChip, sayLabel, Stale } from './LiveBits';

const MARK = (b: WorkBox): string => (b.state === 'done' ? '✓' : b.state === 'blocked' ? '✕' : String(b.n));

/** The chats working on a step, each a button with its title and what it is doing; one no longer in the app is said so when
 *  the live status still counts on it, else left out. */
export function BoxChats({ b, testid }: { b: WorkBox; testid: string }) {
  const ids = chatsOf(b), said = new Map((b.live?.chats ?? []).map(w => [w.chatId, w]));
  const titles = useApp(s => ids.map(id => s.chats[id]?.title ?? '').join('\n')).split('\n');
  return <>{ids.map((id, i) => {
    const w = said.get(id), say = w ? sayLabel(w) : '';
    if (!titles[i]) return w?.say === 'gone' ? <span key={id} className="wm-boxchat" data-k="bad" data-testid={`${testid}-${i}`}>{w.title || t('wm.say.gone')}</span> : null;
    return <button key={id} type="button" className="wm-boxchat" data-k={w ? liveKind(w) : undefined} onClick={() => openChatRef(id)} title={say ? `${titles[i]} · ${say}` : titles[i]} data-testid={`${testid}-${i}`}><IconChat size={11} /><span>{titles[i]}</span>{w && <i className="wm-say" data-k={liveKind(w)} aria-label={say} />}</button>;
  })}</>;
}

function Box({ b, now, picked, onPick }: { b: WorkBox; now: number; picked: boolean; onPick: (n: number) => void }) {
  const who = whoOf(b), name = b.role ? ROLE_DEFAULTS[b.role].name : t('wm.self');
  return <article className="wm-box" data-s={b.state} data-added={b.added ? '' : undefined} data-drop={b.drop ? '' : undefined} data-picked={picked ? '' : undefined} data-testid={`wm-box-${b.n}`}>
    <button type="button" className="wm-box-main" aria-pressed={picked} onClick={() => onPick(b.n)} data-testid={`wm-box-pick-${b.n}`}>
      <span className="wm-box-top"><i>{MARK(b)}</i><b>{withoutImages(b.title)}</b></span>
      <span className="wm-box-who"><AgentAvatar avatar={{ kind: 'character', value: b.role ?? 'strategist' }} name={name} size={20} /><span data-testid={`wm-box-who-${b.n}`}>{who ?? name}</span></span>
      <span className="wm-box-state">
        <span>{stateOf(b, now)}</span>
        <LiveChip live={b.live} testid={`wm-box-live-${b.n}`} />
        <Stale live={b.live} now={now} testid={`wm-box-stale-${b.n}`} />
        {b.outcome && b.outcome !== 'done' && b.outcome !== b.state && <em data-k="stuck">{t(`wm.outcome.${b.outcome}`)}</em>}
        {b.added && <em data-k="new">{t('pm.new')}</em>}
        {b.drop && <em data-k="drop">{t('wm.draw.drop')}</em>}
      </span>
    </button>
    {chatsOf(b).length > 0 && <div className="wm-box-chats"><BoxChats b={b} testid={`wm-box-chat-${b.n}`} /></div>}
  </article>;
}

export function WorkDrawing({ boxes, links, now, picked, onPick }: { boxes: readonly WorkBox[]; links: readonly WorkLink[]; now: number; picked: number | null; onPick: (n: number) => void }) {
  const { rows, dropped } = rowsOf(boxes, links);
  const live = boxes.filter(b => !b.drop);
  const draw = (b: WorkBox): ReactNode => <Box key={b.n} b={b} now={now} picked={picked === b.n} onPick={onPick} />;
  return <div className="wm-drawing" data-testid="wm-drawing" role="group" aria-label={t('wm.draw.label')}>
    {rows.map((r, i) => {
      const label = groupLabel(live, r.wave);
      return <div key={r.wave} className="wm-turn" data-testid={`wm-turn-${r.wave}`}>
        {i > 0 && rows[i - 1]!.out && r.in && <span className="wm-link" aria-hidden="true" data-testid={`wm-link-${r.wave}`} />}
        {label ? <div className="wm-par" data-in={r.in ? '' : undefined} data-out={r.out ? '' : undefined} data-testid={`wm-par-${r.wave}`}><span className="wm-par-label">{label}</span><div className="wm-par-boxes">{r.boxes.map(draw)}</div></div>
          : r.boxes.map(draw)}
      </div>;
    })}
    {dropped.length > 0 && <section className="wm-dropped" data-testid="wm-dropped"><h4>{t('wm.draw.dropped')}</h4><div className="wm-par-boxes">{dropped.map(draw)}</div></section>}
  </div>;
}
