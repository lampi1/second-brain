// On-demand full raw output for an expanded tool row. The caller discards late replies on close or item changes.
import type { ChatItem } from '@shared/contract';
export async function readToolOutput(chatId: string, itemId: string, read: (args: { chatId: string; itemId: string }) => Promise<ChatItem[]>): Promise<string> {
  const items = await read({ chatId, itemId });
  const item = items.find(row => row.id === itemId && row.kind === 'tool');
  if (item?.kind !== 'tool' || item.output === undefined || item.outputPreviewChars !== undefined) throw new Error('Full tool output unavailable');
  return item.output;
}

/** Leading scheduled read with coalesced refreshes, never a trailing debounce that can starve under 100 ms streams. */
export function toolOutputLoader(read: () => Promise<string>, accept: (output: string) => void, fail: () => void) {
  let active = true, running = false, dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    if (!active) return;
    dirty = true;
    if (running || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!active) return;
      dirty = false; running = true;
      void read().then(output => { if (active) accept(output); }, () => { if (active) fail(); }).finally(() => {
        running = false; if (active && dirty) refresh();
      });
    }, 150);
  };
  return { refresh, dispose: () => { active = false; clearTimeout(timer); timer = undefined; } };
}
