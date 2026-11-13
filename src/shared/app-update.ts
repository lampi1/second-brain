// Renderer/main contract for the single prepared-update pipeline and private local restart recovery.
// Main owns release identity, download paths and activation; the renderer contributes only allowlisted UI state.
export const UPDATE_CHECKPOINT_MAX_BYTES = 8_000_000;
export const UPDATE_SNAPSHOT_KEYS = ['sb.prefs.v1', 'sb.read.v1', 'sb.agents.workspace.v1', 'sb.update.chat-drafts.v1', 'sb.update.agent-drafts.v1'] as const;
export type UpdateSnapshot = Record<(typeof UPDATE_SNAPSHOT_KEYS)[number], string>;
export interface UpdateCheckpointRequest { requestId: string; maxBytes: number }
export type UpdateCheckpointAnswer = { requestId: string; snapshot: UpdateSnapshot } | { requestId: string; problem: string };
export interface UpdateRecovery { id: string; snapshot: UpdateSnapshot }
export interface PreparedAppUpdate {
  id: string; version: string; changes: string[];
  phase: 'preparing' | 'ready' | 'applying' | 'applied' | 'failed' | 'restored';
  blocked: string | null;
}
export interface AppUpdateState {
  available: boolean; reason?: string; checking: boolean; checkedAt: number | null;
  update: PreparedAppUpdate | null;
}
