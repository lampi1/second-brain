// The verdicts on role runs that are not the user's own: a parent's opinion of its child's run (agent_child_feedback,
// agents/child-feedback.ts) and a Judge's review (the judge-sample job, brainmodel/jobs.ts). One store,
// <userData>/run-feedback.json; the run's outcome takes the verdict unless the user already gave one, and an opinion
// never overwrites a reviewed verdict. It counts as reviewed evidence only when it cites an ended Judge run of that run
// whose own report says verified, on a model other than the run's (ADR 0083). Also the user's Annulla on a change the
// app applied (agents:undo) and agent_metrics, the numbers-only tool of the Orchestrator. Used by wiring.ts, loop.ts,
// index.ts.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentProfile, AgentRun, AgentRunOutcome, AgentUndo } from '../../shared/agents';
import { DEFINITION_GAPS, parseEvidence, type AgentFeedback, type AgentFeedbackArgs } from '../../shared/agent-lifecycle';
import type { ToolDef } from '../appctl/tools';
import type { RawEvent } from '../brain/live';
import type { AgentCatalogService } from './catalog';
import { unknownRunError, type AgentRunStore } from './runs';
import { runMetrics } from './run-metrics';
import { readLocal, writeLocal } from './local-store';
import { log, errText } from '../log';

interface Store { version: 1; feedback: AgentFeedback[] }
interface Deps {
  userData: string; catalog: Pick<AgentCatalogService, 'list' | 'rejectTrial' | 'restoreVersion'>; runs: AgentRunStore;
  publish: (events: RawEvent[]) => void;
  send: (chatId: string, text: string) => Promise<unknown>;
  /** the chat with this id and its run mirror (undefined = no such chat): turns a chat id passed as runId into the run to use */
  chat?: (id: string) => { run?: { runId: string } } | undefined;
  /** a run's outcome changed: the loop evaluates its role again */
  onOutcome?: (run: AgentRun) => void;
  now?: () => number;
}
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Object required.');
  return v as Record<string, unknown>;
};

