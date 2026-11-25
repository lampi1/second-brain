// The engine a chat's role starts on NOW (ADR 0357): the one order, the thresholds and the limits as they are at this
// moment, at the level the chat runs on. A running chat never changes engine by itself: this is read only when it is used
// again («Riprendi», a reuse), and another engine goes on in a linked chat. Null = the engine it has: a chat with no role,
// the Orchestrator, a model the user asked for that very work, and an order that gives the same engine. Throws when
// nothing may start (every plan spent). Used by wiring.ts (ChatManager engineNow); tests in
// test/unit/agents/engine-order-chats.test.ts.
import type { ChatSummary, Effort, Harness } from '../../shared/contract';
import { USER_ASKED, type Delegator, type PresetAsk } from '../../shared/model-presets';

export interface EngineNow { harness: Harness; model: string | null; effort: Effort | null; route?: string }

export function engineNowOf(c: ChatSummary, d: {
  cardNow(roleId: string, ask: PresetAsk, delegator?: Delegator): { engine: Harness; model: string | null; effort: Effort | null; route?: string };
  chat(id: string): ChatSummary | undefined;
}): EngineNow | null {
  const role = c.agent?.source === 'catalog' ? c.agent.id : undefined, run = c.run?.presetChoice;
  if (!role || c.isOrchestrator || run?.route?.endsWith(USER_ASKED)) return null;
  const preset = run?.preset ?? 'base', parent = c.parentId ? d.chat(c.parentId) : undefined;
  const now = d.cardNow(role, preset === 'base' ? {} : { preset, presetWhy: run?.presetWhy ?? 'the preset the chat runs on' },
    parent ? { ...(parent.agent?.id ? { role: parent.agent.id } : {}), model: parent.model } : undefined);
  return now.engine === c.harness ? null : { harness: now.engine, model: now.model, effort: now.effort, ...(now.route ? { route: now.route } : {}) };
}
