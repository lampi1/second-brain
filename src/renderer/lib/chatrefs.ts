// The chats a Regia's transcript points to, found locally (no model, no tokens; ADR 0034): the chat an
// app_create_chat opened (its result: chatId, title), the chat an app_send_to_chat wrote to (its input's chatId), and
// the known chats an assistant message names (a title in «…», or a bare "Area · cosa" title). The chat view turns each
// into an "Apri" chip that brings that chat on screen from anywhere (actions.ts openChatRef). Pure: no React, no store.
// Used by ChatItems.tsx and ChatRefChips.tsx.
import type { ChatItem, ChatSummary } from '@shared/contract';

type Tool = Extract<ChatItem, { kind: 'tool' }>;

export interface ToolChatRef { chatId: string; title?: string; how: 'created' | 'sent' }

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
// Claude names the tool mcp__<server>__app_create_chat; Cursor calls an MCP call "Tool" with the name in its summary
// (only there: a shell line that greps for the name is not the call)
const isTool = (item: Tool, tool: string): boolean =>
  item.name === tool || item.name.endsWith(`__${tool}`) || (/^(?:Tool|MCP)$/i.test(item.name) && new RegExp(`(?:^|[^a-z_])${tool}\\b`).test(item.summary));

/** The chat a finished app_create_chat / app_send_to_chat is about; null for any other tool or a failed call. */
export function toolChatRef(item: Tool): ToolChatRef | null {
  if (item.status !== 'ok') return null;
  const input = item.input && typeof item.input === 'object' ? (item.input as Record<string, unknown>) : {};
  if (isTool(item, 'app_create_chat')) {
    const out = item.output ?? '';
    let chatId = '', title = '';
    try {
      const o = JSON.parse(out) as Record<string, unknown>;
      chatId = str(o.chatId); title = str(o.title);
    } catch {
      // a result cut or wrapped by the engine: the fields are still there as JSON text
      chatId = out.match(/"chatId"\s*:\s*"([^"]+)"/)?.[1] ?? '';
      title = out.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? '';
    }
    if (!chatId) return null;
    return { chatId, how: 'created', ...(title || str(input.title) ? { title: title || str(input.title) } : {}) };
  }
  if (isTool(item, 'app_send_to_chat')) {
    const chatId = str(input.chatId).trim();
    return chatId ? { chatId, how: 'sent' } : null;
  }
  return null;
}

/** title → chat id, for the chats an assistant message may name (not the Regie: they are a tab away already). */
export type TitleIndex = ReadonlyMap<string, string>;

/** A stable key of the work chats' titles (the store changes often; the index is rebuilt only when this does). */
export const titlesKey = (chats: Record<string, ChatSummary>): string =>
  Object.values(chats).filter(c => !c.isRegia && c.title.trim()).map(c => `${c.id}\t${c.title.trim()}`).sort().join('\n');

export function titleIndex(key: string): TitleIndex {
  const m = new Map<string, string>();
  for (const line of key ? key.split('\n') : []) {
    const [id, title] = line.split('\t') as [string, string];
    // two chats with one title: the name alone does not say which, so it gets no chip
    m.set(title, m.has(title) ? '' : id);
  }
  return m;
}

const MAX_REFS = 4;
const WORD = /[\p{L}\p{N}_]/u;

/** where a bare title stands as a whole (not the start of a longer title or word), -1 if nowhere */
function bareAt(text: string, title: string): number {
  for (let at = text.indexOf(title); at >= 0; at = text.indexOf(title, at + 1)) {
    const before = text[at - 1] ?? ' ', after = text[at + title.length] ?? ' ';
    if (!WORD.test(before) && !WORD.test(after)) return at;
  }
  return -1;
}

/** The known chats a message names, in the order they appear, at most four: «Title» exactly, or a bare title that has
 *  the "Area · cosa" shape (a short plain word like "Note" would match too much). `exclude`: already shown. */
export function textChatRefs(text: string, index: TitleIndex, exclude: readonly string[] = []): string[] {
  if (!index.size || !text) return [];
  const found: { at: number; id: string }[] = [];
  const seen = new Set(exclude);
  for (const [title, id] of index) {
    if (!id || seen.has(id)) continue;
    let at = text.indexOf(`«${title}»`);
    if (at < 0 && title.includes(' · ')) at = bareAt(text, title);
    if (at >= 0) { found.push({ at, id }); seen.add(id); }
  }
  return found.sort((a, b) => a.at - b.at).slice(0, MAX_REFS).map(f => f.id);
}

// per message: the answer for one titles key and exclusion (a streaming transcript asks again every frame; a finished
// message keeps its array, so its memoized row does not re-render)
const cache = new WeakMap<ChatItem, { sig: string; ids: string[] }>();
let lastIndex: { key: string; index: TitleIndex } = { key: '', index: new Map() };
const EMPTY: string[] = [];

/** For a Regia's transcript: assistant message id → the chats it names that the same turn's app_create_chat /
 *  app_send_to_chat rows do not already show. Streaming messages wait until they end. */
export function chatRefsOf(items: readonly ChatItem[], key: string): ReadonlyMap<string, string[]> {
  const out = new Map<string, string[]>();
  if (!key) return out;
  if (lastIndex.key !== key) lastIndex = { key, index: titleIndex(key) };
  const index = lastIndex.index;
  let shown: string[] = [];
  for (const it of items) {
    if (it.kind === 'user') shown = [];
    else if (it.kind === 'tool') { const r = toolChatRef(it); if (r) shown = [...shown, r.chatId]; }
    else if (it.kind === 'assistant' && !it.streaming) {
      const sig = `${key}\n${shown.join(',')}`;
      let c = cache.get(it);
      if (!c || c.sig !== sig) { const ids = textChatRefs(it.text, index, shown); c = { sig, ids: ids.length ? ids : EMPTY }; cache.set(it, c); }
      if (c.ids.length) out.set(it.id, c.ids);
    }
  }
  return out;
}
