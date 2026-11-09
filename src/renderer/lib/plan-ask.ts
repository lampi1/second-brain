// A Strategist's plan waiting for the user's ok, as one more request of the questions window (ADR 0121, always on): a
// plan in phase "proposed" opens there like the other questions, its steps on a card
// (PlanApproval.tsx) with «Approva e parti» and «Cambia qualcosa»; the strip then only points to it. The plan itself
// stays ChatSummary.plan (shared/strategy.ts): no request is made in main, so an answer anywhere (the window, a restart) moves the plan's phase and the card leaves by itself, never twice. Its key carries the
// plan's `at`, the proposal the user reads (chat:plan refuses a newer one). Used by QuestionsWindow.tsx, lib/later.ts
// and StrategyPanel.tsx.
import { isNativeQuestion } from '@shared/yes-no';
import type { ChatSummary, PendingRequest } from '@shared/contract';
import type { AppState } from '../store/state';

/** The window's view of a plan to approve: shaped like a PendingRequest where the window reads one (key, chat, age). */
export interface PlanAsk { type: 'plan'; id: string; chatId: string; at: number }

const PREFIX = 'plan@';
/** the request id of a proposal (its key is `${chatId}/${id}`, as lib/later.ts and actions.ts reqKey build it) */
export const planAskId = (at: number): string => `${PREFIX}${at}`;
export const planAskKey = (chatId: string, at: number): string => `${chatId}/${planAskId(at)}`;

/** A chat whose plan waits for the user's ok (an open, proposed plan). */
export const planWaits = (c: Pick<ChatSummary, 'plan' | 'closedAt'> | undefined): boolean => !!c && !c.closedAt && c.plan?.phase === 'proposed';

/** The keys of every plan waiting for the user, oldest first: primitives, so a selector over them renders only on a change. */
export function planAskKeys(s: Pick<AppState, 'chats'>): string[] {
  return Object.values(s.chats).filter(planWaits).sort((a, b) => a.plan!.at - b.plan!.at).map(c => planAskKey(c.id, c.plan!.at));
}

/** A key back to its ask (null: not a plan's key). */
export function planAskOf(key: string): PlanAsk | null {
  const i = key.lastIndexOf(`/${PREFIX}`);
  if (i <= 0) return null;
  const at = Number(key.slice(i + 1 + PREFIX.length));
  return Number.isFinite(at) ? { type: 'plan', id: planAskId(at), chatId: key.slice(0, i), at } : null;
}

/** The requests with the plans put in where they came (before the first request that came later): the requests keep
 *  their own order, whatever their `at`. */
export function withPlans<T extends { type: string; at: number }>(reqs: readonly T[], plans: readonly PlanAsk[]): (T | PlanAsk)[] {
  const out: (T | PlanAsk)[] = [...reqs];
  for (const p of plans) { const i = out.findIndex(r => r.type !== 'plan' && r.at > p.at); out.splice(i < 0 ? out.length : i, 0, p); }
  return out;
}

/** The Strategist plan cards the Orchestrator shows, each with its open question (#351: «pulito ed essenziale»): a plan
 *  still asking only while its interview question is open (no «Prima di partire» card with nothing to answer, one per
 *  chat), a revision or a plan to approve as before; never for a closed chat. */
export function planCards<C extends Pick<ChatSummary, 'id' | 'plan' | 'closedAt'>>(chats: readonly C[], reqs: readonly PendingRequest[]): { chat: C; question?: PendingRequest }[] {
  const seen = new Set<string>();
  return chats.flatMap(chat => {
    const phase = chat.plan?.phase;
    if (chat.closedAt || seen.has(chat.id) || !phase || !['asking', 'revising', 'proposed'].includes(phase)) return [];
    seen.add(chat.id);
    const question = planQuestion(chat, reqs.filter(r => r.chatId === chat.id), false);
    return phase === 'asking' && !question ? [] : [{ chat, ...(question ? { question } : {}) }];
  });
}

/** The open question of a Strategist still asking (its plan card answers it, or points to the questions window). */
export function planQuestion(chat: Pick<ChatSummary, 'plan'>, reqs: readonly PendingRequest[], queued: boolean): PendingRequest | undefined {
  const p = chat.plan?.phase;
  return (p === 'asking' || p === 'revising') && !queued ? reqs.find(r => isNativeQuestion(r) && r.questions?.length === 1) : undefined;
}
