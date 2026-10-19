// Feedback and approval-only lifecycle records, shared by the role services and their UI/API adapters.
import type { AgentEvidenceRef, AgentRunOutcome, VersionMetrics } from './agents';
import type { ModelTier } from './roles';

export const DEFINITION_GAPS = ['instructions', 'tools', 'model-effort', 'unclear-goal', 'none'] as const;
export type DefinitionGap = typeof DEFINITION_GAPS[number];
const VERDICTS = ['success', 'partial', 'fail', 'unknown'] as const;
const EVIDENCE_KINDS = ['journal', 'chat', 'ai-error', 'cost', 'run', 'feedback'] as const;

/** The arguments of `agent_child_feedback` (a parent's opinion of its child's run) and of a Judge's review: the ONE shape
 *  the tool's schema, its validation and the lifecycle facade share. `notes` is the free-text opinion (it becomes the
 *  outcome note); worked/failed/gap/gapKey are optional detail the maintenance reads. The role, its version and the
 *  outcome's basis are never arguments: main reads them from the authoritative run and its own evidence checks. */
export interface AgentFeedbackArgs {
  runId: string; verdict: AgentRunOutcome['verdict']; notes: string; evidence: AgentEvidenceRef[];
  worked?: string; failed?: string; gap?: DefinitionGap; gapKey?: string;
  /** also deliver `notes` to the run's chat (still running only) */
  sendToRun?: boolean;
}
export const AGENT_FEEDBACK_REQUIRED = ['runId', 'verdict', 'notes', 'evidence'] as const;
/** Where a runId comes from: agent_children lists each child's run.runId, never a chat id. */
export const RUN_ID_DESCRIPTION = 'The run id (runId) from agent_children, not the chat id: each child lists it as runId (r_ followed by 12 hex digits).';
/** JSON schema of the tool's input, derived from the same limits parseAgentFeedbackArgs enforces. */
export const AGENT_FEEDBACK_SCHEMA = {
  type: 'object', additionalProperties: false, required: [...AGENT_FEEDBACK_REQUIRED],
  properties: {
    runId: { type: 'string', maxLength: 80, description: RUN_ID_DESCRIPTION }, verdict: { type: 'string', enum: [...VERDICTS] },
    notes: { type: 'string', maxLength: 600, description: 'Your opinion of the run: an opinion, never the user\'s confirmation.' },
    evidence: { type: 'array', maxItems: 20, items: { type: 'object', required: ['kind', 'ref', 'at'], properties: { kind: { type: 'string', enum: [...EVIDENCE_KINDS] }, ref: { type: 'string', maxLength: 200 }, at: { type: 'number' } } } },
    worked: { type: 'string', maxLength: 1200 }, failed: { type: 'string', maxLength: 1200 },
    gap: { type: 'string', enum: [...DEFINITION_GAPS], description: 'Which part of the definition fell short, if any.' },
    gapKey: { type: 'string', maxLength: 120, description: 'A short stable name for that gap.' },
    sendToRun: { type: 'boolean' },
  },
} as const;
const obj = (v: unknown, what: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${what}: object required.`);
  return v as Record<string, unknown>;
};
const str = (v: unknown, key: string, max: number, optional = false): string | undefined => {
  if (optional && v === undefined) return undefined;
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`${key}: text required, at most ${max} characters.`);
  return v.trim();
};
/** Evidence references: at most 20, known kinds, a short ref and a finite time. */
export function parseEvidence(value: unknown): AgentEvidenceRef[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error('At most 20 evidence references required.');
  return value.map(v => {
    const e = obj(v, 'evidence');
    if (!EVIDENCE_KINDS.includes(e.kind as never) || typeof e.at !== 'number' || !Number.isFinite(e.at) || e.at < 0) throw new Error('Invalid evidence.');
    return { kind: e.kind as AgentEvidenceRef['kind'], ref: str(e.ref, 'evidence ref', 200)!, at: e.at };
  });
}
/** Strict: any other key (agentId, version, basis, outcome…) is refused, so a caller cannot choose whose record it writes
 *  or how much it counts. */
export function parseAgentFeedbackArgs(value: unknown): AgentFeedbackArgs {
  const a = obj(value, 'feedback');
  const extra = Object.keys(a).filter(k => !(k in AGENT_FEEDBACK_SCHEMA.properties));
  if (extra.length) throw new Error(`feedback: unknown argument ${extra.join(', ')} (role, version and basis come from the run).`);
  if (!VERDICTS.includes(a.verdict as never)) throw new Error('Invalid verdict.');
  if (a.gap !== undefined && !DEFINITION_GAPS.includes(a.gap as never)) throw new Error('Invalid gap.');
  if (a.gapKey !== undefined && a.gap === undefined) throw new Error('gapKey needs gap.');
  if (a.sendToRun !== undefined && typeof a.sendToRun !== 'boolean') throw new Error('Invalid sendToRun.');
  const worked = str(a.worked, 'worked', 1200, true), failed = str(a.failed, 'failed', 1200, true), gapKey = str(a.gapKey, 'gapKey', 120, true);
  return {
    runId: str(a.runId, 'runId', 80)!, verdict: a.verdict as AgentFeedbackArgs['verdict'], notes: str(a.notes, 'notes', 600)!, evidence: parseEvidence(a.evidence),
    ...(worked !== undefined ? { worked } : {}), ...(failed !== undefined ? { failed } : {}),
    ...(a.gap !== undefined ? { gap: a.gap as DefinitionGap } : {}), ...(gapKey !== undefined ? { gapKey } : {}),
    ...(a.sendToRun !== undefined ? { sendToRun: a.sendToRun } : {}),
  };
}
/** One stored feedback record (agents/run-feedback.ts). agent/run/version come from the run, the outcome's
 *  basis from main's evidence check; version and the gap detail are absent on records written before they existed. */
export interface AgentFeedback {
  id: string; at: number; agentId: string; runId: string; outcome: AgentRunOutcome; evidence: AgentEvidenceRef[];
  version?: number; worked?: string; failed?: string; gap?: DefinitionGap; gapKey?: string;
}
export interface TrialEvaluation {
  decision: 'wait' | 'keep' | 'revert'; reason: string; at: number;
  before: VersionMetrics | null; after: VersionMetrics | null; other: VersionMetrics | null;
  comparable: number; otherRuns: number; untagged: number;
}
/**
 * One entry of the "Da approvare" queue: what changes a role's reach or cost waits for the user (ADR 0083). Nothing in it
 * is applied before the user's agents:lifecycleDecide:
 * - key `trial:<roleId>:<version>`, kind keep | revert: approve = end the trial that way (resolveTrial keep | rollback);
 * - kind tier: approve = a trial version of the role on `tier` (raising its tierMax when needed), measured like any trial;
 * - dismiss (any) = drop it; the same key is not proposed again for a while (trials 7 days, tiers 14).
 * Role text and skills never queue here: the maintenance applies them at once with an Annulla.
 */
export interface AgentLifecycleProposal {
  key: string; kind: 'tier' | 'keep' | 'revert';
  agentIds: string[]; reason: string; evidence: AgentEvidenceRef[]; at: number;
  state: 'pending'; metrics?: { before: VersionMetrics | null; after: VersionMetrics | null };
  /** tier: the tier the trial would use; `skills` = the skill set (sorted) the evidence is about */
  tier?: ModelTier; skills?: string[];
}
export type AgentLifecycleDecision = 'approve' | 'dismiss';
export interface AgentLifecycleDecide { key: string; decision: AgentLifecycleDecision }
/** Read model for the approval panel. Transport is supplied by the typed IPC integration. */
export interface AgentLifecycleSnapshot {
  proposals: AgentLifecycleProposal[];
  evaluations: { agentId: string; version: number; result: TrialEvaluation }[];
  feedback: AgentFeedback[];
  problem: string | null;
}
export interface AgentLifecycleQuery { agentId?: string }
export interface AgentLifecycleClient {
  read(query: AgentLifecycleQuery): Promise<AgentLifecycleSnapshot>;
}
export const AGENT_LIFECYCLE_PATH = '/api/agents/lifecycle';
