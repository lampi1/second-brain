// The Gmail reader of the scheduled activities (ADR 0373): an ActivitySourceReader that reads the mailbox through Google's
// official remote MCP (https://gmailmcp.googleapis.com/mcp/v1, scope gmail.readonly) added by the user in Impostazioni →
// Connettori, at zero tokens: no model is involved. It asks `search_threads` with a Gmail query built from the cursor and
// the activity's filter, maps the threads to ActivityItems (one per thread: its newest message) and, only when a thread
// came without sender, subject or time, asks `get_message` for it. It calls ONLY the read-only tools (READ_ONLY_TOOLS);
// any other name throws before leaving the module, so a write tool (send, label, trash...) is never reachable from here.
// Mail bodies are never put in an item (the snippet only) and never logged. The MCP call itself is injected (GmailDeps),
// so this module is pure mapping + orchestration: the engine wires `call` to the app's MCP client (tools/call on the
// connector's server id) and the tests use fakes. The connector's answer shape is parsed defensively (Gmail API style or
// flat fields) because it was not yet seen live: check it once against the real connector. Used by: main/activities (the
// engine), test/unit/activities-gmail.test.ts.
import type { Activity, ActivityCursor, ActivityFilter, ActivityItem, ActivityReadResult, ActivitySourceReader } from '../../../shared/activities';

/** The only tools of Google's Gmail MCP this reader may call (verified with tools/list, 2026-11-28). */
export const READ_ONLY_TOOLS = ['search_threads', 'get_thread', 'get_message', 'list_labels', 'list_drafts', 'get_draft', 'list_filters'] as const;

/** What `tools/call` answers (the shape of the app's MCP client CallResult). */
export interface GmailCallResult { content?: unknown[]; isError?: boolean; structuredContent?: unknown }

export interface GmailDeps {
  /** the id of the user's Gmail connector in Connettori, from the activity's config; null = not added */
  serverId(activity: Activity): string | null;
  /** tools/call on that server; may throw (the reader turns it into `error`) */
  call(serverId: string, tool: string, args: Record<string, unknown>): Promise<GmailCallResult>;
}

/** Threads asked per run, and `get_message` completions per run: a run never costs more than this many calls. */
export const GMAIL_THREADS_MAX = 25;
export const GMAIL_COMPLETIONS_MAX = 10;
const SNIPPET_MAX = 300;
const FIRST_RUN_WINDOW = 'newer_than:1d';
/** Looks back one extra second so that mails at the cursor's own second are not missed (the engine drops the seen ones). */
const CURSOR_OVERLAP_S = 1;

export class GmailWriteBlocked extends Error {
  constructor(tool: string) { super(`Gmail reader: «${tool}» is not a read-only tool`); this.name = 'GmailWriteBlocked'; }
}

/** The only door to the connector: refuses any tool outside READ_ONLY_TOOLS before calling. */
export async function callReadOnly(deps: GmailDeps, serverId: string, tool: string, args: Record<string, unknown>): Promise<GmailCallResult> {
  if (!(READ_ONLY_TOOLS as readonly string[]).includes(tool)) throw new GmailWriteBlocked(tool);
  return deps.call(serverId, tool, args);
}

// ---- the query ---------------------------------------------------------------------------------------------------------

const quote = (s: string): string => `"${s.replace(/["\\]/g, ' ').trim()}"`;
const anyOf = (op: string, words: readonly string[]): string => `${op}:(${words.map(quote).join(' OR ')})`;

/** The Gmail search for what is new and may pass the filter: the engine's filter still runs after, so this only narrows the
 *  read (fewer threads, same result). `after:` takes epoch seconds. */
export function buildQuery(filter: ActivityFilter, cursor: ActivityCursor): string {
  const parts = [cursor.at > 0 ? `after:${Math.max(0, Math.floor(cursor.at / 1000) - CURSOR_OVERLAP_S)}` : FIRST_RUN_WINDOW];
  if (filter.unreadOnly) parts.push('is:unread');
  if (filter.senders.length) parts.push(anyOf('from', filter.senders));
  if (filter.subjectWords.length) parts.push(anyOf('subject', filter.subjectWords));
  if (filter.excludeNoReply) parts.push('-from:(noreply OR no-reply OR donotreply OR do-not-reply)');
  return parts.join(' ');
}

// ---- parsing the connector's answer -------------------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The JSON a tool answered: structuredContent, else the first text block that parses; null when neither. */
export function payloadOf(r: GmailCallResult): unknown {
  if (r.structuredContent !== undefined && r.structuredContent !== null) return r.structuredContent;
  for (const c of r.content ?? []) {
    if (isObj(c) && c.type === 'text' && typeof c.text === 'string') {
      try { return JSON.parse(c.text); } catch { /* not JSON: try the next block */ }
    }
  }
  return null;
}

/** A message as the connector may give it (Gmail API style: payload.headers + labelIds + internalDate, or flat fields). */
export interface GmailMessage { id: string; threadId: string; at: number; from: string; subject: string; snippet: string; labels: string[] }

function headerOf(m: Record<string, unknown>, name: string): string {
  const flat = str(m[name]) || str(m[name.toLowerCase()]);
  if (flat) return flat;
  const payload = isObj(m.payload) ? m.payload : m;
  const headers = Array.isArray(payload.headers) ? payload.headers : [];
  for (const h of headers) if (isObj(h) && str(h.name).toLowerCase() === name.toLowerCase()) return str(h.value);
  return '';
}

