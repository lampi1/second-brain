// Bounded transcript windows for renderer IPC and its live reducer. Durable transcripts are never changed.
// Account for UTF-16 strings and object overhead without serializing every old tool result on each streamed token.
import type { ChatItem } from './contract';
export const CHAT_WINDOW_ITEMS = 600;
export const CHAT_WINDOW_BYTES = 1024 * 1024;
const sizes = new WeakMap<object, number>();
function size(value: unknown): number {
  if (typeof value === 'string') return 24 + value.length * 2;
  if (!value || typeof value !== 'object') return 8;
  const cached = sizes.get(value);
  if (cached !== undefined) return cached;
  let bytes = 64;
  // ChatItem is a JSON value; the sentinel also makes malformed cyclic objects finite.
  sizes.set(value, bytes);
  for (const [key, child] of Object.entries(value)) bytes += key.length * 2 + size(child);
  sizes.set(value, bytes);
  return bytes;
}
/** Contiguous newest tail. Keep a single oversized newest item intact: never silently mutilate a question/report. */
export function chatWindow(items: readonly ChatItem[], limit = CHAT_WINDOW_ITEMS, maxBytes = CHAT_WINDOW_BYTES): ChatItem[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > CHAT_WINDOW_ITEMS || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > CHAT_WINDOW_BYTES) throw new Error('Invalid transcript window');
  let start = items.length, bytes = 0;
  while (start > 0 && items.length - start < limit) {
    const next = size(items[start - 1]!);
    if (start < items.length && bytes + next > maxBytes) break;
    bytes += next; start--;
  }
  return items.slice(start);
}
