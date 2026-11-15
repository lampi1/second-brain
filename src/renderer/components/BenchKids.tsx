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
import { createPortal } from 'react-dom';
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
/** Who stands first at the bench (the owner, 2026-11-15: «vorrei vedere quelli in attività per primi»): at work,
 *  waiting for someone or between two turns, then failed or refused, then the rest. A short stop keeps its place (run, wait and stall are one group). */
const rank = (s: ChildState) => s === 'run' || s === 'start' || s === 'queued' || s === 'wait' || s === 'stall' ? 0
  : s === 'err' || s === 'refused' || s === 'noreport' || s === 'blocked' ? 1 : 2;
const open = (id: string) => setChatExpanded(id, true);

/** The helpers at the bench, beside the bench's own person: all of them, the ones at work first, in a row that scrolls
 *  sideways (wheel, trackpad or its thin bar) when they do not fit. The helper under the pointer or the keyboard shows
 *  its name tag over the row (a portal into the row's frame), kept inside it, so no tag is ever cut at an edge. */
export function BenchHelpers({ chatId }: { chatId: string }) {
  const team = useTeam(chatId);
  const order = useMemo(() => team.map((k, i) => ({ k, i, r: rank(childState(k)) })).sort((x, y) => x.r - y.r || x.i - y.i).slice(0, MAX_HELPERS).map(x => x.k), [team]);
  const [wrap, setWrap] = useState<HTMLSpanElement | null>(null), [row, setRow] = useState<HTMLSpanElement | null>(null);
  const [tip, setTip] = useState<string | null>(null), [tick, setTick] = useState(0);
  const [edge, setEdge] = useState({ left: false, right: false });
  const hideT = useRef(0);
  const measure = useCallback(() => {
    if (!row) return;
    const left = row.scrollLeft > 2, right = row.scrollLeft + row.clientWidth < row.scrollWidth - 2;
    setEdge(e => e.left === left && e.right === right ? e : { left, right });
    setTick(n => n + 1);
  }, [row]);
  useLayoutEffect(measure, [measure, order]); // a new order moves the helpers: the tag follows
  // a resize of the bench moves the helpers and the edges: measured again
  useEffect(() => {
    if (!row || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure); ro.observe(row);
    return () => ro.disconnect();
  }, [row, measure]);
  // the wheel scrolls the row sideways while it can, then lets the page scroll (a native listener: React's is passive)
  useEffect(() => {
    if (!row) return;
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || row.scrollWidth <= row.clientWidth) return;
      const max = row.scrollWidth - row.clientWidth, to = Math.max(0, Math.min(max, row.scrollLeft + e.deltaY));
      if (Math.abs(to - row.scrollLeft) < 1) return;
      e.preventDefault(); row.scrollLeft = to;
    };
    row.addEventListener('wheel', wheel, { passive: false });
    return () => row.removeEventListener('wheel', wheel);
  }, [row]);
  useEffect(() => () => window.clearTimeout(hideT.current), []);
  const keep = useCallback(() => window.clearTimeout(hideT.current), []);
  const show = useCallback((id: string) => { window.clearTimeout(hideT.current); setTip(id); }, []);
  const hide = useCallback(() => { window.clearTimeout(hideT.current); hideT.current = window.setTimeout(() => setTip(null), 160); }, []);
  if (!order.length) return null;
  return <span ref={setWrap} className={`bench-helpers-wrap${edge.left ? ' more-left' : ''}${edge.right ? ' more-right' : ''}`} data-testid={`bench-helpers-${chatId}`}>
    <span ref={setRow} className="bench-helpers" onScroll={measure}>
      {order.map(k => <Helper key={k.id} kid={k} depth={depthOf(k, chatId, team)} frame={tip === k.id ? wrap : null} tick={tip === k.id ? tick : 0} onShow={show} onHide={hide} onKeep={keep} />)}
    </span>
  </span>;
}

