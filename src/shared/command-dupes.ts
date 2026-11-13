// One command, one panel (ADR 0299). Why: on 2026-11-13 a worker left an Azure deploy for Esegui, the Orchestrator
// repeated it as a ```powershell block, the app drew a second Esegui, and the user started the same deploy twice, 105 s
// apart. Here the pure rules both sides share:
// - normCommand: two blocks are the same command when their text matches once trimmed and every run of whitespace
//   (line ends included) is one space; a different argument is another command;
// - originalOf: the first identical entry (a command waiting for Esegui or a run still going) another block owns, so a
//   repeated block is drawn as a reference to it instead of a second Esegui (commandRefOf, renderer/lib/runs.ts and
//   renderer/components/CodeBlock.tsx);
// - the run-time guard's words (main/run/runner.ts refuses an identical running command and asks one confirmation
//   before re-running one that ended in the last RERUN_MS, or in this app session for production, DB or Azure).
// Used by main/run/runner.ts, main/run/asks.ts, main/wiring.ts (Telegram, Remote Control) and the renderer.
import type { PendingRequest, RunInfo } from './contract';

/** the text that decides whether two commands are the same: trimmed, every whitespace run (CRLF too) one space */
export const normCommand = (code: string): string => String(code ?? '').replace(/\s+/g, ' ').trim();

export const sameCommand = (a: string, b: string): boolean => { const x = normCommand(a); return !!x && x === normCommand(b); };

/** an identical command that ended this recently asks one confirmation before it runs again */
export const RERUN_MS = 10 * 60_000;

/** What a block is a repeat of: the command request waiting for Esegui, or the run going on, of another block. */
export interface CommandOriginal { kind: 'ask' | 'run'; id: string; chatId: string; itemId: string }

/** The first identical entry another block owns (a command request waiting, or a run still going), or null. The block's
 *  own entries never count: a block is never a repeat of itself. */
export function originalOf(code: string, self: { chatId: string; itemId: string },
  asks: readonly PendingRequest[], runs: readonly RunInfo[]): CommandOriginal | null {
  const want = normCommand(code);
  if (!want) return null;
  const mine = (chatId: string, itemId: string) => chatId === self.chatId && itemId === self.itemId;
  const found: (CommandOriginal & { at: number })[] = [];
  for (const r of asks) {
    const c = r.command;
    if (r.type === 'command' && c && !mine(r.chatId, c.itemId) && normCommand(c.code) === want) found.push({ kind: 'ask', id: r.id, chatId: r.chatId, itemId: c.itemId, at: r.at });
  }
  for (const r of runs) {
    if (r.state === 'running' && !mine(r.chatId, r.itemId) && normCommand(r.code) === want) found.push({ kind: 'run', id: r.id, chatId: r.chatId, itemId: r.itemId, at: r.startedAt });
  }
  found.sort((a, b) => a.at - b.at);
  const first = found[0];
  return first ? { kind: first.kind, id: first.id, chatId: first.chatId, itemId: first.itemId } : null;
}

/** What a repeated block shows instead of its Esegui: the original block, and its request or newest run now. */
export interface CommandRef { original: CommandOriginal; ask: PendingRequest | null; run: RunInfo | null }

/** The reference of a block (renderer/lib/runs.ts keeps `memo` for the window's life, so the reference keeps the
 *  original's state after its request left or its run ended), or null when it is no repeat, or what it repeated is
 *  gone without a run (put aside): then the block gets its Esegui back. */
export function commandRefOf(chatId: string, itemId: string, code: string, pending: readonly PendingRequest[],
  all: readonly RunInfo[], memo: Map<string, CommandOriginal>): CommandRef | null {
  const want = normCommand(code), key = `${chatId}|${itemId}|${want}`;
  let o = memo.get(key) ?? null;
  if (!o) {
    o = originalOf(code, { chatId, itemId }, pending, all);
    if (!o) return null;
    memo.set(key, o);
  }
  const orig = o;
  const ask = orig.kind === 'ask' ? pending.find(p => p.chatId === orig.chatId && p.id === orig.id) ?? null : null;
  let run: RunInfo | null = null;
  for (const r of all) if (r.chatId === orig.chatId && r.itemId === orig.itemId && normCommand(r.code) === want && (!run || r.startedAt >= run.startedAt)) run = r;
  if (!ask && !run) { memo.delete(key); return null; }
  return { original: orig, ask, run };
}

/** What Esegui answers when it did not start (main/run/runner.ts start): the identical command still running, or one
 *  that ended recently and needs one confirmation (confirmRerun) first. */
export type RunAlready = 'running' | 'done';

const secs = (ms: number): number => Math.max(0, Math.round(ms / 1000));
const mins = (ms: number): number => Math.max(1, Math.round(ms / 60_000));

/** «Già in corso da N s, avviato da «chat»» (Italian: main's words for the phone and Remote Control) */
export function alreadyRunningText(run: Pick<RunInfo, 'startedAt'>, chatTitle: string, now: number): string {
  return `Già in corso da ${secs(now - run.startedAt)} s, avviato da «${chatTitle}»`;
}

/** «Eseguito N min fa, exit X. Rieseguire?» */
export function rerunText(run: Pick<RunInfo, 'endedAt' | 'startedAt' | 'exitCode' | 'state'>, now: number): string {
  const exit = run.state === 'stopped' ? 'fermato' : `exit ${run.exitCode ?? '?'}`;
  return `Eseguito ${mins(now - (run.endedAt ?? run.startedAt))} min fa, ${exit}. Rieseguire?`;
}
