// Which engines may start, and what an agent may do with chats on an engine (ADR 0046). Why: the user, 2026-10-14,
// "voglio solo configurare se si possono aprire chat cross cli/api": one module holds the rule instead of per-engine
// checks in every tool. Three switches, all protected (only the user changes them):
// - `engineOn.<id>` «X acceso»: off = nothing starts on that engine, whoever asks (the user's own chats too);
// - `engines.<id>` «Le Regie possono usare X»: off = no agent opens or resumes a chat there (the user still can);
// Cross-engine messaging is always available. The retired messaging.crossHarness value is compatibility data only.
// Engine availability, trust and agent launch permissions still apply; an unknown engine never starts by itself.
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
    super(`La chat è ferma e gli Orchestrator non possono usare ${name} (impostazione «Gli Orchestrator possono usare ${name}»): un agente non la riavvia.`);
  }
}

/** Compatibility for existing callers: legacy false values never block chat-to-chat transport. */
export function crossRefusal(_s: Pick<Settings, 'messaging'>, _from: Harness, _to: Harness): string | null {
  return null;
}

/** Why an agent on `from` may not open or resume a chat on `to`; null = it may. */
export function openRefusal(s: EngineSwitches, _from: Harness, to: Harness): string | null {
  const name = engineLabel(to);
  if (!engineOn(s, to)) return `${name} è spento nelle impostazioni`;
  if (s.engines[to] !== true) return `gli Orchestrator non possono usare ${name} (impostazione «Gli Orchestrator possono usare ${name}»)`;
  return null;
}
