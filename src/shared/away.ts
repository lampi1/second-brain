// «Modalità notte» (ADR 0191; the owner, 2026-10-29: «una modalità in cui non faccia domande e prosegua tutta la notte
// finché non ci sono ... ogni agente sappia che io sono afk e deve andare avanti con i consigliati»). The words the
// agents get while the user is away, the line that tells them the user is back, and the one pure choice the app makes for a
// question nobody will answer: the option marked recommended. Used by main/chats/manager.ts (turn hint, questions,
// permissions, plans), main/workflows/tools.ts (proposals) and main/chats/away-log.ts (the recap). Pinned by
// test/unit/away.test.ts.
import type { Question } from './contract';
import { yesNoOf } from './yes-no';

/** Rides on each turn of every chat while the mode is on (ChatManager.deliverNow), after the role text. */
export const AWAY_RULE = '[Modalità notte · the user is away (AFK) until they turn it off: ask no questions and wait for no one. Decide yourself with the option you would recommend, write the choice in one line, and keep working until the whole job is done (delegate, verify, report). The app answers any question you still ask with its recommended option. Never by yourself: production actions, secrets, settings/hooks/permissions, messages to people or external services: leave each one ready, note it in your report for the user\'s return, and go on with everything else.]';

/** Sent once to a chat that was told the user was away, with its next turn after the mode went off. */
export const AWAY_BACK = '[Modalità notte off · the user is back: genuine decisions go to them again as yes/no questions.]';

/** What a permission request gets while the user is away: refused, kept for the recap; the chat goes on. */
export const AWAY_PARKED = 'Not granted: the user is away (Modalità notte) and the app never grants a permission by itself. It is noted for the user\'s return. Do not ask again: go on with every part that does not need it, and list it in your report as waiting for the user.';

/** What the Strategist's plan_propose returns when the app approved the plan for the absent user. */
export const AWAY_PLAN_NOTE = 'The user is away (Modalità notte): the app approved this plan as proposed, as its recommended choice. Start it now (agent_delegate the steps, plan_update as they move) and keep going until it is done; do not wait for an answer.';

const MARK = /\((consigliat[oa]|recommended|empfohlen)\)/i;

/** The option the app picks for an absent user: the one marked «(consigliato)», else a «Sì», else the first (the
 *  question rule asks the agent to mark the option that moves the work forward, and to list it first). */
export function recommendedOption(q: Pick<Question, 'options'>): string | null {
  const opts = q.options.filter(o => typeof o.label === 'string' && o.label.trim());
  return (opts.find(o => MARK.test(o.label)) ?? opts.find(o => yesNoOf(o.label) === 'yes') ?? opts[0])?.label ?? null;
}

/** The answers to a whole request, keyed by question text as the user's own answer is; null when a question has no
 *  option at all (it stays for the user). */
export function recommendedAnswers(qs: readonly Question[]): Record<string, string | string[]> | null {
  if (!qs.length) return null;
  const out: Record<string, string | string[]> = {};
  for (const q of qs) {
    const pick = recommendedOption(q);
    if (pick === null) return null;
    out[q.question] = q.multiSelect ? [pick] : pick;
  }
  return out;
}
