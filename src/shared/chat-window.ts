// Renderer transcript projection: keep every item/context in the 600-item tail, budget bulky raw tool outputs.
// Full output stays in the host; opening its row fetches that one original item. Never trim prose, prompts or grants.
import { devopsUrls } from './devops-urls';
import type { ChatItem } from './contract';
export const CHAT_WINDOW_ITEMS = 600;
export const CHAT_WINDOW_BYTES = 1024 * 1024;
// Only raw CLI/file outputs: app/MCP results include cards, reports and routing metadata and must remain intact.
const RAW_OUTPUT = new Set(['Read', 'Grep', 'Glob', 'Search', 'LS', 'List', 'Bash', 'PowerShell', 'Shell']);
export function chatWindow(items: readonly ChatItem[], limit = CHAT_WINDOW_ITEMS, maxBytes = CHAT_WINDOW_BYTES): ChatItem[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > CHAT_WINDOW_ITEMS || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > CHAT_WINDOW_BYTES) throw new Error('Invalid transcript window');
  const tail = items.slice(-limit);
  const chars = Math.max(1, Math.floor(maxBytes / (2 * limit)));
  return tail.map(item => {
    if (item.kind !== 'tool' || !RAW_OUTPUT.has(item.name) || !item.output || item.output.length <= chars) return item;
    // Copy rather than retain a V8 sliced string's multi-MB backing store.
    return { ...item, output: item.output.slice(0, chars).split('').join(''), outputPreviewChars: item.outputPreviewChars ?? item.output.length, outputUrls: item.outputUrls ?? devopsUrls(item.output) };
  });
}
/** Explicit detail reads preserve the original item, including its full output; ordinary IPC remains compatible. */
export function chatItemsReply(items: ChatItem[], args: { itemId?: string; limit?: number; maxBytes?: number }): ChatItem[] {
  if (args.itemId !== undefined) return items.filter(item => item.id === args.itemId);
  return args.limit === undefined && args.maxBytes === undefined ? items : chatWindow(items, args.limit, args.maxBytes);
}
