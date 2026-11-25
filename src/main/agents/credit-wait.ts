// A role chat whose turn stopped on its provider's credit or plan limit waits (ChatSummary.creditWait, set by the chat
// manager: manager-delegation.ts creditStop; ADR 0346) and moves by itself (ADR 0348, corrected by ADR 0353 on
// 2026-11-25: «una chat ferma per il limite cambia motore da sola e tiene il suo livello»):
//  - to the first model with room of the SAME level (Minimo, Base or Massimo) in the order of its role's card, on any
//    engine, with the effort the card gives that model; never a higher or lower level (no delegator's price ceiling here,
//    catalog.cardNow holdLevel); a chat started with the user's own model (userModel) follows the card's lists too, at the
//    level its launch named (Base when none);
//  - «room» is the one credit rule (shared/credit-rule.ts): a model that is out is never tried until the rule says free
//    or probation; when the whole level is out, the chat waits and says which models are out and when the first comes
//    back, and moves as soon as one is free again, the one it stopped on included;
//  - the same engine: the chat switches model (or keeps it) and goes on (ChatManager.creditResume); another engine: the
//    work goes on in a new chat of the same role, the same child of the same parent with the same contract, worktree and
//    uncommitted changes (ChatManager.creditContinue). Announced GRACE_MS before with «Annulla»;
//  - one move at a time per chat; chats that move together start STAGGER_MS apart, at most MAX_MOVING at once; a move
//    refused for good (the engine refuses the model, a guard) skips that model next time; a temporary failure is retried
//    after 30 s, 60 s, 120 s, then that model is skipped too; with nothing left the chat says why and keeps waiting;
//  - «Ferma» on its job, «Annulla» (until the role's levels change) and the user's own message always win.
// The watch runs at every change of the catalog, of a waiting chat, of a usage reading and when a pause or a spent window
// ends (wiring.ts, agents/credit-live.ts). The Orchestrator is not moved here (it follows its own card).
// Tests: test/unit/agents/credit-wait.test.ts, test/unit/agents/credit-truth.test.ts.
import type { ChatSummary, CreditWait, Effort, Harness } from '../../shared/contract';
import type { PresetAsk, PresetId } from '../../shared/model-presets';
import type { SkipNote } from '../../shared/model-levels';
import { errText, log } from '../log';

/** What a role's card gives a waiting chat now (catalog.cardNow): the level's pick and why. */
export interface CardNow { engine: Harness; model: string | null; effort: Effort | null; preset?: PresetId; allOut?: boolean; skipped?: SkipNote[]; route?: string; rooms?: { engine: string; model: string | null; why: string; until: number | null }[] }
/** The key of a model of a level: its engine and model, not its effort. */
export const creditCardKey = (c: Pick<CardNow, 'engine' | 'model'>): string => `${c.engine}:${c.model ?? ''}`;

/** How long an automatic move is announced before it happens (ADR 0348): time to press «Annulla». */
export const GRACE_MS = 8000;
/** Chats that move at the same time start this far apart, at most MAX_MOVING at once (ADR 0353). */
export const STAGGER_MS = 5000;
export const MAX_MOVING = 2;
/** A temporary failure is retried after these waits; then the model is skipped. */
export const RETRY_MS: readonly number[] = [30e3, 60e3, 120e3];

export const LEVEL_NAME: Record<PresetId, string> = { min: 'Minimo', base: 'Base', max: 'Massimo' };

/** A failure the move must not retry on the same model (the engine refuses it, a guard of the chat). */
export class CreditMoveRefused extends Error {}

