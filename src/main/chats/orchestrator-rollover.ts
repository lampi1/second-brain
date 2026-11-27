// When the Orchestrator's engine starts a fresh context (ADR 0369). An ACP engine (Antigravity, OpenCode, Cursor) has
// no compaction: every call re-reads the whole session, so a long day of mixed topics made each turn re-read hundreds
// of thousands of tokens. Before the user's message the chat manager asks rolloverDue: past the budget, or on a sure
// switch to another topic past a smaller size, and grown enough since it started for a fresh one to help, the session ends and a new one starts seeded with the per-topic brief
// (agents/orchestrator-brief.ts), like Claude's compaction does inside its own engine. Claude keeps its own
// compaction (compactWindowTokens, the day compaction: continuity.ts) and gets the brief whenever its context starts
// again; Codex and the API engines are not rolled. Pure; the manager's side is manager-topics.ts
// orchestratorRollover. Unit tests: test/unit/chats/orchestrator-rollover.test.ts.

/** The thresholds of one kind of engine, in context tokens: the budget, the smaller size a sure topic switch rolls
 *  at, the growth since the session's first turn a rollover must shed at least (a fresh session already large never
 *  rolls for its size alone), and the user's messages a fresh session takes before it rolls again; null = never
 *  rolled by the app. */
export interface RolloverPolicy { budget: number; topicSwitch: number; minGrowth: number; minTurns: number }
export const ROLLOVER_POLICY: Readonly<Record<string, RolloverPolicy | null>> = {
  acp: { budget: 60_000, topicSwitch: 30_000, minGrowth: 10_000, minTurns: 3 },
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
  /** the context the session reported after its first turn (what a fresh session costs anyway: the role text, the
   *  brief, the engine's own tools); 0 or absent = unknown (a session the app did not start, a restart) */
  baseTokens?: number;
  /** the user's messages into the session since a rollover started it; absent = unknown (no minimum then) */
  turns?: number;
  /** the new message is surely on another topic than the session's last message (never a guess: the caller leaves
   *  out the rules' unsure choices and the answers to another chat's question) */
  topicChanged: boolean;
  /** nothing in flight: no turn running, no question or permission open, no app turn, no switch already going */
  idle: boolean;
  /** Remote Control on: the session is shared with claude.ai and never replaced by the app */
  remote?: boolean;
}

/** budget = the context passed its budget; topic = a sure switch to another topic past the smaller size; null = go on.
 *  Either only once the session grew by minGrowth since its first turn (its baseline: what a fresh one costs anyway),
 *  and a session the app just rolled into takes `minTurns` messages first. */
export function rolloverDue(v: RolloverView, policy: RolloverPolicy | null = ROLLOVER_POLICY[v.kind] ?? null): 'budget' | 'topic' | null {
  if (!policy || !v.idle || v.remote || !Number.isFinite(v.contextTokens) || v.contextTokens <= 0) return null;
  if (v.turns !== undefined && v.turns < policy.minTurns) return null;
  const base = v.baseTokens !== undefined && Number.isFinite(v.baseTokens) && v.baseTokens > 0 ? v.baseTokens : 0;
  const grown = v.contextTokens - base;
  if (grown < policy.minGrowth) return null;
  if (v.contextTokens >= policy.budget) return 'budget';
  if (v.topicChanged && v.contextTokens >= policy.topicSwitch) return 'topic';
  return null;
}

/** The note the fresh session's first message carries above the brief (the role text goes again before it). */
export const ROLLOVER_NOTE = '[app · this conversation goes on in a fresh engine session: the earlier history is not loaded. The topic context below is what you need; read app_chats or app_chat_items for anything else. Do not mention the switch to the user.]';
