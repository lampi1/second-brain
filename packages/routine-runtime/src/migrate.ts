// Legacy write migration (ADR 0175, owner 2026-10-27): every run of the old app runtime that is stuck in cleanup or
// holds a pending DevOps write goes through verify-then-decide, with no human reconciliation step and no hardcoded run
// ids. Each pending write is looked up on DevOps: applied → done, not applied → not-done, unclear → not-verified; every
// such run is then ended. The legacy ledger has no idempotency marker, so the verifier matches a write by its kind,
// its work item, the identity the runtime writes as, and the time it was attempted. An active legacy run that already
// made progress, has no package run and no pending write is never restarted from step 0 (owner, 2026-10-27): it is
// ended as "interrupted by migration" (`recordInterruptedRun` writes its run folder, report and events, and marks its
// work item as handled for the trigger); the user re-runs it by hand (`routine run … --input workItem=<id>`). Pure
// apart from `recordInterruptedRun`: the app applies the result.
import { writeReport } from './report';
import type { RunRecord, RunStore } from './run-store';
import type { DevOpsClient } from './devops';

/** One write of the legacy ledger (src/main/flows/devops-writer.ts `operations`), as the app reads it. */
export interface LegacyOperation {
  id: string; runId: string; op: string;
  state: 'pending' | 'done' | 'not-done' | 'reconciled' | string;
  at?: number; organization?: string; workItemId?: number;
}
/** One legacy run, as the app reads it (FlowRun + its disposition). */
export interface LegacyRun {
  runId: string; status: string; cleanup?: 'pending' | 'complete';
  /** the run already has a package run (routine-runs/links.json): the package resumes it, the migration leaves it */
  linked?: boolean;
  /** some step already started (running, approval, blocked, completed): restarting it would redo work */
  progressed?: boolean;
  workItem?: number;
}

export type LegacyVerdict = 'applied' | 'not-applied' | 'unclear';
export type LegacyVerifier = (op: LegacyOperation) => Promise<LegacyVerdict>;

export interface LegacyMigration {
  operations: { id: string; runId: string; op: string; verdict: LegacyVerdict; outcome: 'done' | 'not-done' | 'not-verified'; note: string }[];
  /** runs to end now: stuck in cleanup, or with a write that was pending */
  runs: { runId: string; note: string; interrupted?: true; workItem?: number }[];
}

const ENDED = new Set(['completed', 'cancelled']);
export const INTERRUPTED_NOTE = 'interrupted by migration';

const OUTCOME = { applied: 'done', 'not-applied': 'not-done', unclear: 'not-verified' } as const;

/** Decides every legacy pending write by verifying it on DevOps, and which runs to end. Never throws, never blocks. */
export async function migrateLegacyWrites(runs: readonly LegacyRun[], operations: readonly LegacyOperation[], verify: LegacyVerifier): Promise<LegacyMigration> {
  const out: LegacyMigration = { operations: [], runs: [] };
  const pending = operations.filter(o => o.state === 'pending');
  for (const op of pending) {
    let verdict: LegacyVerdict;
    try { verdict = await verify(op); } catch { verdict = 'unclear'; }
    const outcome = OUTCOME[verdict];
    out.operations.push({ id: op.id, runId: op.runId, op: op.op, verdict, outcome,
      note: verdict === 'unclear' ? 'not verified: DevOps could not confirm the effect; the run is ended anyway' : `verified on DevOps by the routine runtime: ${verdict}` });
  }
  const withPending = new Set(pending.map(o => o.runId));
  for (const run of runs) {
    if (run.cleanup !== 'pending' && !withPending.has(run.runId)) {
      // an active legacy run with progress and no package run: ended, never restarted from step 0
      if (ENDED.has(run.status) || run.linked || !run.progressed) continue;
      const again = run.workItem !== undefined ? `re-run it with --input workItem=${run.workItem}` : 'start it again by hand';
      out.runs.push({ runId: run.runId, interrupted: true, ...(run.workItem !== undefined ? { workItem: run.workItem } : {}),
        note: `${INTERRUPTED_NOTE}: the legacy run was active with no pending write; it is not restarted from step 0 (${again})` });
      continue;
    }
    const ops = out.operations.filter(o => o.runId === run.runId);
    out.runs.push({ runId: run.runId, note: ops.length
      ? `ended by the legacy migration: ${ops.map(o => `${o.op} ${o.outcome}`).join(', ')}`
      : 'ended by the legacy migration: cleanup was stuck, no pending write' });
  }
  return out;
}

