// How a chat's items are laid out on screen (the owner, 2026-10-20). In an Orchestrator, its reasoning and tool rows
// fold behind one "Ragionamento" row (seen only when opened); a reply of one or two emoji (shared/reaction.ts) right
// after the user's own message sticks to that bubble as a small reaction, WhatsApp style, and stands alone (big)
// anywhere else. Pure, so the layout is unit tested. Used by ChatItems.tsx (ItemListFor).
import type { ChatItem } from '@shared/contract';
import { isReaction } from '@shared/reaction';
import { foreignOf } from './foreign';

export type ViewItem =
  | { kind: 'item'; item: ChatItem; reaction?: string }
  | { kind: 'process'; id: string; items: ChatItem[] };

/** The rows to draw: items in order, with reactions attached and (when foldProcess) thinking/tool runs grouped. */
export function chatView(items: readonly ChatItem[], { foldProcess }: { foldProcess: boolean }): ViewItem[] {
  const out: ViewItem[] = [];
  // the last own user message drawn, while nothing but folded process rows came after it
  let target: Extract<ViewItem, { kind: 'item' }> | null = null;
  for (const item of items) {
    if (foldProcess && (item.kind === 'thinking' || item.kind === 'tool')) {
      const prev = out[out.length - 1];
      if (prev?.kind === 'process') prev.items.push(item);
      else out.push({ kind: 'process', id: `process-${item.id}`, items: [item] });
      continue;
    }
    if (item.kind === 'assistant' && !item.streaming && isReaction(item.text) && target && !target.reaction) {
      target.reaction = item.text.trim();
      target = null;
      continue;
    }
    const row: Extract<ViewItem, { kind: 'item' }> = { kind: 'item', item };
    out.push(row);
    target = item.kind === 'user' && !item.from && !foreignOf(item) ? row : null;
  }
  return out;
}
