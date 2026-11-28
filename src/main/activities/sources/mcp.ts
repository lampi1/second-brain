// «Attività pianificate» (ADR 0373): the generic reader of an app-managed MCP connector, at zero tokens. A source is
// described by data: the connector's server id, one read-only tool, how to build its arguments and how to map its answer
// to ActivityItems (the shape Gmail's reader also returns). outlookConfig and teamsConfig are the two shipped descriptions
// (Outlook: outlook_list_emails; Teams: teams_get_unread); their mappers accept the usual field names of a mail or chat
// answer, since the connectors' answer shapes are not fixed by the app. The call goes through the app's own MCP client
// (injected as `call`, tools/call). A connector the health machine holds back (needs-login / broken, src/main/mcp-servers/
// health.ts) is NOT called: the run ends as a visible error at once, so there is no retry storm; a refused login says to
// press «Accedi». Never throws for an expected failure. Used by service.ts via the integrator's wiring; tests:
// test/unit/activities-sources.test.ts.
import type { Activity, ActivityCursor, ActivityItem, ActivityReadResult, ActivitySource, ActivitySourceReader } from '../../../shared/activities';

export interface McpCallResult { content: unknown[]; isError?: boolean; structuredContent?: unknown }
/** tools/call of one server through the app's MCP client (opens the connector as a chat would, closes it after). */
export type McpCall = (server: string, tool: string, args: Record<string, unknown>) => Promise<McpCallResult>;

export interface McpSourceConfig {
  source: ActivitySource;
  server: string;
  tool: string;
  args: (activity: Activity, cursor: ActivityCursor, now: number) => Record<string, unknown>;
  map: (payload: unknown, now: number) => ActivityItem[];
}
export interface McpReaderDeps {
  call: McpCall;
  /** why the server is held back (needs-login / broken) in the user's words, null = it may be called */
  held?: (server: string) => string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The answer's payload: structuredContent, else the text parts as JSON, else the plain text. */
export function payloadOf(r: McpCallResult): unknown {
  if (r.structuredContent !== undefined) return r.structuredContent;
  const text = r.content.map(c => (isObj(c) && c.type === 'text' ? str(c.text) : '')).filter(Boolean).join('\n');
  try { return JSON.parse(text); } catch { return text; }
}

const LIST_KEYS = ['value', 'items', 'emails', 'messages', 'unread', 'mentions', 'activities', 'chats', 'results'];
/** The array of rows of an answer: the answer itself, or its first list under a usual key. */
export function rowsOf(payload: unknown): Record<string, unknown>[] {
  const list = Array.isArray(payload) ? payload : isObj(payload) ? LIST_KEYS.map(k => payload[k]).find(Array.isArray) : undefined;
  return Array.isArray(list) ? list.filter(isObj) : [];
}

/** ms of a time given as ISO text or a number (seconds or ms); `fallback` when it is neither. */
export function timeOf(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e11 ? v * 1000 : v;
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? fallback : t;
}

/** «Name <address>», the name or the address of a sender given as text or as {name, address} / {emailAddress: {...}}. */
export function senderOf(v: unknown): string {
  if (typeof v === 'string') return v;
  if (!isObj(v)) return '';
  const o = isObj(v.emailAddress) ? v.emailAddress : isObj(v.user) ? v.user : v;
  const name = str(o.name) || str(o.displayName), address = str(o.address) || str(o.email);
  return name && address ? `${name} <${address}>` : name || address;
}

const first = (o: Record<string, unknown>, keys: string[]): unknown => keys.map(k => o[k]).find(v => v !== undefined && v !== null && v !== '');

export function mapOutlook(payload: unknown, now: number): ActivityItem[] {
  return rowsOf(payload).flatMap(o => {
    const id = str(first(o, ['id', 'messageId']));
    if (!id) return [];
    const unread = o.isRead === false || o.unread === true || o.is_read === false;
    return [{ key: id, at: timeOf(first(o, ['receivedDateTime', 'received', 'date', 'sentDateTime']), now), from: senderOf(first(o, ['from', 'sender'])),
      title: str(first(o, ['subject', 'title'])), text: str(first(o, ['bodyPreview', 'preview', 'snippet', 'body'])), unread, mentionsMe: false, ...(str(o.webLink) ? { url: str(o.webLink) } : {}) }];
  });
}

export function mapTeams(payload: unknown, now: number): ActivityItem[] {
  return rowsOf(payload).flatMap(o => {
    const id = str(first(o, ['id', 'messageId']));
    if (!id) return [];
    const mention = first(o, ['mentionsMe', 'isMention', 'mentioned', 'mention']);
    return [{ key: id, at: timeOf(first(o, ['createdDateTime', 'createdAt', 'timestamp', 'at', 'date']), now), from: senderOf(first(o, ['from', 'sender', 'author'])),
      title: str(first(o, ['chatTopic', 'topic', 'chat', 'channel', 'title', 'subject'])), text: str(first(o, ['text', 'content', 'preview', 'body', 'message'])),
      unread: o.isRead === false || o.unread === true || (o.isRead === undefined && o.unread === undefined), mentionsMe: mention === true, ...(str(o.webUrl) ? { url: str(o.webUrl) } : {}) }];
  });
}

/** Outlook through outlook-msoutlook-mcp: the newest 50 of the Inbox (only unread when the filter says so); never marks read. */
export const outlookConfig = (server = 'outlook-msoutlook-mcp'): McpSourceConfig => ({
  source: 'outlook', server, tool: 'outlook_list_emails', map: mapOutlook,
  args: a => ({ top: 50, unread_only: a.filter.unreadOnly, mark_read: false }),
});

/** Teams through teams-msteams-mcp: the unread chat messages and mentions. */
export const teamsConfig = (server = 'teams-msteams-mcp', tool = 'teams_get_unread'): McpSourceConfig => ({ source: 'teams', server, tool, map: mapTeams, args: () => ({}) });

/** What a call failure says in the user's words: the client's errors carry `code` (auth, network, timeout, spawn, ...). */
function failureText(source: ActivitySource, e: unknown): string {
  const code = isObj(e) ? e.code : undefined;
  const msg = e instanceof Error ? e.message : String(e);
  if (code === 'auth') return 'accesso scaduto: premi «Accedi» sulla scheda del connettore in Impostazioni → Connettori';
  if (code === 'network' || code === 'timeout') return `il connettore non risponde (${msg})`;
  return `lettura non riuscita: ${msg} (${source})`;
}

export function mcpReader(cfg: McpSourceConfig, deps: McpReaderDeps): ActivitySourceReader {
  return {
    source: cfg.source,
    async read(activity, cursor, now): Promise<ActivityReadResult> {
      const held = deps.held?.(cfg.server);
      if (held) return { items: [], error: held };
      try {
        const r = await deps.call(cfg.server, cfg.tool, cfg.args(activity, cursor, now));
        if (r.isError) return { items: [], error: `il connettore ha risposto con un errore: ${String(payloadOf(r)).slice(0, 200)}` };
        return { items: cfg.map(payloadOf(r), now) };
      } catch (e) { return { items: [], error: failureText(cfg.source, e) }; }
    },
  };
}
