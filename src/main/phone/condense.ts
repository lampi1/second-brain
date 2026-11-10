// The condenser of what goes to the phone (design §6): deterministic, no tokens. The text is filtered first (filter.ts),
// then cut to ~600 characters at a sentence boundary (or a space, never inside a "[…]" placeholder) with
// "… Continua sul PC". An Orchestrator reply that is the per-agent recap (app_agents_recap, ADR 0260) gets up to
// RECAP_MAX instead: the owner reads every agent from the phone (2026-11-10). Used by bridge.ts (Orchestrator replies,
// questions, urgent notices) and backlog.ts; tests: test/unit/phone/condense.test.ts.
import { filterOutgoing } from './filter';
import { isAgentsRecap } from '../appctl/agents-recap';

export const CONDENSE_MAX = 600;
export const MORE = '… Continua sul PC';
/** the room an agents recap gets on the phone (a Telegram message holds 4,096) */
export const RECAP_MAX = 2_400;

export function condense(text: string, max = CONDENSE_MAX): string {
  const t = filterOutgoing(text);
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  let cut = -1;
  for (const m of head.matchAll(/[.!?](?=\s)|\n/g)) cut = m.index + (m[0] === '\n' ? 0 : 1);
  if (cut < max / 2) cut = head.lastIndexOf(' ');
  if (cut < max / 2) cut = max;
  // never inside a placeholder: back to its "["
  const open = head.lastIndexOf('[', cut - 1);
  const close = open >= 0 ? t.indexOf(']', open) : -1;
  if (open > 0 && close >= cut) cut = open;
  return `${t.slice(0, cut).trimEnd()}\n${MORE}`;
}

/** An Orchestrator reply for the phone: the agents recap gets RECAP_MAX, any other reply CONDENSE_MAX. */
export const condenseReply = (text: string): string => condense(text, isAgentsRecap(text) ? RECAP_MAX : CONDENSE_MAX);
