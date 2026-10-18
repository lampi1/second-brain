// Durable per-agent feedback, independent of run pruning. Called by authenticated Orchestrator API adapters.
// Opinions are always labelled as such and never mutate an execution's outcome.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentRun } from '../../shared/agents';
import type { AgentFeedback, AgentLifecycleProposal } from '../../shared/agent-lifecycle';
import { readLocal, writeLocal } from './local-store';

export const FEEDBACK_PER_AGENT = 200;
const gaps = ['instructions', 'tools', 'model-effort', 'unclear-goal', 'none'];
const bounded = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
export function validFeedback(v: unknown): v is AgentFeedback {
  const f = v as AgentFeedback | null;
  return !!f && bounded(f.id, 80) && !!f.id && /^[a-z][a-z0-9_-]{0,79}$/.test(f.agentId) && /^r_[a-f0-9]{12}$/.test(f.runId)
    && Number.isSafeInteger(f.version) && f.version > 0 && Number.isFinite(f.at) && f.at >= 0
    && ['success', 'partial', 'fail', 'unknown'].includes(f.verdict) && f.basis === 'orchestrator-opinion'
    && gaps.includes(f.gap) && bounded(f.gapKey, 120) && bounded(f.worked, 1200) && bounded(f.failed, 1200)
    && Array.isArray(f.evidence) && f.evidence.length > 0 && f.evidence.length <= 16
    && f.evidence.every(e => e && ['journal', 'chat', 'ai-error', 'cost', 'run', 'feedback'].includes(e.kind) && bounded(e.ref, 240) && !!e.ref && Number.isFinite(e.at));
}
export type FeedbackInput = Pick<AgentFeedback, 'verdict' | 'worked' | 'failed' | 'gap' | 'gapKey' | 'evidence'>;
export class AgentFeedbackStore {
  private readonly file: string;
  private entries: AgentFeedback[] = [];
  problem: string | null = null;
  constructor(userData: string) {
    this.file = path.join(userData, 'agent-feedback.json');
    try {
      const raw = readLocal(this.file) as { version: number; entries: unknown[] } | undefined;
      if (raw === undefined) return;
      if (raw.version !== 1 || !Array.isArray(raw.entries) || !raw.entries.every(validFeedback)) throw Error('Invalid feedback');
      const counts = new Map<string, number>(), ids = new Set<string>();
      for (const f of raw.entries) {
        const key = `${f.agentId}/${f.runId}`;
        if (ids.has(key)) throw Error('Duplicate feedback');
        ids.add(key); counts.set(f.agentId, (counts.get(f.agentId) ?? 0) + 1);
      }
      if ([...counts.values()].some(n => n > FEEDBACK_PER_AGENT)) throw Error('Feedback cap exceeded');
      this.entries = raw.entries;
    } catch { this.problem = 'Registro feedback non leggibile: originale conservato.'; }
  }
  list(agentId: string): AgentFeedback[] { return structuredClone(this.entries.filter(f => f.agentId === agentId)); }
  add(run: AgentRun, input: FeedbackInput, at = Date.now()): AgentFeedback {
    if (this.problem) throw Error(this.problem);
    const feedback: AgentFeedback = { ...structuredClone(input), id: randomUUID(), agentId: run.agentId, runId: run.runId,
      version: run.version, at, basis: 'orchestrator-opinion' };
    if (!validFeedback(feedback)) throw Error('Feedback non valido');
    const old = this.entries.find(f => f.agentId === run.agentId && f.runId === run.runId);
    if (old) feedback.id = old.id;
    const own = this.entries.filter(f => f.agentId === run.agentId && f.runId !== run.runId);
    const next = [...this.entries.filter(f => f.agentId !== run.agentId), ...own.slice(-(FEEDBACK_PER_AGENT - 1)), feedback];
    writeLocal(this.file, { version: 1, entries: next });
    this.entries = next;
    return structuredClone(feedback);
  }
}
/** Distinct runs, same version and normalized gap key. Unclear goals are explicitly not definition defects. */
export function repeatedGap(entries: readonly AgentFeedback[]): AgentLifecycleProposal | null {
  const latest = entries.at(-1);
  if (!latest || !latest.gapKey.trim() || ['none', 'unclear-goal'].includes(latest.gap)) return null;
  const normalize = (s: string) => s.trim().toLocaleLowerCase('en');
  const same = entries.slice(-10).filter(f => f.agentId === latest.agentId && f.version === latest.version
    && f.gap === latest.gap && normalize(f.gapKey) === normalize(latest.gapKey));
  if (new Set(same.map(f => f.runId)).size < 2) return null;
  return { key: `gap:${latest.agentId}:${latest.version}:${latest.gap}:${normalize(latest.gapKey)}`, kind: 'update',
    agentIds: [latest.agentId], reason: `Lacuna ripetuta: ${latest.gapKey}`, state: 'pending', at: latest.at,
    evidence: same.map(f => ({ kind: 'feedback', ref: f.id, at: f.at })) };
}
