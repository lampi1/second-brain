// Battito's renderer/main contract (ADR 0070): cards, explicit approvals and shared job budgets.
// These are data only; main validates all references and owns every action.
export type PulseType = 'idea' | 'consiglio' | 'promemoria' | 'collegamento' | 'curiosita' | 'agente';
export interface PulseSettings {
  on: boolean; dailyUsd: number; slots: string[]; headline: { on: boolean };
  types: Record<PulseType, boolean>; places: Record<'board' | 'agent' | 'search' | 'file', boolean>;
}
export type PulsePlace = 'board' | 'search' | `agent:${string}` | `file:${string}`;
export type PulseCostBasis = 'reported' | 'estimated' | 'unknown';
export type PulseDismissReason = 'irrilevante' | 'gia-noto' | 'sbagliato' | 'troppo-spesso';
export interface PulseRef {
  kind: 'now' | 'idea' | 'journal' | 'ai-error' | 'agent' | 'chat' | 'file';
  ref: string;
}
export interface PulseCard {
  id: string; type: PulseType; title: string; body: string; why: string;
  refs: PulseRef[]; places: PulsePlace[];
  action?: { kind: 'chat'; agentHint?: string; prompt: string };
  runId: string; engine: string | null; source: 'model' | 'builtin' | 'demo';
  createdAt: number; expiresAt: number; key: string;
  state: 'new' | 'seen' | 'saved' | 'acted' | 'dismissed' | 'expired';
  dismissReason?: PulseDismissReason;
}
export interface PulseJobBudget {
  runs: number; usd: number; limitUsd: number; maxRuns: number; basis: PulseCostBasis;
}
export interface PulseBudget {
  date: string; runs: number; usd: number; limitUsd: number; basis: PulseCostBasis;
  jobs: { pulse: PulseJobBudget; headline: PulseJobBudget };
}
export interface PulseStatus {
  on: boolean; engine: string | null; reason?: string; nextSlot: number | null;
  running: boolean; today: PulseBudget;
  lastRun?: { at: number; result: string; engine: string | null };
  canSave: boolean; saveReason?: string;
  engines: { id: string; available: boolean; reason?: string }[];
}
export interface PulseList { cards: PulseCard[]; status: PulseStatus }
export type PulseResult = { ok: true } | { ok: false; error: string };
export type PulseActResult = { ok: true; chatId: string } | { ok: false; error: string };
/** Pending changes never expire or apply automatically. Evidence is plain text / card IDs. */
export interface ApprovalItem {
  id: string; kind: 'learned-rule' | 'maintenance';
  agentId: string; title: string; text: string; evidence: string[];
  engine: string | null; createdAt: number;
  state: 'pending' | 'approved' | 'discarded';
}
export interface ApprovalDecision { id: string; decision: 'approve' | 'edit' | 'discard'; text?: string }
