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
//  - nothing changed for this chat (the same model, a card that cannot start a chat now): it keeps waiting.
// Tests: test/unit/agents/credit-wait.test.ts.
import type { ChatSummary, Effort, Harness } from '../../shared/contract';
import type { Delegator, PresetAsk } from '../../shared/model-presets';
import { errText, log } from '../log';

/** What a role's card gives a chat of that role now, for a preset. */
export interface CardNow { engine: Harness; model: string | null; effort: Effort | null }
export interface CreditWaitDeps {
  chats: {
    list(): ChatSummary[];
    creditResume(chatId: string, to: { model: string | null; effort: Effort | null }): Promise<boolean>;
    creditContinue(chatId: string, on: CardNow): Promise<boolean>;
    creditOtherEngine(chatId: string, engine: string): void;
  };
  /** catalog.cardNow: throws when the card cannot start a chat now (engine off, a model it cannot apply) */
  card(roleId: string, ask: PresetAsk, delegator?: Delegator): CardNow;
  /** why a chat on `from` may not start one on `to` (the user's engine settings), or null */
  engineRefusal(from: Harness, to: Harness): string | null;
}

export type CreditMove = { do: 'resume'; to: { model: string | null; effort: Effort | null } } | { do: 'continue'; on: CardNow } | { do: 'stay'; engine: string };

/** What its role's card means now for a chat that waits on its credits; null = nothing changed for it. */
export function creditMove(c: ChatSummary, parent: ChatSummary | undefined, d: Pick<CreditWaitDeps, 'card' | 'engineRefusal'>): CreditMove | null {
  const w = c.creditWait, role = c.agent?.source === 'catalog' ? c.agent.id : undefined;
  if (!w || !role || c.closedAt || c.continuedBy || c.isOrchestrator) return null;
  // while it works (the user or its parent wrote to it) nothing is switched under it
  if (c.state === 'running' || c.state === 'starting' || c.state === 'waiting' || c.queued) return null;
  const run = c.run?.presetChoice, preset = run?.preset ?? 'base';
  let card: CardNow;
  try {
    card = d.card(role, preset === 'base' ? {} : { preset, presetWhy: run?.presetWhy ?? 'the preset the chat runs on' }, parent ? { ...(parent.agent?.id ? { role: parent.agent.id } : {}), model: parent.model } : undefined);
  } catch { return null; } // the card cannot start a chat now: the wait goes on, the Agenti page says what is wrong
  if (card.engine !== c.harness) {
    // already told that it cannot follow the card there (refused, or the new chat did not start): once per engine
    if (w.otherEngine === card.engine) return null;
    // a delegated chat's new engine must be one its parent may start (Impostazioni → Motori): else it stays
    if (parent && d.engineRefusal(parent.harness, card.engine)) return { do: 'stay', engine: card.engine };
    return { do: 'continue', on: card };
  }
  // the model that ran out is still the card's: nothing changed for this chat (an effort alone gives no credit back)
  if ((card.model ?? null) === (w.model ?? null)) return null;
  return { do: 'resume', to: { model: card.model, effort: card.effort } };
}

/** Applies creditMove to every waiting chat; call it at each change of the catalog and of a waiting chat (a card that
 *  already names another model when the wait begins counts at once). One move per chat at a time; a move that fails
 *  leaves the chat waiting (logged) and is not tried again for the same card. */
export function creditWaitWatch(d: CreditWaitDeps): () => void {
  const moving = new Set<string>(), failed = new Map<string, string>();
  return () => {
    const all = d.chats.list();
    for (const id of failed.keys()) if (!all.some(c => c.id === id && c.creditWait)) failed.delete(id);
    for (const c of all) {
      if (!c.creditWait || moving.has(c.id)) continue;
      const move = creditMove(c, c.parentId ? all.find(p => p.id === c.parentId) : undefined, d);
      if (!move) continue;
      if (move.do === 'stay') { d.chats.creditOtherEngine(c.id, move.engine); continue; }
      const key = JSON.stringify(move);
      if (failed.get(c.id) === key) continue;
      moving.add(c.id);
      const done = move.do === 'resume' ? d.chats.creditResume(c.id, move.to) : d.chats.creditContinue(c.id, move.on);
      void done.then(ok => { if (ok) log.info('agents', 'chat out of credits goes on with its card', { chat: c.id, data: { how: move.do, engine: move.do === 'continue' ? move.on.engine : c.harness, model: move.do === 'continue' ? move.on.model : move.to.model } }); })
        .catch(e => {
          failed.set(c.id, key);
          log.warn('agents', 'chat out of credits not resumed', { chat: c.id, cause: errText(e), hint: 'it keeps waiting: change the role card again, or write to the chat' });
          if (move.do === 'continue') d.chats.creditOtherEngine(c.id, move.on.engine);
        })
        .finally(() => moving.delete(c.id));
    }
  };
}