export interface CreditWaitDeps {
  chats: {
    /** announces the move to `on` at `next.at` (the chat's «Annulla» cancels it), with where from and why */
    creditPlan(chatId: string, next: { card: string; at: number }, on: CardNow, note: MoveNote): void;
    list(): ChatSummary[];
    creditResume(chatId: string, to: { model: string | null; effort: Effort | null }, note: MoveNote): Promise<boolean>;
    creditContinue(chatId: string, on: CardNow, note: MoveNote): Promise<boolean>;
    /** the whole level is out: which models and when the first comes back (written in the chat once per change) */
    creditWaiting(chatId: string, waiting: NonNullable<CreditWait['waiting']>): void;
    /** «Annulla» was pressed: the wait holds until the role's level lists are no longer `key` */
    creditHold(chatId: string, key: string): void;
    /** a move to `card` failed: permanent = skip that model from now on; temporary = retry at `nextAt` */
    creditFailed(chatId: string, f: { card: string; error: string; permanent: boolean; nextAt: number | null; last: boolean }): void;
  };
  /** catalog.cardNow: the level's pick for this chat now (holds the level); throws when no model of it can start */
  card(roleId: string, ask: PresetAsk, o: { asker: string; skip: readonly string[] }): CardNow;
  /** a short key of a role's level lists: «Annulla» holds until it changes */
  levelsKey?(roleId: string): string;
  now?: () => number;
  /** runs the watch again later (the end of a grace, a retry, the next staggered start) */
  later?: (fn: () => void, ms: number) => void;
}

/** What the user reads about a move: from which model, to which, the level and why. */
export interface MoveNote { from: string; to: string; level: string; why: string }

export type CreditMove = ({ do: 'resume'; to: { model: string | null; effort: Effort | null } } | { do: 'continue'; on: CardNow }
  | { do: 'wait'; waiting: NonNullable<CreditWait['waiting']> } | { do: 'later'; at: number }) & { card: string; note: MoveNote };

/** The user stopped the job this chat works for (ADR 0342): its own plan or an ancestor's. */
const stoppedJob = (c: ChatSummary, chatOf: (id: string) => ChatSummary | undefined): boolean => {
  const seen = new Set<string>();
  for (let x: ChatSummary | undefined = c; x && !seen.has(x.id); x = x.parentId ? chatOf(x.parentId) : undefined) {
    seen.add(x.id);
    if (x.plan?.stopped) return true;
  }
  return false;
};

const modelName = (key: string): string => { const i = key.indexOf(':'); const m = key.slice(i + 1); return `${m || 'predefinito'} (${key.slice(0, i)})`; };

/** What the level means now for a chat that waits on its credits; null = nothing to do for it now. */
export function creditMove(c: ChatSummary, chatOf: (id: string) => ChatSummary | undefined, d: Pick<CreditWaitDeps, 'card' | 'levelsKey' | 'now'>): CreditMove | null {
  const w = c.creditWait, role = c.agent?.source === 'catalog' ? c.agent.id : undefined;
  if (!w || !role || c.closedAt || c.continuedBy || c.isOrchestrator) return null;
  // while it works (the user or its parent wrote to it) nothing is switched under it
  if (c.state === 'running' || c.state === 'starting' || c.state === 'waiting' || c.queued) return null;
  // the user stopped its job («Ferma»): it starts nothing until they resume it
  if (stoppedJob(c, chatOf)) return null;
  // «Annulla»: it waits until the role's levels change (or the user writes to it, which ends the wait)
  if (w.stay && (!d.levelsKey || typeof w.stay !== 'string' || d.levelsKey(role) === w.stay)) return null;
  const run = c.run?.presetChoice, preset: PresetId = run?.preset ?? 'base';
  const now = (d.now ?? Date.now)();
  const skip = (w.failed ?? []).filter(f => f.permanent).map(f => f.card);
  let card: CardNow;
  try {
    card = d.card(role, preset === 'base' ? {} : { preset, presetWhy: run?.presetWhy ?? 'the level the chat runs on' }, { asker: c.id, skip });
  } catch { return null; } // no model of the level can start (all engines off): the Agenti page says what is wrong
  const key = creditCardKey(card);
  const from = w.card ?? creditCardKey({ engine: c.harness, model: w.model });
  const level = LEVEL_NAME[card.preset ?? preset];
  const skippedWhy = (card.skipped ?? []).find(s => s.kind === 'credit' && creditCardKey(s) === from)?.why;
  const note: MoveNote = { from: modelName(from), to: modelName(key), level, why: key === from ? 'il suo limite è tornato libero' : skippedWhy ? `${modelName(from)} è finito: ${skippedWhy}` : `${modelName(from)} ha finito il limite` };
  // the whole level is out: wait, never move onto a model with no room; say which and when the first comes back
  if (card.allOut) {
    const out = card.rooms?.length ? card.rooms : [{ engine: card.engine, model: card.model, why: card.route ?? '', until: null }];
    const first = out.map(s => s.until ?? null).filter((x): x is number => x !== null && x > now).sort((a, b) => a - b)[0] ?? null;
    return { do: 'wait', waiting: { out: out.map(s => `${modelName(`${s.engine}:${s.model ?? ""}`)}: ${s.why}`).slice(0, 8), first }, card: key, note };
  }
  // a temporary failure on this model: tried again after its wait
  const failed = (w.failed ?? []).find(f => f.card === key && !f.permanent);
  if (failed?.nextAt && failed.nextAt > now) return { do: 'later', at: failed.nextAt, card: key, note };
  if (card.engine !== c.harness) return { do: 'continue', on: card, card: key, note };
  return { do: 'resume', to: { model: card.model, effort: card.effort }, card: key, note };
}

