// On-demand full raw output for an expanded tool row. The caller discards late replies on close or item changes.
import type { ChatItem } from '@shared/contract';
export async function readToolOutput(chatId: string, itemId: string, read: (args: { chatId: string; itemId: string }) => Promise<ChatItem[]>): Promise<string> {
  const items = await read({ chatId, itemId });
  const item = items.find(row => row.id === itemId && row.kind === 'tool');
  if (item?.kind !== 'tool' || item.output === undefined || item.outputPreviewChars !== undefined) throw new Error('Full tool output unavailable');
  return item.output;
}
