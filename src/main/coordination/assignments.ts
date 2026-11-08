// Bounded semantic run snapshots: job status outlives chats.json, without scanning full run transcripts on each list.
import type { DatabaseSync } from 'node:sqlite';
import type { AgentRun } from '../../shared/agents';
import type { DecisionReceipt, ExecutionEvidence } from './model';
export interface AssignmentProjection {
  runId: string; taskId: string; taskVersion: number; chatId: string; parentRunId?: string;
  title: string; startedAt: number; endedAt?: number; state: 'active' | 'blocked' | 'reported' | 'done';
  evidence: string;
}
export function assignmentOf(run: AgentRun): AssignmentProjection {
  return { runId: run.runId, taskId: run.taskId ?? run.runId, taskVersion: run.taskVersion ?? 1, chatId: run.chatId,
    ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}), title: run.taskContract?.goal?.slice(0, 160) || run.goal.slice(0, 160),
    startedAt: run.startedAt, ...(run.endedAt !== undefined ? { endedAt: run.endedAt } : {}),
    state: run.outcome?.basis === 'human' && run.outcome.verdict === 'success' ? 'done'
      : run.report ? run.report.outcome === 'blocked' ? 'blocked' : 'reported' : run.endedAt !== undefined ? 'blocked' : 'active',
    evidence: run.outcome?.basis === 'human' ? `User verdict: ${run.outcome.verdict}` : run.report ? `Agent report (${run.report.verified}): ${run.report.summary}` : run.endedAt !== undefined ? 'Run ended without a completion verdict.' : 'Assignment recorded; no completion evidence.',
  };
}
export function writeAssignment(db: DatabaseSync, run: AgentRun): void {
  // The run store retains malformed historical rows for its own diagnostics; do not invent a job from them.
  if (!run || typeof run.runId !== 'string' || typeof run.chatId !== 'string' || typeof run.goal !== 'string' || !Number.isFinite(run.startedAt)) return;
  const snapshot = assignmentOf(run), json = JSON.stringify(snapshot);
  db.prepare(`insert into coordination_assignments(run_id, task_id, chat_id, version, started_at, json) values(?,?,?,?,?,?)
    on conflict(run_id) do update set task_id=excluded.task_id, chat_id=excluded.chat_id, version=excluded.version, started_at=excluded.started_at, json=excluded.json
    where coordination_assignments.json != excluded.json`).run(run.runId, snapshot.taskId, run.chatId, snapshot.taskVersion, run.startedAt, json);
  db.prepare('delete from coordination_current_assignments where run_id = ? and task_id != ?').run(run.runId, snapshot.taskId);
  db.prepare(`insert into coordination_current_assignments(task_id,run_id,version,started_at) values(?,?,?,?)
    on conflict(task_id) do update set run_id=excluded.run_id, version=excluded.version, started_at=excluded.started_at
    where excluded.version > coordination_current_assignments.version or
      (excluded.version = coordination_current_assignments.version and excluded.started_at > coordination_current_assignments.started_at)`)
    .run(snapshot.taskId, snapshot.runId, snapshot.taskVersion, snapshot.startedAt);
  if (run.report) {
    const decisions = db.prepare(`select d.json from coordination_decisions d join coordination_requests r on r.id=d.request_id
      where r.chat_id = ? and r.state = 'accepted' and json_extract(r.json,'$.key.runId') = ?`).all(run.chatId, run.runId) as { json: string }[];
    for (const { json } of decisions) {
      const decision = JSON.parse(json) as DecisionReceipt;
      if (run.report.at < decision.at) continue;
      const evidence: ExecutionEvidence = { id: `report:${run.runId}:${run.report.at}:${decision.id}`, decisionId: decision.id, at: run.report.at, source: 'agent-report', reference: snapshot.evidence };
      db.prepare('insert into coordination_execution(id,decision_id,json) values(?,?,?) on conflict(id) do nothing').run(evidence.id, decision.id, JSON.stringify(evidence));
    }
  }
}
