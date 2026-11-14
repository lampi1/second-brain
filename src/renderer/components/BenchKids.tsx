// The sub-agents of a bench in the Grindhouse workshop (ADR 0311; the owner picked «aiutanti allo stesso banco»,
// 2026-11-14): the chats a chat delegated stand at its bench, smaller, each doing what it does (StripFace.tsx) with its
// state dot (BenchHelpers, up to three and «+N»), and the bench's plate has one row for each: who, what it does now,
// for how long (BenchKidRows). A click on a helper or on its row opens that sub-agent's chat (the Grindhouse shows the
// whole team as tabs then: AgentStrips.tsx TeamTabs); a click on the little person itself stays a pat. Used by
// ChatTile.tsx on a closed bench.
import type { ChatSummary } from '@shared/contract';
import { childState, type ChildState } from '../lib/chat-tree';
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
  const kids = useKids(chatId);
  const now = useNow(15_000);
  if (!kids.length) return null;
  return <div className="bench-kids" role="list" aria-label={t('tree.kids', { n: kids.length })}>
    {kids.map(k => {
      const state = childState(k), name = k.agent?.name || k.title, work = workTime(k, now);
      return <button key={k.id} type="button" role="listitem" className="bench-kid" data-testid={`bench-kid-${k.id}`} data-child-state={state} onClick={() => setChatExpanded(k.id, true)}>
        <span className={`bench-dot tone-${kidTone(state)}`} aria-hidden="true" />
        <AgentAvatar avatar={k.agent?.avatar} name={name} size={16} />
        <b>{name}</b>
        <span className="bench-kid-now">{isBusy(k) ? <StripActivity chatId={k.id} /> : k.delegation?.goal || k.title}</span>
        <span className="bench-kid-time">{work !== null ? minutes(work) : t(`tree.state.${state}`)}</span>
      </button>;
    })}
  </div>;
}
