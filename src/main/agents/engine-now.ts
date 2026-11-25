// The engine a chat's role starts on NOW (ADR 0360): the one order, the thresholds and the limits as they are at this
// moment, at the level the chat runs on. A running chat never changes engine by itself: this is read only when it is used
// again («Riprendi», a reuse), and another engine goes on in a linked chat. Null = the engine it has: no engine order
// (then a reuse stays on its engine while that one can run, ADR 0352), a chat with no role, the Orchestrator, a model the
// user asked for that very work, a level with no room left anywhere (the chat waits on its own, ADR 0354) and an order that
// gives the same engine. Throws when no engine of the level can start. startElsewhere: a chat whose engine did not start
// (ChatManager startFailed), order or not. Used by wiring.ts; tests in test/unit/agents/engine-order-chats.test.ts.
import type { ChatSummary, Effort, Harness } from '../../shared/contract';
import { USER_ASKED, type PresetAsk } from '../../shared/model-presets';
import type { CardNow } from './credit-wait';

export interface EngineNow { harness: Harness; model: string | null; effort: Effort | null; route?: string }
export interface EngineNowDeps {
  cardNow(roleId: string, ask: PresetAsk, o: { asker: string }): CardNow;
  /** an engine order (everybody's or the role's own) decides where the role starts */
  ordered(roleId: string): boolean;
}

function cardOf(c: ChatSummary, d: EngineNowDeps): CardNow | null {
  const role = c.agent?.source === 'catalog' ? c.agent.id : undefined, run = c.run?.presetChoice;
  if (!role || c.isOrchestrator || run?.route?.endsWith(USER_ASKED)) return null;
  const preset = run?.preset ?? 'base';
  const now = d.cardNow(role, preset === 'base' ? {} : { preset, presetWhy: run?.presetWhy ?? 'the preset the chat runs on' }, { asker: c.id });
  return now.engine === c.harness || now.allOut ? null : now;
}

export function engineNowOf(c: ChatSummary, d: EngineNowDeps): EngineNow | null {
  if (c.agent?.source !== 'catalog' || !d.ordered(c.agent.id)) return null;
  const now = cardOf(c, d);
  return now && { harness: now.engine, model: now.model, effort: now.effort, ...(now.route ? { route: now.route } : {}) };
}

/** Whether a chat whose engine did not start has another engine of its level to go on with now. */
export function startElsewhere(c: ChatSummary, d: EngineNowDeps): boolean {
  try { return cardOf(c, d) !== null; } catch { return false; }
}
