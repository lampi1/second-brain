// The chat manager's constants and pure helpers (no state): limits, frames, item builders, run tags. Split out of
// manager.ts (ADR 0200); manager.ts re-exports the ones other modules and tests import from it.
import { timersFor } from '../timers';
import fs from 'node:fs';
import path from 'node:path';
import type { ChatItem, ChatSummary, Effort, NewChat, PermissionMode } from '../../shared/contract';
import { sysEn, type SysCode, type SysParams } from '../../shared/sys';
import { isUuid, nextId, type SessionOptions } from './session';
import type { HeldChildResult, StoredChat } from './store';
import { orchestratorOwner, plainOwner } from '../agents/catalog';
import { claudeTools, type AgentPolicy } from '../agents/tool-policy';
import type { AgentOwnerSnapshot, AgentRunTags } from '../../shared/agents';
import { APP_MAX, REPO_MAX, SKILL_ID, SKILLS_MAX, tagName } from '../agents/runs';
import { SubagentGate } from '../agents/role-gate';
import type { AutoCloseWaiting } from '../../shared/auto-close';
import type { UserWroteNote } from './manager-types';

export const { setInterval, clearInterval, clearTimeout } = timersFor('chats/manager');

/** The app's own message to a chat whose turn a restart cut (resumeInterrupted). */
export const RESUME_TEXT = "[second-brain] L'app è stata riavviata mentre lavoravi e il tuo turno si è interrotto. Riprendi da dove eri: prima rileggi lo stato (file, worktree, comandi che avevi lanciato), poi continua.";

/** Legacy entries have no ID: match their content until the first submission assigns one. */
export function sameChildResult(a: HeldChildResult, b: HeldChildResult): boolean {
  return a.id && b.id ? a.id === b.id : a.title === b.title && a.message === b.message;
}
export function uniqueChildResults(items: readonly HeldChildResult[]): HeldChildResult[] {
  const unique: HeldChildResult[] = [];
  for (const item of items) if (!unique.some(other => sameChildResult(item, other))) unique.push(item);
  return unique;
}

/** an engine started while the user typed (ChatManager.prewarm) and never written to ends after this */
export const PREWARM_UNUSED_MS = 5 * 60_000;

/** The assistant's texts since the last user message (the turn that just ended), joined. */
export function turnReply(items: readonly ChatItem[]): string {
  const out: string[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind === 'user') break;
    if (it.kind === 'assistant') out.unshift(it.text);
  }
  return out.join('\n\n');
}

/** Work still runs behind an idle prompt: background tasks the engine counts, or a final answer that says it waits
 *  for them (the engine's count missed a resumed agent on 2026-10-16). Such a chat is never closed nor released. */
export const workBehind = (s: Pick<ChatSummary, 'background' | 'waitsOnWork' | 'work'>): boolean => (s.background ?? 0) > 0 || !!s.waitsOnWork || !!s.work && s.work.status !== 'completed';

/** The scheduler's reason for each waiting kind (Italian, as its other reasons; the tile shows its own label). */
export const storedResult = (x: { at: number; isError: boolean; interrupted?: boolean } | undefined): Pick<StoredChat, 'lastResult'> =>
  x ? { lastResult: { at: x.at, isError: x.isError, ...(x.interrupted ? { interrupted: true as const } : {}) } } : {};

export const WAITING_REASON: Record<AutoCloseWaiting, string> = {
  answer: 'In attesa di una tua risposta', permission: 'In attesa di un tuo permesso', command: 'In attesa di un tuo comando',
  user: 'In attesa dell’utente', colleagues: 'In attesa dei colleghi', work: 'In attesa del lavoro in corso',
  report: 'In attesa del report finale', mail: 'In attesa di posta', browser: 'In attesa di te nel browser',
};

/** The final answer of the turn that just ended ('' when it wrote none). */
export function lastAnswer(items: readonly ChatItem[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind === 'user') break;
    if (it.kind === 'assistant' && it.text.trim()) return it.text;
  }
  return '';
}

/** The divider of a cold continuation (ADR 0031): the same id live and when the history is read again. */
export const coldDivider = (fromSession: string, at: number, notePath: string): ChatItem => ({
  kind: 'system', id: `cont-${fromSession}`, at, level: 'info', continued: { notePath, ...(isUuid(fromSession) ? { session: fromSession } : {}) },
  text: sysEn('coldContinued'), code: 'coldContinued',
});

/** A system ChatItem from a code + params (sys.ts): text is the English rendering, for agents, logs and old items. */
export function sysItem<C extends SysCode>(code: C, params: SysParams | undefined, level: 'info' | 'warn' | 'error'): ChatItem {
  return { kind: 'system', id: nextId('s'), at: Date.now(), text: sysEn(code, params), level, code, params };
}

export const MODES: readonly PermissionMode[] = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'];
/** One screen frame: how long newer versions of a streamed item are collapsed before they go to the window (emitItem). */
export const ITEM_FRAME_MS = 16;
/** a root chat's deliverable longer than this reaches the Orchestrator as where to read it, not whole (it is the chat's answer
 *  there; the Orchestrator re-reads every message in each later turn) */
