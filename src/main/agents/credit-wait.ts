// A role chat whose turn stopped on its provider's credit or plan limit waits (ChatSummary.creditWait, set by the chat
// manager: manager-delegation.ts creditStop; ADR 0346, issue #462: «potrei finire i crediti e dover cambiare il
// modello»). It goes on when the user changes its role's card, and only then: the app never picks another model or
// preset by itself. Here: what a card means for one waiting chat (creditMove) and the watch that applies it at every
// change of the catalog (creditWaitWatch, wiring.ts on 'agents:changed'). The card's model is read as a launch reads it
// (catalog.cardNow = resolve's guards), for the preset the chat runs on.
//  - the card's engine is the chat's and its model for that preset is another one: the chat switches to it and goes on
//    from where it was (ChatManager.creditResume);
//  - the card moved to another engine: a chat never changes engine, so its work goes on in a new chat of the same role
//    on the card's engine, the same child of the same parent with the same contract and worktree («Riprendi» with a
//    hand-off note the app writes: the old engine cannot be asked, ChatManager.creditContinue);
//  - nothing changed for this chat (the card it already answered, a card that cannot start a chat now, a job the user
//    stopped): it keeps waiting.
// The card is compared with the card the wait answered (creditWait.card, «engine:model»), never with the chat's own
// model: an ACP engine names its running variant there (grok-4.7[context=…]), which no card ever names. A move that
// stays (an engine the parent may not start) or fails records the card too: tried again only after the next change.
// Since ADR 0348 (owner, 2026-11-24, proposal 3A) the card a wait follows is its level's pick (catalog.cardNow goes
// through ADR 0347's pick by room): when the chat's plan is spent, the pick is the next model of the level with room,
// and the chat moves there by itself after GRACE_MS, announced in the chat with «Annulla» (ChatManager.creditPlan,
// creditStay). A cancelled move (`stay`) waits as before: it moves only when the role's levels change again.
// Tests: test/unit/agents/credit-wait.test.ts.
import type { ChatSummary, Effort, Harness } from '../../shared/contract';
import type { Delegator, PresetAsk } from '../../shared/model-presets';
import { errText, log } from '../log';

/** What a role's card gives a chat of that role now, for a preset. */
export interface CardNow { engine: Harness; model: string | null; effort: Effort | null }
/** The key a wait remembers for a card: its engine and model, not its effort (an effort alone gives no credit back). */
export const creditCardKey = (c: Pick<CardNow, 'engine' | 'model'>): string => `${c.engine}:${c.model ?? ''}`;

/** How long an automatic move is announced before it happens (ADR 0348): time to press «Annulla». */
export const GRACE_MS = 8000;

export interface CreditWaitDeps {
  chats: {
    /** announces the move to `on` at `at` (the chat's «Annulla» cancels it) */
    creditPlan(chatId: string, next: { card: string; at: number }, on: CardNow): void;
    list(): ChatSummary[];
    creditResume(chatId: string, to: { model: string | null; effort: Effort | null }): Promise<boolean>;
    creditContinue(chatId: string, on: CardNow): Promise<boolean>;
    /** records the card this wait answered; with `engine`, says the chat cannot follow the card there */
    creditCard(chatId: string, card: string, engine?: string): void;
  };
  /** catalog.cardNow: throws when the card cannot start a chat now (engine off, a model it cannot apply) */
  card(roleId: string, ask: PresetAsk, delegator?: Delegator): CardNow;
  /** why an agent may not open a chat on `to` (the user's engine settings), or null */
  engineRefusal(to: Harness): string | null;
  now?: () => number;
  /** runs the watch again later (the end of a grace) */
  later?: (fn: () => void, ms: number) => void;
}

export type CreditMove = ({ do: 'resume'; to: { model: string | null; effort: Effort | null } } | { do: 'continue'; on: CardNow }
  | { do: 'stay'; engine: string } | { do: 'note' }) & { card: string };

/** The user stopped the job this chat works for (ADR 0342): its own plan or an ancestor's. */
const stoppedJob = (c: ChatSummary, chatOf: (id: string) => ChatSummary | undefined): boolean => {
  const seen = new Set<string>();
  for (let x: ChatSummary | undefined = c; x && !seen.has(x.id); x = x.parentId ? chatOf(x.parentId) : undefined) {
    seen.add(x.id);
    if (x.plan?.stopped) return true;
  }
  return false;
};

