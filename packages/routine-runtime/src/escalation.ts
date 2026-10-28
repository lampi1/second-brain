// Human escalation of the routine runtime (ADR 0175): a step that needs a person never asks in an app. The runtime writes
// ONE DevOps comment on the run's work item mentioning the package's escalation contact, polls the replies, and gives
// the contact's first reply to the step's next session as guidance; it is never a production or permission approval.
// Other authors are ignored; no reply → at most one reminder, never a cancel. State lives in run.json (`escalation`),
// written before and after each comment, so a restart never writes it twice.
// The texts, the reply rule and the timing mirror feat/flow-step-watchdog's staged src/main/flows/escalation.ts
// (escalationText, reminderText, the poll loop's reply filter, ESCALATION_POLL_MS / ESCALATION_REMINDER_MIN /
// MAX_ESCALATIONS), adapted to a run folder instead of a brain state file.
import type { DevOpsClient, DevOpsComment } from './devops';
import { commentHtml, mentionHtml, replyText, signedHtml } from './devops';
import type { RoutineEscalation } from './format';
import type { RunEscalation, RunRecord } from './run-store';
import type { Masker } from './mask';

export const ESCALATION_POLL_MS = 5 * 60_000;
export const ESCALATION_REMINDER_MIN = 240;
/** Escalations per run; one more question after that ends the run as needs-human. */
export const MAX_ESCALATIONS = 3;
const QUESTION_MAX = 600;

/** Mirrors escalationText (reason "question"): plain Italian, the run id for the run folder, the question last. */
export function escalationText(run: Pick<RunRecord, 'runId' | 'routineTitle' | 'routineId'>, stepId: string, question: string, masker?: Masker): string {
  const name = run.routineTitle || run.routineId;
  const q = (masker ? masker.mask(question) : question).trim().replace(/\s+/g, ' ').slice(0, QUESTION_MAX);
  return `Routine ${name} (run ${run.runId}): il passaggio «${stepId}» ha bisogno di una persona.${q ? ` Domanda del passaggio: «${q}».` : ''} `
    + 'La run resta in attesa e non viene annullata. '
    + 'Rispondi con un commento qui sotto: la routine lo passa al passaggio come indicazione. '
    + 'Non vale come approvazione di produzione né di permessi.';
}

/** Mirrors reminderText. */
export const reminderText = (runId: string, stepId: string): string =>
  `Promemoria: la routine (run ${runId}, passaggio «${stepId}») aspetta ancora una tua risposta al commento qui sopra. Non ne scriverò altri.`;

/** Comment HTML: the mention first, then the text, the step's signature last. */
export const escalationHtml = (contact: RoutineEscalation, text: string, signature?: string): string => signedHtml(`${mentionHtml(contact.contact, contact.contactName)} ${commentHtml(text)}`, signature);

/**
 * Mirrors the watchdog's reply rule: comments after ours, not ours, oldest first; the first by the contact with text is
 * the answer, the others are ignored. Returns the answer (if any) and the ignored ids.
 */
export function findReply(escalation: RunEscalation, comments: DevOpsComment[]): { answer?: DevOpsComment; ignored: number[] } {
  if (escalation.commentId === undefined) return { ignored: escalation.ignored };
  const own = new Set([escalation.commentId, escalation.reminder?.commentId].filter((v): v is number => typeof v === 'number'));
  const ignored = [...escalation.ignored];
  for (const c of comments.filter(c => c.id > escalation.commentId! && !own.has(c.id)).sort((a, b) => a.id - b.id)) {
    if (c.authorId.toLowerCase() === escalation.contact.toLowerCase() && c.text.trim()) return { answer: c, ignored };
    if (!ignored.includes(c.id)) ignored.push(c.id);
  }
  return { ignored: ignored.slice(-100) };
}

/** Whether the one reminder is due now. */
export const reminderDue = (escalation: RunEscalation, reminderMs: number, now: number): boolean =>
  escalation.reminder?.state === 'writing' || (!escalation.reminder && reminderMs > 0 && now - escalation.at >= reminderMs);

export { replyText };

export interface EscalationIo {
  runId: string; client: DevOpsClient; organization: string; project: string; workItem: number;
  contact: RoutineEscalation; masker: Masker;
  /** the commentSignature of the escalated step: the last line of the comment and its reminder */
  signature?: string;
  /** persists the escalation in run.json (fenced by the run attempt) */
  save(escalation: RunEscalation): void;
  now(): number;
}

/** Writes the escalation comment once (state "writing" first, so a crash retries only that). */
export async function writeEscalation(io: EscalationIo, escalation: RunEscalation, run: RunRecord): Promise<RunEscalation> {
  if (escalation.state !== 'writing') return escalation;
  const text = escalationText(run, escalation.stepId, escalation.question, io.masker);
  // a crash after POST: our comment is the newest one by us quoting this run and step
  const marker = `(run ${run.runId}): il passaggio «${escalation.stepId}»`;
  const existing = (await io.client.comments(io.organization, io.project, io.workItem)).find(c => c.createdAt >= escalation.at - 60_000 && c.text.includes(marker));
  const commentId = existing?.id ?? await io.client.comment(io.organization, io.project, io.workItem, escalationHtml(io.contact, text, io.signature));
  const next: RunEscalation = { ...escalation, state: 'waiting', commentId, at: io.now() };
  io.save(next);
  return next;
}

/** One poll: the reminder when due, then the replies. Returns the updated escalation. */
export async function pollEscalation(io: EscalationIo, escalation: RunEscalation, reminderMs: number): Promise<RunEscalation> {
  let current = escalation;
  if (current.state !== 'waiting') return current;
  if (reminderDue(current, reminderMs, io.now())) {
    current = { ...current, reminder: current.reminder ?? { state: 'writing' } };
    io.save(current);
    const commentId = await io.client.comment(io.organization, io.project, io.workItem, escalationHtml(io.contact, reminderText(io.runId, current.stepId), io.signature));
    current = { ...current, reminder: { state: 'sent', commentId } };
    io.save(current);
  }
  const { answer, ignored } = findReply(current, await io.client.comments(io.organization, io.project, io.workItem));
  current = answer
    ? { ...current, state: 'answered', ignored, lastPollAt: io.now(), answer: { commentId: answer.id, at: io.now(), text: io.masker.mask(replyText(answer.text)), author: answer.authorName ?? answer.authorId } }
    : { ...current, ignored, lastPollAt: io.now() };
  io.save(current);
  return current;
}