/** How far after its ledger time a legacy write may show up on DevOps. */
export const LEGACY_WINDOW_MS = 15 * 60_000;

const COMMENT_OPS = new Set(['comment']);
const FIELD_OPS = new Set(['add-tags', 'remove-tags', 'set-fields']);

/**
 * The DevOps verifier for legacy writes: a comment write is applied when a comment by the runtime's identity exists
 * from 1 minute before to LEGACY_WINDOW_MS after the write; a tags/fields write when the update history has a change by
 * that identity in the same window. Other kinds (PRs, test plans, deploys) cannot be matched: unclear.
 */
export function createLegacyWriteVerifier(client: Pick<DevOpsClient, 'item' | 'comments' | 'updates' | 'me'>): LegacyVerifier {
  const identities = new Map<string, Promise<string>>();
  return async op => {
    if (!op.organization || !op.workItemId || !op.at) return 'unclear';
    if (!COMMENT_OPS.has(op.op) && !FIELD_OPS.has(op.op)) return 'unclear';
    try {
      if (!identities.has(op.organization)) identities.set(op.organization, client.me(op.organization));
      const me = await identities.get(op.organization)!;
      const from = op.at - 60_000, to = op.at + LEGACY_WINDOW_MS;
      if (COMMENT_OPS.has(op.op)) {
        const project = (await client.item(op.organization, op.workItemId)).project;
        const comments = await client.comments(op.organization, project, op.workItemId);
        return comments.some(c => c.authorId === me && c.createdAt >= from && c.createdAt <= to) ? 'applied' : 'not-applied';
      }
      const updates = await client.updates(op.organization, op.workItemId);
      return updates.some(u => u.byId === me && u.at >= from && u.at <= to && u.fields.some(f => f !== 'System.Rev' && f !== 'System.ChangedDate' && f !== 'System.RevisedDate' && f !== 'System.AuthorizedDate' && f !== 'System.Watermark'))
        ? 'applied' : 'not-applied';
    } catch { return 'unclear'; }
  };
}

/** Writes the run folder of a legacy run ended as interrupted by the migration (run.json cancelled with the note,
 *  events.jsonl, report.md) and marks its work item as handled in the trigger state, so the trigger never starts it
 *  again. Returns the new package run id. */
export function recordInterruptedRun(store: RunStore, legacy: { routineId: string; routineTitle: string; steps: { id: string; title: string }[];
  legacyRunId: string; note: string; workItem?: number; inputs?: Record<string, string>; now: number }): string {
  const safe = legacy.legacyRunId.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 80);
  const runId = `legacy-${safe}`;
  if (!store.runIds().includes(runId)) {
    const run: RunRecord = {
      schema: 1, runId, routineId: legacy.routineId, routineTitle: legacy.routineTitle, status: 'cancelled', attempt: 1,
      inputs: { ...(legacy.inputs ?? {}), ...(legacy.workItem !== undefined ? { workItem: String(legacy.workItem) } : {}) },
      ...(legacy.workItem !== undefined ? { workItem: legacy.workItem } : {}), createdAt: legacy.now, updatedAt: legacy.now, endedAt: legacy.now,
      error: legacy.note, steps: legacy.steps.map((s, i) => ({ n: i + 1, id: s.id, title: s.title, status: 'pending', attempts: 0 })),
    };
    store.create(run);
    store.appendEvent(runId, { type: 'run-start', at: legacy.now, runId, routine: legacy.routineId, total: run.steps.length, ...(legacy.workItem !== undefined ? { workItem: legacy.workItem } : {}) });
    store.appendEvent(runId, { type: 'run-end', at: legacy.now, status: 'cancelled', error: legacy.note });
    writeReport(store, run);
  }
  if (legacy.workItem !== undefined) {
    const state = store.trigger(), key = `item:${legacy.workItem}`;
    if (!state.subjects[key]) { state.subjects[key] = { runId, at: legacy.now, title: INTERRUPTED_NOTE }; store.setTrigger(state); }
  }
  return runId;
}
