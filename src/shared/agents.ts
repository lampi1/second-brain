import type { Effort, Harness } from './contract';

export const AGENT_SYMBOLS = ['briefcase', 'search', 'pen', 'chart', 'compass', 'code', 'spark'] as const;
export type AgentSymbol = (typeof AGENT_SYMBOLS)[number];
/** Raster data only. Main validates bytes, decoding and dimensions before persistence. */
export type AgentAvatar = { kind: 'symbol'; value: AgentSymbol } | { kind: 'image'; dataUrl: string };
export interface AgentDraft {
  name: string;
  purpose: string;
  instructions: string;
  engine: Harness;
  /** null = the engine's own default, explicitly unknown until reported by the session. */
  model: string | null;
  effort?: Effort;
  avatar: AgentAvatar;
}
export interface AgentProfile extends AgentDraft { id: string; createdAt: number; updatedAt: number }
/** Frozen when a chat starts; editing the catalog never relabels existing sessions. */
export interface AgentOwnerSnapshot {
  id: string; name: string; purpose: string; avatar: AgentAvatar;
  engine: Harness; model: string | null; revision: number;
  source: 'catalog' | 'legacy' | 'routed';
}
export interface AgentModelChoice {
  engine: Harness; label: string; enabled: boolean; trusted: boolean; effort: boolean;
  models: { id: string; name: string }[];
  source: 'observed' | 'registry' | 'unknown';
  /** Model discovery does not prove installation or login. */
  installed: boolean | null; authenticated: boolean | null;
  defaultModel: boolean;
  /** Known models do not imply the adapter can select them. */
  modelSelectable: boolean;
  modelReason: string | null;
}
export interface AgentCatalog {
  profiles: AgentProfile[];
  models: AgentModelChoice[];
  problem: string | null;
  legacyRouting: { preserved: true; imported: number; remaining: number };
  builder: { available: boolean; engine: string | null; models: string[]; reason: string | null };
  imageGeneration: { available: false; reason: string };
}
export interface AgentDraftRequest { text: string; engine: Harness; model: string; base?: AgentDraft }
export type AgentDraftResult = { ok: true; draft: AgentDraft } | { ok: false; reason: string };

export type SetupGuide = { stage: 'choosing' | 'fallback' } | { stage: 'connecting' | 'guided'; engine: 'claude' | 'codex' | 'kimi' | 'cursor'; chatId: string };
export interface SetupDraft {
  step: number;
  work: '' | 'employee' | 'independent' | 'other';
  goals: string;
  tools: string;
  style: 'balanced' | 'concise' | 'detailed';
  agentIds: string[];
  guide?: SetupGuide;
}
export interface SetupState {
  version: 1;
  status: 'new' | 'existing' | 'draft' | 'completed' | 'skipped';
  preferences: SetupDraft;
  updatedAt: number;
}

export type ChildState = 'running' | 'waiting' | 'completed' | 'failed' | 'stopped' | 'unknown';
/** A provider observation, never a fabricated native id or a count of arbitrary tool calls. */
export interface ChildObservation {
  key: string;
  nativeId: string | null;
  toolCallId: string | null;
  parentNativeId: string | null;
  kind: 'agent' | 'shell' | 'unknown';
  state: ChildState;
  task: string | null;
  observedAt: number;
  source: 'live' | 'replay';
}
export interface AgentChildren {
  coverage: 'unknown' | 'partial' | 'complete';
  /** Counts of observed provider agents. null = an actual active/total census is unavailable. */
  active: number | null;
  total: number | null;
  observedActive: number;
  observedTotal: number;
  observedAt: number;
  children: ChildObservation[];
}
