// The sub-agents of a bench in the Grindhouse workshop (ADR 0311; the owner picked «aiutanti allo stesso banco»,
// 2026-11-14; ADR 0312): every chat a chat delegated, and the ones those delegated in turn, stands at its bench as a
// smaller person doing what it does (StripFace.tsx), a grandchild smaller still, all of them, the ones at work first, in a row that scrolls sideways (the owner,
// 2026-11-15, ADR 0314). Under the pointer
// or the keyboard a helper shows its name tag over its head: who, and its state in words; a click on the tag (or around
// the person) opens that chat in the Grindhouse with the whole team as tabs (AgentStrips.tsx TeamTabs), as a click in
// the sidebar does; a click on the person itself stays a pat or a whack (ADR 0297). The bench's foot counts them
// (running, waiting, stuck, done) with the limit the bench hit, when it did (BenchKidsSum). Used by ChatTile.tsx on a
// closed bench.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChatSummary } from '@shared/contract';
import { childState, kidCounts, type ChildState } from '../lib/chat-tree';
import { openKidsOf } from '../lib/chat-derived';
import { useSteady } from '../lib/steady';
import { useApp } from '../store/store';
import { isBusy } from '../store/state';
import { setChatExpanded } from '../store/ui';
import { t } from '../i18n';
import { StripFace } from './StripFace';
import { LINE } from './DelegationCard';

/** How many helpers a bench draws at most (all of a real team; a cap so a runaway tree cannot flood the page). */
export const MAX_HELPERS = 40;
const sameKids = (a: readonly ChatSummary[], b: readonly ChatSummary[]) => a === b || (a.length === b.length && a.every((k, i) => k === b[i]));
/** Every open chat under `chatId`, depth first (a grandchild right after its parent). */
export function useTeam(chatId: string): readonly ChatSummary[] {
  return useApp(s => {
    const out: ChatSummary[] = [];
    const walk = (id: string, seen: Set<string>) => { for (const k of openKidsOf(s.chats, id)) if (!seen.has(k.id)) { seen.add(k.id); out.push(k); walk(k.id, seen); } };
    walk(chatId, new Set([chatId]));
    return out;
  }, sameKids);
}
/** The dot's tone of a sub-agent's state (the same tints as its thread line). */
export const kidTone = (state: ChildState): string => LINE[state];
const working = (s: ChildState) => s === 'run' || s === 'start';
/** Who stands first at the bench (the owner, 2026-11-15: «vorrei vedere quelli in attività per primi»): at work or
 *  waiting for someone, then stuck, then the rest. A short stop keeps its place (run and wait are one group). */
const rank = (s: ChildState) => s === 'run' || s === 'start' || s === 'wait' || s === 'queued' ? 0 : s === 'err' || s === 'blocked' || s === 'stall' ? 1 : 2;
const open = (id: string) => setChatExpanded(id, true);

/** The helpers at the bench, beside the bench's own person: all of them, the ones at work first, in a row that scrolls
 *  sideways (wheel, trackpad or its thin bar) when they do not fit. One name tag floats over the row for the helper
 *  under the pointer or the keyboard, kept inside the row, so no tag is ever cut at an edge. */
export function BenchHelpers({ chatId }: { chatId: string }) {
  const team = useTeam(chatId);
  const order = useMemo(() => team.map((k, i) => ({ k, i, r: rank(childState(k)) })).sort((x, y) => x.r - y.r || x.i - y.i).slice(0, MAX_HELPERS).map(x => x.k), [team]);
  const wrap = useRef<HTMLSpanElement>(null), row = useRef<HTMLSpanElement>(null);
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const hideT = useRef(0);
  const measure = useCallback(() => { const r = row.current; if (r) setEdge(e => { const left = r.scrollLeft > 2, right = r.scrollLeft + r.clientWidth < r.scrollWidth - 2; return e.left === left && e.right === right ? e : { left, right }; }); }, []);
  useLayoutEffect(measure, [measure, order.length]);
  // the wheel scrolls the row sideways while it can (a native listener: React's wheel is passive)
  useEffect(() => {
    const r = row.current; if (!r) return;
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || r.scrollWidth <= r.clientWidth) return;
      const max = r.scrollWidth - r.clientWidth, to = Math.max(0, Math.min(max, r.scrollLeft + e.deltaY));
      if (to === r.scrollLeft) return;
      e.preventDefault(); r.scrollLeft = to;
    };
    r.addEventListener('wheel', wheel, { passive: false });
    return () => r.removeEventListener('wheel', wheel);
  }, []);
  useEffect(() => () => window.clearTimeout(hideT.current), []);
  const show = (id: string, el: HTMLElement) => {
    window.clearTimeout(hideT.current);
    const w = wrap.current?.getBoundingClientRect(), b = el.getBoundingClientRect();
    if (w) setTip({ id, x: b.left + b.width / 2 - w.left, y: Math.max(38, b.top - w.top - 28) });
  };
  const hide = () => { window.clearTimeout(hideT.current); hideT.current = window.setTimeout(() => setTip(null), 160); };
  if (!order.length) return null;
  const tipKid = tip ? order.find(k => k.id === tip.id) : undefined;
  return <span ref={wrap} className={`bench-helpers-wrap${edge.left ? ' more-left' : ''}${edge.right ? ' more-right' : ''}`} data-testid={`bench-helpers-${chatId}`}>
    <span ref={row} className="bench-helpers" onScroll={() => { measure(); setTip(null); }}>
      {order.map(k => <Helper key={k.id} kid={k} depth={depthOf(k, chatId, team)} onShow={show} onHide={hide} />)}
    </span>
    {tip && tipKid && <HelperTag kid={tipKid} x={tip.x} y={tip.y} wrap={wrap} onEnter={() => window.clearTimeout(hideT.current)} onLeave={hide} />}
  </span>;
}

