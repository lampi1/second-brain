// Persistence of the app's own chats in <userData>/chats.json, so tiles come back after a restart as 'closed' and
// resume on the first message (docs/architecture.md "Data and state"). Only ids, folders, choices, the last context
// size, the hand-off/"Riprendi" links and the past sessions of a cold continuation (ADR 0031) are stored:
// never messages (they stay in each CLI's transcript) and never secrets. Writes are atomic (tmp + rename); a corrupt
// file is set aside as chats.json.bad-<time> instead of being lost. Used by manager.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { ChatLink, ChatSpace, Effort, HandoffSource, Harness, PermissionMode, RouteDecision } from '../../shared/contract';
import { validRoute } from '../brain/routing';
import { errText, log } from '../log';
import { isUuid } from './session';

export interface StoredChat {
  id: string;
  harness: Harness;
  cwd: string;
  sessionId: string | null;
  /** a fork not started yet: resume this id with --fork-session (its own id comes from the CLI) */
  forkFrom?: string;
  title: string;
  model: string | null;
  effort: Effort | null;
  /** null = never chosen by the user: the CLI follows settings.json (ADR 0002) */
  permissionMode: PermissionMode | null;
  isRegia: boolean;
  /** a Regia's tab name; a work chat's Regia (ADR 0021) */
  regiaName?: string;
  regiaOf?: string;
  regiaSince?: number;
  createdAt: number;
  /** the CLI's running cost total last seen, for per-turn deltas after a resume */
  costTotalUsd?: number;
  /** end of the last real turn: a saved hand-off older than this is stale */
  lastTurnAt?: number;
  /** the context size last seen, so a closed long chat still shows it (estimated: Cursor) */
  context?: { tokens: number; max?: number; estimated?: boolean };
  /** a hand-off note exists in <userData>/handoffs/<id>.md, written at this time */
  handoffAt?: number;
  handoffSource?: HandoffSource;
  /** its saved hand-off is a cold note (ADR 0031) written at this time: a message after the cache expired continues
   *  the chat in a fresh session from it */
  coldNoteAt?: number;
  /** the sessions this chat had before its cold continuations, oldest first (their transcripts show folded above) */
  pastSessions?: PastSession[];
  /** "Riprendi" links: this chat continues another one / is continued by another one */
  continuedFrom?: ChatLink;
  continuedBy?: ChatLink;
  /** created with "Worktree separato" (the CLI made the worktree; "Riprendi" tells the new chat to work there) */
  inWorktree?: boolean;
  /** archived (out of the grid, in the palette's "Chiuse" group) at this time, by the auto-close or by hand */
  closedAt?: number;
  closedBy?: 'auto' | 'user';
  /** a turn was running when this was written: if the app stops now, the next start resumes the chat by itself */
  working?: true;
  /** a chat of the "Migliora l'app" section; appRegia = that section's Regia */
  space?: ChatSpace;
  appRegia?: true;
  /** how an agent's app_create_chat chose its engine (the routing table, ADR 0032) */
  route?: RouteDecision;
}

export interface PastSession { sessionId: string; at: number; notePath: string }

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const link = (v: unknown): ChatLink | null => {
  const l = v as Record<string, unknown> | null;
  return l && typeof l === 'object' && typeof l.id === 'string' && l.id && typeof l.title === 'string' ? { id: l.id, title: l.title } : null;
};
function extras(c: Record<string, unknown>): Partial<StoredChat> {
  const ctx = c.context as Record<string, unknown> | undefined;
  const from = link(c.continuedFrom), by = link(c.continuedBy), route = validRoute(c.route);
  return {
    ...(route ? { route } : {}),
    ...(num(c.lastTurnAt) ? { lastTurnAt: c.lastTurnAt } : {}),
    ...(ctx && typeof ctx === 'object' && num(ctx.tokens) ? { context: { tokens: ctx.tokens, ...(num(ctx.max) ? { max: ctx.max } : {}), ...(ctx.estimated === true ? { estimated: true } : {}) } } : {}),
    ...(num(c.coldNoteAt) ? { coldNoteAt: c.coldNoteAt } : {}),
    ...(Array.isArray(c.pastSessions) ? { pastSessions: c.pastSessions.flatMap(p => { const x = p as Record<string, unknown>; return isUuid(x?.sessionId) && num(x.at) && typeof x.notePath === 'string' ? [{ sessionId: x.sessionId, at: x.at, notePath: x.notePath }] : []; }).slice(-20) } : {}),
    ...(num(c.handoffAt) ? { handoffAt: c.handoffAt, handoffSource: c.handoffSource === 'auto' ? 'auto' as const : 'chat' as const } : {}),
    ...(from ? { continuedFrom: from } : {}), ...(by ? { continuedBy: by } : {}),
    ...(c.inWorktree === true ? { inWorktree: true } : {}),
    ...(c.space === 'app' ? { space: 'app' as const, ...(c.appRegia === true ? { appRegia: true as const } : {}) } : {}),
  };
}

