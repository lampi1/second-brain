// The sub-agents of a bench in the Grindhouse workshop (ADR 0311; the owner picked «aiutanti allo stesso banco»,
// 2026-11-14; ADR 0312): every chat a chat delegated, and the ones those delegated in turn, stands at its bench as a
// smaller person doing what it does (StripFace.tsx), a grandchild smaller still, up to SHOWN and «+N». Under the pointer
// or the keyboard a helper shows its name tag over its head: who, and its state in words; a click on the tag (or around
// the person) opens that chat in the Grindhouse with the whole team as tabs (AgentStrips.tsx TeamTabs), as a click in
// the sidebar does; a click on the person itself stays a pat or a whack (ADR 0297). The bench's foot counts them
// (running, waiting, stuck, done) with the limit the bench hit, when it did (BenchKidsSum). Used by ChatTile.tsx on a
// closed bench.
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

/** How many helpers stand at a bench; the rest are «+N». */
export const SHOWN = 5;
const sameKids = (a: readonly ChatSummary[], b: readonly ChatSummary[]) => a === b || (a.length === b.length && a.every((k, i) => k === b[i]));
/** Every open chat under `chatId`, depth first (a grandchild right after its parent), with its depth (1 = a child). */
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
const open = (id: string) => setChatExpanded(id, true);

/** The helpers at the bench, beside the bench's own person. */
export function BenchHelpers({ chatId }: { chatId: string }) {
  const team = useTeam(chatId);
  if (!team.length) return null;
  const shown = team.slice(0, SHOWN), rest = team.slice(SHOWN);
  return <span className="bench-helpers" data-testid={`bench-helpers-${chatId}`}>
    {shown.map(k => <Helper key={k.id} kid={k} depth={depthOf(k, chatId, team)} />)}
    {rest.length > 0 && <button type="button" className="bench-more" data-testid={`bench-more-${chatId}`} onClick={e => { e.stopPropagation(); open(rest[0]!.id); }}
      aria-label={t('tree.moreHelpers', { n: rest.length })} data-tip={rest.map(k => k.agent?.name || k.title).join(', ')}>+{rest.length}</button>}
  </span>;
}

function depthOf(k: ChatSummary, root: string, team: readonly ChatSummary[]): number {
  let depth = 1;
  for (let p = k.parentId; p && p !== root && depth < 6; p = team.find(x => x.id === p)?.parentId) depth++;
  return depth;
}

/** One helper: its person (a pat at a click), its dot, and its name tag that opens its chat. */
function Helper({ kid, depth }: { kid: ChatSummary; depth: number }) {
  const state = useSteady(childState(kid), working, s => s === 'err' || s === 'blocked');
  const busy = useSteady(isBusy(kid), b => b); // held like the state, or a short stop would remount the person
  const name = kid.agent?.name || kid.title, tone = kidTone(state), live = working(state) || state === 'wait';
  return <span className={`bench-helper${depth > 1 ? ' is-grand' : ''}${live ? ' is-live' : ''}`} data-testid={`bench-helper-${kid.id}`} data-child-state={state} data-depth={depth}
    onClick={e => { e.stopPropagation(); open(kid.id); }}>
    <button type="button" className={`bench-tag tone-${tone}`} data-testid={`bench-helper-open-${kid.id}`} onClick={e => { e.stopPropagation(); open(kid.id); }}
      aria-label={t('tree.openHelper', { name, state: t(`tree.state.${state}`) })}>
      <span className={`bench-dot tone-${tone}`} aria-hidden="true" /><b>{name}</b><span>{t(`tree.state.${state}`)}</span><i aria-hidden="true">›</i>
    </button>
    <span className={`bench-dot bench-head-dot tone-${tone}`} aria-hidden="true" />
    <StripFace chatId={kid.id} avatar={kid.agent?.avatar} name={name} tone={tone} size={36} height={depth > 1 ? 62 : 82}
      waitsUser={state === 'wait'} error={state === 'err' || state === 'blocked'} busy={busy && working(state)} done={state === 'done' || state === 'partial'} pending={working(state)} />
  </span>;
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
    {limit && <span className="pill pill-wait tree-limit" data-testid={`tree-limit-${chatId}`}>{t(`tree.limit.${limit.kind}`, { limit: limit.limit })}</span>}
  </span>;
}
