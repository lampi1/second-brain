// The sub-agents of a bench in the Grindhouse workshop (ADR 0311; the owner picked «aiutanti allo stesso banco»,
// 2026-11-14): the chats a chat delegated stand at its bench, smaller, each doing what it does (StripFace.tsx) with its
// state dot (BenchHelpers, up to three and «+N»), and the bench's plate has one row for each: who, what it does now,
// for how long, or its state when it needs someone (BenchKidRows; a grandchild has its row too, indented), under a line that counts them and shows the limit
// the bench hit, when it did. A click on a helper or on its row opens that sub-agent's chat (the Grindhouse shows the
// whole team as tabs then: AgentStrips.tsx TeamTabs); a click on the little person itself stays a pat. Used by
// ChatTile.tsx on a closed bench.
import type { ChatSummary } from '@shared/contract';
import { childState, kidCounts, type ChildState } from '../lib/chat-tree';
import { openKidsOf } from '../lib/chat-derived';
import { useApp } from '../store/store';
import { isBusy } from '../store/state';
import { setChatExpanded } from '../store/ui';
import { useNow } from '../lib/clock';
import { minutes, workTime } from '../lib/format';
import { t } from '../i18n';
import { StripFace } from './StripFace';
import { StripActivity } from './StripActivity';
import { AgentAvatar } from './AgentAvatar';
import { LINE } from './DelegationCard';

const SHOWN = 3;
const sameKids = (a: readonly ChatSummary[], b: readonly ChatSummary[]) => a === b || (a.length === b.length && a.every((k, i) => k === b[i]));
const useKids = (chatId: string) => useApp(s => openKidsOf(s.chats, chatId), sameKids);
/** Every open chat under `chatId`, depth first: a grandchild has no bench of its own, so it gets a row here too. */
const useTeam = (chatId: string) => useApp(s => {
  const out: ChatSummary[] = [];
  const walk = (id: string, seen: Set<string>) => { for (const k of openKidsOf(s.chats, id)) if (!seen.has(k.id)) { seen.add(k.id); out.push(k); walk(k.id, seen); } };
  walk(chatId, new Set([chatId]));
  return out;
}, sameKids);
/** The dot's tone of a sub-agent's state (the same tints as its thread line). */
export const kidTone = (state: ChildState): string => LINE[state];

/** The helpers at the bench, beside the bench's own person. */
export function BenchHelpers({ chatId }: { chatId: string }) {
  const kids = useKids(chatId);
  if (!kids.length) return null;
  return <span className="bench-helpers" data-testid={`bench-helpers-${chatId}`}>
    {kids.slice(0, SHOWN).map(k => {
      const state = childState(k), name = k.agent?.name || k.title;
      return <span key={k.id} className="bench-helper" role="button" tabIndex={-1} title={name} data-testid={`bench-helper-${k.id}`} onClick={e => { e.stopPropagation(); setChatExpanded(k.id, true); }}>
        <span className={`bench-dot tone-${kidTone(state)}`} aria-hidden="true" />
        <StripFace chatId={k.id} avatar={k.agent?.avatar} name={name} tone={kidTone(state)} size={40} height={88}
          waitsUser={state === 'wait'} error={state === 'err' || state === 'blocked'} busy={isBusy(k)} done={state === 'done' || state === 'partial'} pending={state === 'run' || state === 'start'} />
      </span>;
    })}
    {kids.length > SHOWN && <span className="bench-more">+{kids.length - SHOWN}</span>}
  </span>;
}

/** One row per sub-agent in the bench's plate. */
export function BenchKidRows({ chatId }: { chatId: string }) {
  const kids = useTeam(chatId);
  const now = useNow(15_000);
  const limit = useApp(s => s.chats[chatId]?.limitHit);
  if (!kids.length) return null;
  const { run, wait, stuck, done } = kidCounts(kids.map(k => childState(k)));
  return <div className="bench-kids" role="list" aria-label={t('tree.kids', { n: kids.length })}>
    <div className="bench-kids-sum" data-testid={`bench-kids-sum-${chatId}`}>
      <b>{t('tree.kids', { n: kids.length })}</b>
      {run > 0 && <span>{t('tree.kidsRun', { n: run })}</span>}
      {wait > 0 && <span>{t('tree.kidsWait', { n: wait })}</span>}
      {stuck > 0 && <span>{t('tree.kidsStuck', { n: stuck })}</span>}
      {done > 0 && <span>{t('tree.kidsDone', { n: done })}</span>}
      {limit && <span className="pill pill-wait tree-limit" data-testid={`tree-limit-${chatId}`}>{t(`tree.limit.${limit.kind}`, { limit: limit.limit })}</span>}
    </div>
    {kids.map(k => {
      const state = childState(k), name = k.agent?.name || k.title, work = workTime(k, now), needs = state === 'wait' || state === 'err' || state === 'blocked';
      let depth = 0; for (let p = k.parentId; p && p !== chatId && depth < 6; p = kids.find(x => x.id === p)?.parentId) depth++;
      return <div key={k.id} role="listitem" className="bench-kid-li" style={depth ? { paddingLeft: depth * 14 } : undefined}><button type="button" className="bench-kid" data-testid={`bench-kid-${k.id}`} data-child-state={state} onClick={() => setChatExpanded(k.id, true)}>
        <span className={`bench-dot tone-${kidTone(state)}`} aria-hidden="true" />
        <AgentAvatar avatar={k.agent?.avatar} name={name} size={16} />
        <b>{name}</b>
        <span className="bench-kid-now">{isBusy(k) ? <StripActivity chatId={k.id} /> : k.delegation?.goal || k.title}</span>
        <span className="bench-kid-time">{work !== null && !needs ? minutes(work) : t(`tree.state.${state}`)}</span>
      </button></div>;
    })}
  </div>;
}