export class RunFeedback {
  private readonly file: string;
  private state: Store = { version: 1, feedback: [] };
  private problem: string | null = null;
  constructor(private readonly d: Deps) {
    this.file = path.join(d.userData, 'run-feedback.json');
    try {
      const raw = readLocal(this.file);
      if (raw !== undefined) {
        const s = object(raw);
        if (s.version !== 1 || !Array.isArray(s.feedback)) throw new Error('Invalid feedback store.');
        for (const value of s.feedback) {
          const f = object(value), o = object(f.outcome);
          if (typeof f.id !== 'string' || typeof f.agentId !== 'string' || typeof f.runId !== 'string' || !['orchestrator-opinion', 'reviewed-evidence'].includes(String(o.basis)) || !['success', 'partial', 'fail', 'unknown'].includes(String(o.verdict))) throw new Error('Invalid stored feedback.');
          parseEvidence(f.evidence);
          if (f.version !== undefined && (!Number.isSafeInteger(f.version) || Number(f.version) < 0) || f.gap !== undefined && !DEFINITION_GAPS.includes(f.gap as never)
            || ['worked', 'failed', 'gapKey'].some(k => f[k] !== undefined && typeof f[k] !== 'string')) throw new Error('Invalid stored feedback detail.');
        }
        this.state = structuredClone(s) as unknown as Store;
      }
    } catch { this.problem = 'Registro dei giudizi non leggibile: originale conservato, scritture sospese.'; }
  }
  private now(): number { return this.d.now?.() ?? Date.now(); }
  private write(next: Store): void {
    if (this.problem) throw new Error(this.problem);
    writeLocal(this.file, next); this.state = next;
  }
  private profile(id: string): AgentProfile {
    const p = this.d.catalog.list().profiles.find(p => p.id === id);
    if (!p) throw new Error('Unknown role.');
    return p;
  }
  /** The user's Annulla (agents:undo): a stale button cannot overwrite a newer change. An open trial's own baseline
   *  rejects the trial; any other version is a restore. */
  undo(input: AgentUndo): AgentProfile {
    const u = object(input);
    if (typeof u.agentId !== 'string' || typeof u.expectedRevision !== 'number' || !Number.isSafeInteger(u.version) || (u.version as number) < 1) throw new Error('Invalid undo.');
    const p = this.profile(u.agentId);
    if (p.updatedAt !== u.expectedRevision) throw new Error('Il ruolo è cambiato da allora: guarda la sua versione attuale prima di annullare.');
    const version = u.version as number;
    if (p.trial && p.trial.version === p.activeVersion && p.trial.baseline === version) return this.d.catalog.rejectTrial(p.id, version);
    return this.d.catalog.restoreVersion(p.id, version);
  }
  /** The numbers of the runs per role and version (agent_metrics): never a goal, a summary or a chat. */
  metrics(a: Record<string, unknown>): unknown {
    const period = a.period === undefined ? undefined : object(a.period);
    const since = period?.since;
    if (since !== undefined && (typeof since !== 'number' || !Number.isFinite(since) || since < 0)) throw new Error('Invalid period.');
    const filter = Object.fromEntries(['skill', 'app', 'repo'].filter(k => a[k] !== undefined).map(k => {
      if (typeof a[k] !== 'string' || !(a[k] as string).trim() || (a[k] as string).length > 120) throw new Error(`Invalid ${k}.`);
      return [k, (a[k] as string).trim()];
    }));
    const result = runMetrics(this.d.runs.list(), { ...(since !== undefined ? { since: since as number } : {}), rollups: this.d.runs.rolledUp(), filter });
    return result.filter(m => a.agentId === undefined || m.agentId === a.agentId).map(m => a.version === undefined ? m : { ...m, all: null, versions: m.versions.filter(v => v.version === a.version) });
  }
  private unknownRun(id: string): Error { return unknownRunError(id, this.d.runs.list(), this.d.chat); }
  /** A role's records, oldest first (the lifecycle's FeedbackSource). */
  feedbackOf(agentId: string): AgentFeedback[] { return structuredClone(this.state.feedback.filter(f => f.agentId === agentId)); }
  get storeProblem(): string | null { return this.problem; }
  /** The one writer. Arguments are already parsed (AgentFeedbackArgs); role and version come from the run, the basis from
   *  the evidence check below. */
  async recordFeedback(a: AgentFeedbackArgs, callerId: string): Promise<AgentFeedback> {
    if (this.problem) throw new Error(this.problem);
    const run = this.d.runs.get(a.runId), notes = a.notes;
    if (!run) throw this.unknownRun(a.runId);
    if (a.sendToRun && run.endedAt !== undefined) throw new Error('Ended runs cannot receive feedback messages.');
    const refs = a.evidence;
    const verified = refs.some(e => {
      if (e.kind !== 'run') return false;
      const review = this.d.runs.get(e.ref);
      return !!review && review.endedAt !== undefined && review.reviewOf === run.runId && review.agentId === 'judge' && review.version > 0
        && review.report?.verified === 'yes' && !!review.model && review.model !== run.model;
    });
    const outcome: AgentRunOutcome = { verdict: a.verdict as AgentRunOutcome['verdict'], basis: verified ? 'reviewed-evidence' : 'orchestrator-opinion', by: callerId, at: this.now(), note: notes };
    const f: AgentFeedback = { id: randomUUID(), at: this.now(), agentId: run.agentId, runId: run.runId, version: run.version, outcome, evidence: refs,
      ...(a.worked !== undefined ? { worked: a.worked } : {}), ...(a.failed !== undefined ? { failed: a.failed } : {}),
      ...(a.gap !== undefined ? { gap: a.gap } : {}), ...(a.gapKey !== undefined ? { gapKey: a.gapKey } : {}) };
    const own = this.state.feedback.filter(x => x.agentId === run.agentId).slice(-199);
    this.write({ ...this.state, feedback: [...this.state.feedback.filter(x => x.agentId !== run.agentId), ...own, f] });
    // Human decisions always win; an opinion cannot erase a previously verified outcome.
    if (run.outcome?.basis !== 'human' && !(run.outcome?.basis === 'reviewed-evidence' && !verified)) {
      const previous = run.outcome;
      run.outcome = outcome;
      try { this.d.runs.save(); } catch (error) { run.outcome = previous; throw error; }
      try { this.d.onOutcome?.(structuredClone(run)); } catch (error) { log.warn('agents', 'run verdict not passed to the loop', { cause: errText(error), hint: 'the verdict is saved; the next run end evaluates the role again' }); }
    }
    this.d.publish([{ kind: 'agent-feedback', title: notes, detail: JSON.stringify({ agentId: run.agentId, evidence: refs }) }]);
    if (a.sendToRun === true) await this.d.send(run.chatId, notes);
    return structuredClone(f);
  }
}

/** agent_metrics for the Orchestrator: numbers per role and version, never a run's content. */
export function metricsTool(service: RunFeedback): ToolDef {
  const string = { type: 'string' }, record = { type: 'object' }, integer = { type: 'integer' };
  return {
    name: 'agent_metrics',
    description: 'agent_metrics: success rate, cost, time, corrections and questions per role and version (numbers only; never a run\'s content). Filters: agentId, version, period { since }, skill, app, repo.',
    inputSchema: { type: 'object', properties: { agentId: string, version: integer, period: record, skill: string, app: string, repo: string }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: async (a: Record<string, unknown>) => service.metrics(a) as object,
  };
}
