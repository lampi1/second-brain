// The one-line texts of the Orchestrator column's thin rows and short cards (ADR 0367, owner 2026-11-27: «discreti,
// come la UI dei messaggi delle altre chat, non così grassi»): a result's outcome as its first sentence, a command's
// risk in one word, a «Stai aspettando» chip's status. Pure, no React and no store: used by ResultRow.tsx,
// OrchAskCard.tsx and WaitingRow.tsx; pinned by test/unit/orch-lines.test.ts.
import type { ChatSummary } from '@shared/contract';
import type { Gist } from '@shared/gist';
import { resultLine } from './chat-view';

/** The most characters a one-line outcome keeps (the row's CSS ellipsis cuts it to the width anyway). */
export const OUTCOME_MAX = 140;

/** A sentence ends at . ! ? … followed by a space and a capital letter, a digit or a quote (never inside «v1.2»,
 *  «feature/127.0», «es. questo» in lower case). */
const SENTENCE_END = /([.!?…])\s+(?=[A-ZÀ-ÖØ-Þ0-9«"“(])/u;

/** The first sentence of a result (its first meaningful line, markdown stripped), at most OUTCOME_MAX characters with
 *  an ellipsis. '' for an empty text. */
export function outcomeLine(text: string): string {
  const line = resultLine(text ?? '');
  const m = SENTENCE_END.exec(line);
  // one closing full stop goes (a row is not prose); «!», «?» and «…» stay
  const sentence = (m ? line.slice(0, m.index + 1) : line).trim().replace(/(?<!\.)\.$/, '');
  const chars = [...sentence];
  return chars.length > OUTCOME_MAX ? `${chars.slice(0, OUTCOME_MAX - 1).join('').trimEnd()}…` : sentence;
}

/** How risky a command is, in one word: production (the app's own production check), a write, or a read. */
export type CommandRisk = 'prod' | 'write' | 'read';
const READ_GISTS: ReadonlySet<Gist> = new Set(['list', 'read', 'search', 'diff', 'history', 'findFiles', 'readData', 'wait', 'print', 'cd', 'web', 'webSearch', 'openPage', 'screenshot']);
export function commandRisk(gist: Gist, prod: string | null | undefined): CommandRisk {
  if (prod) return 'prod';
  return READ_GISTS.has(gist) ? 'read' : 'write';
}

/** A «Stai aspettando» chip: finished (green ✓), or how far along it is (a plan's step, else its state). */
export type WaitStatus = { kind: 'done' } | { kind: 'step'; done: number; total: number } | { kind: 'state'; state: 'running' | 'waiting' | 'error' | 'idle' };
export function waitStatus(c: Pick<ChatSummary, 'state' | 'userWait' | 'plan' | 'pending'>): WaitStatus {
  if (c.userWait?.doneAt !== undefined) return { kind: 'done' };
  const steps = c.plan?.steps ?? [];
  if (steps.length > 1) return { kind: 'step', done: steps.filter(s => s.state === 'done').length, total: steps.length };
  if (c.pending > 0 || c.state === 'waiting') return { kind: 'state', state: 'waiting' };
  if (c.state === 'error') return { kind: 'state', state: 'error' };
  if (c.state === 'running' || c.state === 'starting') return { kind: 'state', state: 'running' };
  return { kind: 'state', state: 'idle' };
}

/** How long a finished wait keeps its green ✓ in the row. */
export const WAIT_DONE_SHOWN_MS = 30 * 60_000;

/** The chats the user waits for, oldest wait first: open ones, and finished ones for WAIT_DONE_SHOWN_MS. */
export function waitedChats<C extends Pick<ChatSummary, 'id' | 'userWait' | 'closedAt' | 'isOrchestrator'>>(chats: readonly C[], now: number): C[] {
  return chats.filter(c => !c.isOrchestrator && c.userWait && (c.userWait.doneAt !== undefined ? now - c.userWait.doneAt < WAIT_DONE_SHOWN_MS : !c.closedAt))
    .sort((a, b) => a.userWait!.since - b.userWait!.since);
}