const HARNESSES: readonly string[] = ['claude', 'cursor'];
const MODES: readonly string[] = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'];
const EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** v1 files always wrote 'default' even when the user chose nothing: read as "no choice" (v2 writes only real choices). */
function valid(x: unknown, version: number): StoredChat | null {
  if (!x || typeof x !== 'object') return null;
  const c = x as Record<string, unknown>;
  if (typeof c.id !== 'string' || !c.id || typeof c.cwd !== 'string' || !HARNESSES.includes(String(c.harness))) return null;
  return {
    id: c.id, harness: c.harness as Harness, cwd: c.cwd,
    // only UUIDs ever reach --resume / --session-id: anything else in the file is dropped
    sessionId: isUuid(c.sessionId) ? c.sessionId : null,
    ...(isUuid(c.forkFrom) ? { forkFrom: c.forkFrom } : {}),
    title: typeof c.title === 'string' ? c.title : 'Chat',
    model: typeof c.model === 'string' && c.model ? c.model : null,
    effort: EFFORTS.includes(String(c.effort)) ? (c.effort as Effort) : null,
    permissionMode: MODES.includes(String(c.permissionMode)) && !(version < 2 && c.permissionMode === 'default') ? (c.permissionMode as PermissionMode) : null,
    isRegia: c.isRegia === true,
    ...(c.isRegia === true && typeof c.regiaName === 'string' && c.regiaName ? { regiaName: c.regiaName.slice(0, 30) } : {}),
    ...(c.isRegia !== true && typeof c.regiaOf === 'string' && c.regiaOf ? { regiaOf: c.regiaOf } : {}),
    ...(c.isRegia === true && typeof c.regiaSince === 'number' && Number.isFinite(c.regiaSince) ? { regiaSince: c.regiaSince } : {}),
    createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
    ...(typeof c.costTotalUsd === 'number' && Number.isFinite(c.costTotalUsd) ? { costTotalUsd: c.costTotalUsd } : {}),
    ...extras(c),
    // the Regia (and the app's Regia) is never archived, whatever the file says
    ...(typeof c.closedAt === 'number' && Number.isFinite(c.closedAt) && c.isRegia !== true && c.appRegia !== true ? { closedAt: c.closedAt, closedBy: c.closedBy === 'user' ? 'user' as const : 'auto' as const } : {}),
    ...(c.working === true && typeof c.closedAt !== 'number' ? { working: true as const } : {}),
  };
}

export class ChatStore {
  readonly file: string;
  constructor(userData: string) { this.file = path.join(userData, 'chats.json'); }

  load(): StoredChat[] {
    let text: string;
    try { text = fs.readFileSync(this.file, 'utf8'); } catch { return []; }
    try {
      const data = JSON.parse(text) as { version?: unknown; chats?: unknown };
      const version = typeof data.version === 'number' ? data.version : 1;
      return (Array.isArray(data.chats) ? data.chats : []).map(c => valid(c, version)).filter((c): c is StoredChat => !!c);
    } catch (e) {
      const bad = `${this.file}.bad-${Date.now()}`;
      try { fs.renameSync(this.file, bad); } catch { /* keep it */ }
      log.error('chats', 'chats.json unreadable, starting empty', { cause: errText(e), hint: `the old file is kept as ${bad}; fix or delete it` });
      return [];
    }
  }

  save(chats: StoredChat[]): void {
    const body = `${JSON.stringify({ version: 2, chats }, null, 2)}\n`;
    const tmp = `${this.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, body, 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (e) {
      try { fs.writeFileSync(this.file, body, 'utf8'); } catch (e2) {
        log.error('chats', 'chats.json not saved', { cause: `${errText(e)} / ${errText(e2)}`, hint: 'check disk space and that userData is writable; chats will not survive a restart' });
      }
    }
  }
}
