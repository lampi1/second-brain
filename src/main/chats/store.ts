// Persistence of the app's own chats in <userData>/chats.json, so tiles come back after a restart as 'closed' and
// resume on the first message (docs/architecture.md "Data and state"). Only ids, folders and choices are stored:
// never messages (they stay in each CLI's transcript) and never secrets. Writes are atomic (tmp + rename); a corrupt
// file is set aside as chats.json.bad-<time> instead of being lost. Used by manager.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { Effort, Harness, PermissionMode } from '../../shared/contract';
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
  permissionMode: PermissionMode;
  isRegia: boolean;
  createdAt: number;
  /** the CLI's running cost total last seen, for per-turn deltas after a resume */
  costTotalUsd?: number;
}

const HARNESSES: readonly string[] = ['claude', 'cursor'];
const MODES: readonly string[] = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'];
const EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max'];

function valid(x: unknown): StoredChat | null {
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
    permissionMode: MODES.includes(String(c.permissionMode)) ? (c.permissionMode as PermissionMode) : 'default',
    isRegia: c.isRegia === true,
    createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
    ...(typeof c.costTotalUsd === 'number' && Number.isFinite(c.costTotalUsd) ? { costTotalUsd: c.costTotalUsd } : {}),
  };
}

export class ChatStore {
  readonly file: string;
  constructor(userData: string) { this.file = path.join(userData, 'chats.json'); }

  load(): StoredChat[] {
    let text: string;
    try { text = fs.readFileSync(this.file, 'utf8'); } catch { return []; }
    try {
      const data = JSON.parse(text) as { chats?: unknown };
      return (Array.isArray(data.chats) ? data.chats : []).map(valid).filter((c): c is StoredChat => !!c);
    } catch (e) {
      const bad = `${this.file}.bad-${Date.now()}`;
      try { fs.renameSync(this.file, bad); } catch { /* keep it */ }
      log.error('chats', 'chats.json unreadable, starting empty', { cause: errText(e), hint: `the old file is kept as ${bad}; fix or delete it` });
      return [];
    }
  }

  save(chats: StoredChat[]): void {
    const body = `${JSON.stringify({ version: 1, chats }, null, 2)}\n`;
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