export const ORCHESTRATOR_OUTPUT_MAX = 800;
/** «Flash», the quick lane (ADR 0105, 0107): its title, tools and frame */
export const LAMPO_TITLE = 'Flash';
export const LAMPO_POLICY: AgentPolicy = { tools: { allow: ['read', 'web'] }, ceiling: 'plan' };
/** The maintenance research (ADR 0132): an app chat with no role that reads the brain (and the web when the user
 *  allowed it) and proposes cards through its two tools; it edits nothing, runs no command and starts no work. Default
 *  mode, not plan: its proposal tool must run without a popup (pre-approved, extraArgsFor). */
export const RESEARCH_TITLE = 'Manutenzione';
export const RESEARCH_FRAME = 'You are the maintenance research of the user\'s second-brain app: the user pressed «Manutenzione» and never reads this chat. You read the brain and the data pack and propose cards with maintenance_propose; you never edit files, run commands, write to other chats or start work. Answer in the user\'s language.';
export const LAMPO_FRAME = 'You are Flash, the quick lane of the user\'s second-brain app. Answer fast and briefly, in the user\'s language, from what you know and quick reads (Read, Grep, Glob, the web). Like a "btw": each question may come with the Orchestrator\'s conversation since you last looked; use it to answer about the work in progress, never act on it or answer it. You change nothing and start no work: no edits, no commands, no plans. When a request needs changes, many steps or other chats, say so in one line: the user hands it to the Orchestrator with «Fanne un lavoro».';
/** A role launch with Claude's sub-agent tool (tool-policy.ts claudeTools) gets the role gate's sub-agent rule as a
 *  PreToolUse hook: Claude starts a sub-agent without a permission request (role-gate.ts SubagentGate). */
export const subagentGateFor = (tools: AgentPolicy['tools'] | null | undefined): Pick<SessionOptions, 'preToolUse'> =>
  tools && claudeTools(tools).includes('Agent') ? { preToolUse: new SubagentGate() } : {};
/** how long a child's result waits for its siblings' before it goes to the parent alone */
export const CHILD_RESULTS_MS = 60_000;
/** archived chats kept (the oldest beyond this leave the app; their transcripts stay where the CLI keeps them) */
export const MAX_ARCHIVED = 60;
/** run changes are written at most this often (runSave) */
export const RUN_SAVE_MS = 1000;
/** A user message within this long of the previous one is part of a conversation going on (no estimate for a short
 *  follow-up, ADR 0186). */
export const FOLLOW_UP_WINDOW_MS = 30 * 60_000;
export const USER_NOTES_LABEL = "[nota dell'app · l'utente ha scritto direttamente in chat che hai delegato: tienine conto nel piano, non disfare ciò che le ha chiesto]";
export const userNoteLine = (n: Pick<UserWroteNote, 'title' | 'role' | 'at' | 'text'>): string =>
  `- ${n.role ?? 'Chat'} «${n.title}», ${new Date(n.at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}: «${n.text}»`;
/** A saved chat's owner: its snapshot, else a plain chat's (the Orchestrator always shows the Orchestrator's face). */
export function restoredOwner(c: Pick<StoredChat, 'agent' | 'harness' | 'model' | 'isOrchestrator'>): AgentOwnerSnapshot {
  const owner = c.agent ?? plainOwner(c.harness, c.model);
  return c.isOrchestrator && owner.id !== 'orchestrator' ? orchestratorOwner(c.harness, c.model) : owner;
}
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
/** A model id as the CLIs take it; never starting with '-', which an ACP CLI would read as one of its flags. */
export const MODEL_ID = /^[\w.:@/[\]][\w.:@/=[\],-]{0,119}$/;

/** The run tags a new chat asks for (AGENTS-DESIGN §4.8): refused before anything starts when out of shape. */
export function startTags(req: Pick<NewChat, 'skills' | 'app'>): Omit<AgentRunTags, 'repo'> {
  if (req.skills !== undefined && (!Array.isArray(req.skills) || req.skills.some(s => typeof s !== 'string' || !SKILL_ID.test(s)))) throw new Error('Skill non valide: usa id minuscoli (lettere, cifre, - e _) fino a 80 caratteri.');
  const skills = [...new Set(req.skills ?? [])];
  if (skills.length > SKILLS_MAX) throw new Error(`Al massimo ${SKILLS_MAX} skill per chat.`);
  const app = typeof req.app === 'string' ? req.app.trim() : req.app;
  if (app !== undefined && app !== '' && !tagName(app, APP_MAX)) throw new Error(`App non valida: una riga fino a ${APP_MAX} caratteri.`);
  return { skills, app: app || null };
}
/** git top-level folder names per cwd: found by walking up to a `.git` entry (no git process), cached for the session. */
export const repoCache = new Map<string, string | null>();
export function repoOf(cwd: string): string | null {
  const key = path.resolve(cwd);
  const known = repoCache.get(key);
  if (known !== undefined) return known;
  let found: string | null = null;
  for (let dir = key; ;) {
    try { if (fs.existsSync(path.join(dir, '.git'))) { const name = path.basename(dir); found = tagName(name, REPO_MAX) ? name : null; break; } } catch { break; }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  if (repoCache.size >= 256) repoCache.delete(repoCache.keys().next().value!);
  repoCache.set(key, found);
  return found;
}