function depthOf(k: ChatSummary, root: string, team: readonly ChatSummary[]): number {
  let depth = 1;
  for (let p = k.parentId; p && p !== root && depth < 6; p = team.find(x => x.id === p)?.parentId) depth++;
  return depth;
}

/** One helper: its person (a pat or a whack at a click, ADR 0297) and its dot; Enter opens its chat; under the pointer
 *  or the keyboard its tag, drawn in the row's frame (`frame`) with the same held state as the person. */
function Helper({ kid, depth, frame, tick, onShow, onHide, onKeep }: { kid: ChatSummary; depth: number; frame: HTMLElement | null; tick: number;
  onShow: (id: string) => void; onHide: () => void; onKeep: () => void }) {
  const state = useSteady(childState(kid), working, s => s === 'err' || s === 'blocked');
  const busy = useSteady(isBusy(kid), b => b); // held like the state, or a short stop would remount the person
  const self = useRef<HTMLSpanElement>(null);
  const name = kid.agent?.name || kid.title, tone = kidTone(state), live = working(state) || state === 'wait';
  const label = t('tree.openHelper', { name, state: t(`tree.state.${state}`) });
  return <span ref={self} className={`bench-helper${depth > 1 ? ' is-grand' : ''}${live ? ' is-live' : ''}`} data-testid={`bench-helper-${kid.id}`} data-child-state={state} data-depth={depth}
    tabIndex={0} role="button" aria-label={label}
    onMouseEnter={() => onShow(kid.id)} onMouseLeave={onHide} onFocus={() => onShow(kid.id)} onBlur={onHide}
    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); open(kid.id); } }}
    onClick={e => { e.stopPropagation(); open(kid.id); }}>
    <span className={`bench-dot bench-head-dot tone-${tone}`} aria-hidden="true" />
    <StripFace chatId={kid.id} avatar={kid.agent?.avatar} name={name} tone={tone} size={36} height={depth > 1 ? 62 : 82}
      waitsUser={state === 'wait'} error={state === 'err' || state === 'blocked'} busy={busy && working(state)} done={state === 'done' || state === 'partial'} pending={working(state)} />
    {frame && createPortal(<HelperTag id={kid.id} name={name} state={state} tone={tone} label={label} anchor={self} frame={frame} tick={tick} onEnter={onKeep} onLeave={onHide} />, frame)}
  </span>;
}

/** The name tag over a helper: who, its state in words, «›»; a click opens its chat. Placed over its helper (again when
 *  the row scrolls or resizes) and kept inside the row's frame. Not a tab stop: Enter on the helper opens it. */
function HelperTag({ id, name, state, tone, label, anchor, frame, tick, onEnter, onLeave }: { id: string; name: string; state: ChildState; tone: string; label: string;
  anchor: React.RefObject<HTMLSpanElement | null>; frame: HTMLElement; tick: number; onEnter: () => void; onLeave: () => void }) {
  const el = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null); // null: not placed, or its helper scrolled out of the row
  useLayoutEffect(() => {
    const a = anchor.current, me = el.current; if (!a || !me) return;
    const w = frame.getBoundingClientRect(), b = a.getBoundingClientRect(), tw = me.offsetWidth, mid = b.left + b.width / 2;
    if (mid < w.left || mid > w.right) { setAt(null); return; }
    const left = Math.max(0, Math.min(Math.max(0, w.width - tw), b.left + b.width / 2 - w.left - tw / 2)), top = Math.max(38, b.top - w.top - 28);
    setAt(p => p && p.left === left && p.top === top ? p : { left, top });
  }, [tick, name, state, anchor, frame]);
  return <button ref={el} type="button" tabIndex={-1} className={`bench-tag tone-${tone}`} style={at ? { left: at.left, top: at.top } : { visibility: 'hidden' }} data-testid={`bench-helper-open-${id}`}
    onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={e => { e.stopPropagation(); open(id); }} aria-label={label}>
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
      data-tip={t(`tree.limit.${limit.kind}Tip`, { limit: limit.limit })}>{t(`tree.limit.${limit.kind}`, { limit: limit.limit })}</span>}
  </span>;
}