function timeOf(m: Record<string, unknown>): number {
  const raw = m.internalDate ?? m.date ?? m.receivedAt ?? m.timestamp;
  if (typeof raw === 'number') return raw < 1e11 ? raw * 1000 : raw;
  if (typeof raw === 'string' && raw) {
    if (/^\d+$/.test(raw)) { const n = Number(raw); return n < 1e11 ? n * 1000 : n; }
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((l): l is string => typeof l === 'string') : []);

/** One message object → GmailMessage; null without an id. The body is never taken, only the snippet. */
export function parseMessage(raw: unknown, threadId = ''): GmailMessage | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id) || str(raw.messageId);
  if (!id) return null;
  const labels = stringList(raw.labelIds).length ? stringList(raw.labelIds) : stringList(raw.labels);
  return { id, threadId: str(raw.threadId) || threadId, at: timeOf(raw), from: headerOf(raw, 'From'), subject: headerOf(raw, 'Subject'), snippet: str(raw.snippet).replace(/\s+/g, ' ').trim().slice(0, SNIPPET_MAX), labels };
}

/** The newest message of each thread in a search_threads answer ({ threads: [{ id, messages?, snippet? }] }). A thread with
 *  no message list becomes a stub from its own fields; an empty from, subject or time is completed by get_message. */
export function parseThreads(payload: unknown): GmailMessage[] {
  const threads = isObj(payload) && Array.isArray(payload.threads) ? payload.threads : Array.isArray(payload) ? payload : [];
  const out: GmailMessage[] = [];
  for (const t of threads) {
    if (!isObj(t)) continue;
    const threadId = str(t.id) || str(t.threadId);
    const msgs = (Array.isArray(t.messages) ? t.messages : []).map(m => parseMessage(m, threadId)).filter((m): m is GmailMessage => m !== null);
    if (msgs.length) { out.push(msgs.reduce((a, b) => (b.at >= a.at ? b : a))); continue; }
    const stub = parseMessage({ ...t, id: str(t.lastMessageId) || str(t.messageId) || threadId }, threadId);
    if (stub) out.push(stub);
  }
  return out;
}

// ---- mapping to an activity item --------------------------------------------------------------------------------------

/** A mail is «for me» when Gmail files it as personal: not a promotion, social, update or forum category, not spam. Gmail
 *  has no @mention, so this is the closest zero-token signal for the filter's mentionsOnly. */
const isPersonal = (labels: readonly string[]): boolean => !labels.some(l => (l.startsWith('CATEGORY_') && l !== 'CATEGORY_PERSONAL') || l === 'SPAM');

export function toItem(m: GmailMessage): ActivityItem {
  return {
    key: m.id, at: m.at, from: m.from, title: m.subject || '(senza oggetto)', text: m.snippet,
    unread: m.labels.includes('UNREAD'), mentionsMe: isPersonal(m.labels),
    url: m.threadId ? `https://mail.google.com/mail/u/0/#all/${m.threadId}` : undefined,
  };
}

/** The user's words for a failure. Never includes the connector's text (it may quote mail content). */
export function describeFailure(detail: string): string {
  if (/401|403|unauthor|forbidden|expired|invalid_grant|token|login|sign.?in/i.test(detail)) return 'accesso Gmail scaduto: ricollega il connettore in Impostazioni → Connettori';
  if (/not found|unknown server|no such server|not connected|disconnected/i.test(detail)) return 'connettore Gmail non collegato';
  if (/timeout|timed out|ECONN|ENOTFOUND|network|fetch failed/i.test(detail)) return 'Gmail non raggiungibile';
  return 'lettura di Gmail non riuscita';
}

const textOf = (r: GmailCallResult): string => (r.content ?? []).map(c => (isObj(c) ? str(c.text) : '')).join(' ').slice(0, 300);

// ---- the reader --------------------------------------------------------------------------------------------------------

const needsCompletion = (m: GmailMessage): boolean => !m.from || !m.subject || m.at === 0;

export function createGmailReader(deps: GmailDeps): ActivitySourceReader {
  return {
    source: 'gmail',
    async read(activity, cursor): Promise<ActivityReadResult> {
      const serverId = deps.serverId(activity);
      if (!serverId) return { items: [], error: 'connettore Gmail non collegato: aggiungilo in Impostazioni → Connettori' };
      try {
        const res = await callReadOnly(deps, serverId, 'search_threads', { query: buildQuery(activity.filter, cursor), pageSize: GMAIL_THREADS_MAX, maxResults: GMAIL_THREADS_MAX });
        if (res.isError) return { items: [], error: describeFailure(textOf(res)) };
        const found = parseThreads(payloadOf(res)).slice(0, GMAIL_THREADS_MAX);
        let completions = 0;
        const messages: GmailMessage[] = [];
        for (const m of found) {
          if (needsCompletion(m) && completions < GMAIL_COMPLETIONS_MAX) {
            completions++;
            const got = await callReadOnly(deps, serverId, 'get_message', { messageId: m.id });
            const full = got.isError ? null : parseMessage(payloadOf(got), m.threadId);
            messages.push(full ? { ...full, threadId: full.threadId || m.threadId, labels: full.labels.length ? full.labels : m.labels } : m);
          } else messages.push(m);
        }
        return { items: messages.filter(m => m.at > 0).map(toItem) };
      } catch (e) {
        if (e instanceof GmailWriteBlocked) throw e;
        return { items: [], error: describeFailure(e instanceof Error ? e.message : String(e)) };
      }
    },
  };
}
