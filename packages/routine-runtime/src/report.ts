// report.md of a routine run (ADR 0175): the human summary of run.json, re-written at each status change, masked by the
// run store like every other run file. Pure text from the run record: no prompt, no transcript.
import path from 'node:path';
import type { RunRecord, RunStore } from './run-store';
import { stepFolderName } from './run-store';

const time = (ms?: number) => ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '-';

export function reportText(run: RunRecord): string {
  const lines = [
    `# ${run.routineTitle}: run ${run.runId}`, '',
    `- Status: **${run.status}**`,
    `- Started: ${time(run.createdAt)} · ended: ${time(run.endedAt)} · attempt ${run.attempt}`,
    ...(run.workItem !== undefined ? [`- Work item: ${run.workItem}`] : []),
    ...(Object.keys(run.inputs).length ? [`- Inputs: ${Object.entries(run.inputs).map(([k, v]) => `${k}=${v}`).join(', ')}`] : []),
    ...(run.error ? [`- Error: ${run.error}`] : []),
    '', '## Steps', '',
  ];
  for (const s of run.steps) {
    lines.push(`### ${s.n}. ${s.title} (${s.status})`, '');
    lines.push(`- Folder: steps/${stepFolderName(s.n, s.id, s.round)} · session attempts: ${s.attempts}${(s.round ?? 1) > 1 ? ` · round ${s.round}` : ''}${s.loops ? ` · sent the run back ${s.loops} time(s)` : ''}`);
    if (s.summary) lines.push(`- Summary: ${s.summary}`);
    if (s.error) lines.push(`- Error: ${s.error}`);
    if (s.testDb) lines.push(`- Test DB: ${s.testDb === 'unavailable' ? 'DB unavailable' : s.testDb}${s.testDbNote ? ` (${s.testDbNote})` : ''}`);
    if (s.writes?.length) lines.push(`- DevOps: ${s.writes.join('; ')}`);
    if (s.notVerified?.length) lines.push(`- DevOps not verified (the run went on): ${s.notVerified.join('; ')}`);
    if (s.failedWrites?.length) lines.push(`- DevOps refused (the run went on): ${s.failedWrites.join('; ')}`);
    lines.push('');
  }
  const e = run.escalation;
  if (e) {
    lines.push('## Escalation', '', `- Step: ${e.stepId} · state: ${e.state} · since ${time(e.at)}${e.commentId !== undefined ? ` · comment ${e.commentId}` : ''}`, `- Question: ${e.question}`);
    if (e.reminder) lines.push(`- Reminder: ${e.reminder.state}`);
    if (e.answer) lines.push(`- Answer by ${e.answer.author}: ${e.answer.text}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function writeReport(store: RunStore, run: RunRecord): void {
  store.writeText(path.join(store.runDir(run.runId), 'report.md'), reportText(run));
}
