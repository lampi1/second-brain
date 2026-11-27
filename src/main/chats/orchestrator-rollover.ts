// When the Orchestrator's engine starts a fresh context (ADR 0369). An ACP engine (Antigravity, OpenCode, Cursor) has
// no compaction: every call re-reads the whole session, so a long day of mixed topics made each turn re-read hundreds
// of thousands of tokens. Before the user's message the chat manager asks rolloverDue: past the budget, or on a switch
// to another topic past a smaller threshold, the session ends and a new one starts seeded with the per-topic brief
// (agents/orchestrator-brief.ts), like Claude's compaction does inside its own engine. Claude keeps its own
// compaction (compactWindowTokens, the day compaction: continuity.ts) and gets the brief whenever its context starts
// again; Codex and the API engines are not rolled. Pure; the manager's side is manager-topics.ts
// orchestratorRollover. Unit tests: test/unit/chats/orchestrator-rollover.test.ts.

/** The thresholds of one kind of engine, in context tokens; null = never rolled by the app. */
export interface RolloverPolicy { budget: number; topicSwitch: number }
export const ROLLOVER_POLICY: Readonly<Record<string, RolloverPolicy | null>> = {
  acp: { budget: 60_000, topicSwitch: 30_000 },
  claude: null,
  codex: null,
  api: null,
};

/** What the rule reads of the Orchestrator right before the user's message goes. */
export interface RolloverView {
  /** the engine's kind (engines/registry.ts) */
  kind: string;
  /** the context the engine reported (or estimated) after its last turn; 0 = unknown */
  contextTokens: number;
  /** the new message's topic is not the one of the session's last message */
  topicChanged: boolean;
  /** nothing in flight: no turn running, no question or permission open, no app turn, no switch already going */
  idle: boolean;
  /** Remote Control on: the session is shared with claude.ai and never replaced by the app */
  remote?: boolean;
}

/** budget = the context passed its budget; topic = another topic past the smaller threshold; null = go on. */
export function rolloverDue(v: RolloverView, policy: RolloverPolicy | null = ROLLOVER_POLICY[v.kind] ?? null): 'budget' | 'topic' | null {
  if (!policy || !v.idle || v.remote || !Number.isFinite(v.contextTokens) || v.contextTokens <= 0) return null;
  if (v.contextTokens >= policy.budget) return 'budget';
  if (v.topicChanged && v.contextTokens >= policy.topicSwitch) return 'topic';
  return null;
}

/** The note the fresh session's first message carries above the brief (the role text goes again before it). */
export const ROLLOVER_NOTE = '[app · this conversation goes on in a fresh engine session: the earlier history is not loaded. The topic context below is what you need; read app_chats or app_chat_items for anything else. Do not mention the switch to the user.]';