function depthOf(k: ChatSummary, root: string, team: readonly ChatSummary[]): number {
  let depth = 1;
  for (let p = k.parentId; p && p !== root && depth < 6; p = team.find(x => x.id === p)?.parentId) depth++;
  return depth;
}

/** The held state of a helper, so a short stop does not blink (ADR 0312). */
function useKidState(kid: ChatSummary): ChildState { return useSteady(childState(kid), working, s => s === 'err' || s === 'blocked'); }

/** One helper: its person (a pat or a whack at a click, ADR 0297) and its dot; Enter opens its chat; under the pointer
 *  or the keyboard the row shows its tag. */
function Helper({ kid, depth, onShow, onHide }: { kid: ChatSummary; depth: number; onShow: (id: string, el: HTMLElement) => void; onHide: () => void }) {
  const state = useKidState(kid);
  const busy = useSteady(isBusy(kid), b => b); // held like the state, or a short stop would remount the person
  const name = kid.agent?.name || kid.title, tone = kidTone(state), live = working(state) || state === 'wait';
  return <span className={`bench-helper${depth > 1 ? ' is-grand' : ''}${live ? ' is-live' : ''}`} data-testid={`bench-helper-${kid.id}`} data-child-state={state} data-depth={depth}
    tabIndex={0} role="button" aria-label={t('tree.openHelper', { name, state: t(`tree.state.${state}`) })}
    onMouseEnter={e => onShow(kid.id, e.currentTarget)} onMouseLeave={onHide} onFocus={e => onShow(kid.id, e.currentTarget)} onBlur={onHide}
    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); open(kid.id); } }}
    onClick={e => { e.stopPropagation(); open(kid.id); }}>
    <span className={`bench-dot bench-head-dot tone-${tone}`} aria-hidden="true" />
    <StripFace chatId={kid.id} avatar={kid.agent?.avatar} name={name} tone={tone} size={36} height={depth > 1 ? 62 : 82}
      waitsUser={state === 'wait'} error={state === 'err' || state === 'blocked'} busy={busy && working(state)} done={state === 'done' || state === 'partial'} pending={working(state)} />
  </span>;
}

/** The name tag over the hovered helper: who, its state in words, «›»; a click opens its chat. Kept inside the row. */
function HelperTag({ kid, x, y, wrap, onEnter, onLeave }: { kid: ChatSummary; x: number; y: number; wrap: React.RefObject<HTMLSpanElement | null>; onEnter: () => void; onLeave: () => void }) {
  const state = useKidState(kid), name = kid.agent?.name || kid.title, tone = kidTone(state);
  const el = useRef<HTMLButtonElement>(null);
  const [left, setLeft] = useState(x);
  useLayoutEffect(() => {
    const w = wrap.current?.clientWidth ?? 0, tw = el.current?.offsetWidth ?? 0;
    setLeft(Math.max(0, Math.min(Math.max(0, w - tw), x - tw / 2)));
  }, [x, name, state, wrap]);
  return <button ref={el} type="button" className={`bench-tag tone-${tone}`} style={{ left, top: y }} data-testid={`bench-helper-open-${kid.id}`}
    onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={e => { e.stopPropagation(); open(kid.id); }}
    aria-label={t('tree.openHelper', { name, state: t(`tree.state.${state}`) })}>
    <span className={`bench-dot tone-${tone}`} aria-hidden="true" /><b>{name}</b><span>{t(`tree.state.${state}`)}</span><i aria-hidden="true">›</i>
  </button>;
}

/** The bench's foot line about its team: how many, how many at work, waiting, stuck, done, and the limit it hit. */
export function BenchKidsSum({ chatId }: { chatId: string }) {
  const team = useTeam(chatId);
  const limit = useApp(s => s.chats[chatId]?.limitHit);
  // held like each helper's state: a helper's short stop does not move the counts
  const { run, wait, stuck, done } = useSteady(kidCounts(team.map(k => childState(k))), c => c.run > 0, c => c.stuck > 0);
  if (!team.length) return null;
  return <span className="bench-kids-sum" data-testid={`bench-kids-sum-${chatId}`} data-run={run}>
    <b>{t('tree.kids', { n: team.length })}</b>
    {run > 0 && <span className="is-run">{t('tree.kidsRun', { n: run })}</span>}
    {wait > 0 && <span className="is-wait">{t('tree.kidsWait', { n: wait })}</span>}
    {stuck > 0 && <span className="is-err">{t('tree.kidsStuck', { n: stuck })}</span>}
    {done > 0 && <span>{t('tree.kidsDone', { n: done })}</span>}
    {/* the limit it hit, said while it still matters (something at work), with what it means under the pointer */}
    {limit && run > 0 && <span className="pill pill-wait tree-limit" data-testid={`tree-limit-${chatId}`} tabIndex={0}
      data-tip={t(`tree.limit.${limit.kind}Tip`, { limit: limit.limit })} aria-label={t(`tree.limit.${limit.kind}Tip`, { limit: limit.limit })}>{t(`tree.limit.${limit.kind}`, { limit: limit.limit })}</span>}
  </span>;
}