/** What its role's card means now for a chat that waits on its credits; null = nothing changed for it. */
export function creditMove(c: ChatSummary, chatOf: (id: string) => ChatSummary | undefined, d: Pick<CreditWaitDeps, 'card' | 'engineRefusal'>): CreditMove | null {
  const w = c.creditWait, role = c.agent?.source === 'catalog' ? c.agent.id : undefined;
  if (!w || !role || c.closedAt || c.continuedBy || c.isOrchestrator) return null;
  // while it works (the user or its parent wrote to it) nothing is switched under it
  if (c.state === 'running' || c.state === 'starting' || c.state === 'waiting' || c.queued) return null;
  // the user stopped its job («Ferma»): it starts nothing until they resume it
  if (stoppedJob(c, chatOf)) return null;
  const parent = c.parentId ? chatOf(c.parentId) : undefined;
  const run = c.run?.presetChoice, preset = run?.preset ?? 'base';
  let card: CardNow;
  try {
    card = d.card(role, preset === 'base' ? {} : { preset, presetWhy: run?.presetWhy ?? 'the preset the chat runs on' }, parent ? { ...(parent.agent?.id ? { role: parent.agent.id } : {}), model: parent.model } : undefined);
  } catch { return null; } // the card cannot start a chat now: the wait goes on, the Agenti page says what is wrong
  const key = creditCardKey(card);
  if (w.card === key) return null; // the card this wait already answered: nothing changed for this chat
  // the run did not say which card the chat started from: the card read now is the one it waits on
  if (w.card === undefined) return { do: 'note', card: key };
  if (card.engine !== c.harness) {
    // the new engine must be one agents may open (Impostazioni → Motori): else it stays
    if (d.engineRefusal(card.engine)) return { do: 'stay', engine: card.engine, card: key };
    return { do: 'continue', on: card, card: key };
  }
  return { do: 'resume', to: { model: card.model, effort: card.effort }, card: key };
}

/** Applies creditMove to every waiting chat; call it at each change of the catalog and of a waiting chat. One move per
 *  chat at a time; a move that fails leaves the chat waiting, says why in it and is not tried again for the same card. */
export function creditWaitWatch(d: CreditWaitDeps): () => void {
  const moving = new Set<string>();
  const now = d.now ?? Date.now, later = d.later ?? ((fn, ms) => { setTimeout(fn, ms).unref?.(); });
  const watch = () => {
    const all = d.chats.list(), byId = new Map(all.map(c => [c.id, c]));
    for (const c of all) {
      if (!c.creditWait || moving.has(c.id)) continue;
      const move = creditMove(c, id => byId.get(id), d);
      if (!move) continue;
      if (move.do === 'note') { d.chats.creditCard(c.id, move.card); continue; }
      if (move.do === 'stay') { d.chats.creditCard(c.id, move.card, move.engine); continue; }
      // the automatic move (ADR 0348): announced first, made when its grace is over and nothing changed meanwhile; a
      // wait the user cancelled moves at once on a new card (the user changed the role's levels)
      const w = c.creditWait;
      if (!w.stay) {
        if (w.next?.card !== move.card) {
          d.chats.creditPlan(c.id, { card: move.card, at: now() + GRACE_MS }, move.do === 'resume' ? { engine: c.harness, ...move.to } : move.on);
          later(watch, GRACE_MS + 50);
          continue;
        }
        if (w.next.at > now()) { later(watch, w.next.at - now() + 50); continue; }
      }
      moving.add(c.id);
      const done = move.do === 'resume' ? d.chats.creditResume(c.id, move.to) : d.chats.creditContinue(c.id, move.on);
      void done.then(ok => { if (ok) log.info('agents', 'chat out of credits goes on with its card', { chat: c.id, data: { how: move.do, card: move.card } }); })
        .catch(e => {
          log.warn('agents', 'chat out of credits not resumed', { chat: c.id, cause: errText(e), hint: 'it keeps waiting: change the role card again, or write to the chat' });
          d.chats.creditCard(c.id, move.card);
        })
        .finally(() => moving.delete(c.id));
    }
  };
  return watch;
}