/** Applies creditMove to every waiting chat; call it at each change that may free one. One move per chat at a time,
 *  staggered, never more than MAX_MOVING at once. */
export function creditWaitWatch(d: CreditWaitDeps): () => void {
  const moving = new Set<string>();
  const now = d.now ?? Date.now, later = d.later ?? ((fn, ms) => { setTimeout(fn, ms).unref?.(); });
  let lastStart = -Infinity, queued = false;
  const again = (ms: number) => { if (queued) return; queued = true; later(() => { queued = false; watch(); }, Math.max(50, ms)); };
  const watch = () => {
    const all = d.chats.list(), byId = new Map(all.map(c => [c.id, c]));
    for (const c of all) {
      if (!c.creditWait || moving.has(c.id)) continue;
      if (c.creditWait.stay === true && d.levelsKey && c.agent?.source === 'catalog') { d.chats.creditHold(c.id, d.levelsKey(c.agent.id)); continue; }
      const move = creditMove(c, id => byId.get(id), d);
      if (!move) continue;
      const w = c.creditWait;
      if (move.do === 'wait') {
        if (JSON.stringify(w.waiting) !== JSON.stringify(move.waiting)) d.chats.creditWaiting(c.id, move.waiting);
        continue;
      }
      if (move.do === 'later') { again(move.at - now() + 50); continue; }
      // the automatic move (ADR 0348): announced first, made when its grace is over and nothing changed meanwhile
      if (w.next?.card !== move.card) {
        d.chats.creditPlan(c.id, { card: move.card, at: now() + GRACE_MS }, move.do === 'resume' ? { engine: c.harness, ...move.to } : move.on, move.note);
        again(GRACE_MS + 50);
        continue;
      }
      if (w.next.at > now()) { again(w.next.at - now() + 50); continue; }
      // staggered starts, a few at a time (ADR 0353: ten chats freed together never start together)
      if (moving.size >= MAX_MOVING || now() - lastStart < STAGGER_MS) { again(Math.max(STAGGER_MS - (now() - lastStart), 500)); continue; }
      lastStart = now();
      moving.add(c.id);
      const done = move.do === 'resume' ? d.chats.creditResume(c.id, move.to, move.note) : d.chats.creditContinue(c.id, move.on, move.note);
      void done.then(ok => { if (ok) log.info('agents', 'chat out of credits goes on in its level', { chat: c.id, data: { how: move.do, card: move.card, level: move.note.level } }); })
        .catch(e => {
          const permanent = e instanceof CreditMoveRefused;
          const tries = (w.failed ?? []).find(f => f.card === move.card)?.n ?? 0;
          const wait = RETRY_MS[tries];
          const last = permanent || wait === undefined;
          log.warn('agents', 'chat out of credits not moved', { chat: c.id, cause: errText(e), hint: last ? 'that model is skipped; the next of the level is tried' : `retried in ${Math.round(wait! / 1000)} s`, data: { card: move.card, tries: tries + 1 } });
          d.chats.creditFailed(c.id, { card: move.card, error: errText(e), permanent: last, nextAt: last ? null : now() + wait!, last });
        })
        .finally(() => { moving.delete(c.id); again(STAGGER_MS); });
    }
  };
  return watch;
}
