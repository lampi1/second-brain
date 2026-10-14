// Which engines may start, and what an agent may do with chats on an engine (ADR 0046). Why: the user, 2026-10-14,
// "voglio solo configurare se si possono aprire chat cross cli/api": one module holds the rule instead of per-engine
// checks in every tool. Three switches, all protected (only the user changes them):
// - `engineOn.<id>` «X acceso»: off = nothing starts on that engine, whoever asks (the user's own chats too);
// - `engines.<id>` «Le Regie possono usare X»: off = no agent opens or resumes a chat there (the user still can);
// - `messaging.crossHarness` «Chat tra motori diversi»: off = an agent opens, resumes and writes only to chats on its
//   own engine (mirrored in the brain's brain-settings.json for inbox.mjs).
// The saved keys of the last two are the ones older releases read, with the same meaning, so a rollback never opens
// what the user had closed. Absent = off: an engine the saved file does not name never starts by itself; nor does one
// whose start definition changed since the user turned it on (registry.ts trusted).
// Used by the app-control tools (appctl/tools.ts), the chats' mail (chats/mail.ts), the routed chats (chats/routed.ts)
// and the chat manager's gates (chats/manager.ts, wired in wiring.ts).
import type { Harness, Settings } from '../../shared/contract';
import { engineLabel, engineOf } from './registry';

export type EngineSwitches = Pick<Settings, 'engineOn' | 'engines' | 'messaging'>;

/** Is the engine switched on (may anything start on it)? On, and its definition the one the user turned on (trust.ts). */
export const engineOn = (s: Pick<Settings, 'engineOn'>, h: Harness): boolean => s.engineOn[h] === true && engineOf(h)?.trusted === true;

/** May an agent open or resume a chat on this engine at all (on, and «Le Regie possono usare X» on)? */
export const agentsMayOpen = (s: Pick<Settings, 'engineOn' | 'engines'>, h: Harness): boolean => engineOn(s, h) && s.engines[h] === true;

/** An agent's message to a stopped chat on an engine the Regie may not use (chats/manager.ts): the chat stays stopped
 *  and the mail waits for the user to resume it (chats/mail.ts holds it without a warning). */
export class AgentMayNotWake extends Error {
  constructor(h: Harness) {
    const name = engineLabel(h);
    super(`La chat è ferma e le Regie non possono usare ${name} (impostazione «Le Regie possono usare ${name}»): un agente non la riavvia.`);
  }
}

/** Why a chat on `from` may not reach a chat on `to` (open, resume or write) across engines; null = it may. */
export function crossRefusal(s: Pick<Settings, 'messaging'>, from: Harness, to: Harness): string | null {
  if (from === to || s.messaging.crossHarness) return null;
  return 'le chat tra motori diversi sono spente (impostazione «Chat tra motori diversi»)';
}

/** Why an agent on `from` may not open or resume a chat on `to`; null = it may. */
export function openRefusal(s: EngineSwitches, from: Harness, to: Harness): string | null {
  const name = engineLabel(to);
  if (!engineOn(s, to)) return `${name} è spento nelle impostazioni`;
  if (s.engines[to] !== true) return `le Regie non possono usare ${name} (impostazione «Le Regie possono usare ${name}»)`;
  return crossRefusal(s, from, to);
}
