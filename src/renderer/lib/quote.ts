// Quote what is on screen (ADR 0300): the user selects a text anywhere in the app and right-clicks on it; the
// selection goes, as «> » lines, at the end of a prompt field, not sent. Pure: what counts as a quote click (quoteAt,
// read through the few DOM members it needs, so it is tested with fakes), how the lines look (quoteBlock) and where
// they go in a draft (draftWithQuote, before a reviewed context). Used by actions.ts startQuote, which listens for
// the right click, and by ChatInput.tsx quoteInDraft, which owns the drafts.
import { reviewedContextDraft, withReviewedContext } from './reviewed-context';

/** the longest quote, in characters: a whole page selected by mistake does not flood the prompt */
export const QUOTE_MAX = 6000;
/** how far outside the selected lines a right click still counts as «on the selection», in px */
const PAD = 4;

/** The selected text as markdown quote lines; '' when there is nothing to quote. */
export function quoteBlock(selected: string): string {
  let text = selected.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
  if (!text.trim()) return '';
  if (text.length > QUOTE_MAX) {
    const cut = text.slice(0, QUOTE_MAX);
    // never half of a character made of two (an emoji on the limit)
    text = `${(/[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut).trimEnd()} […]`;
  }
  return text.split('\n').map(line => (line ? `> ${line}` : '>')).join('\n');
}

/** The draft with the quote after what was already written, and an empty line under it for the answer. A reviewed
 *  context (lib/reviewed-context.ts) stays last, as its payload must. The draft itself when there is nothing to quote. */
export function draftWithQuote(draft: string, selected: string): string {
  const block = quoteBlock(selected);
  if (!block) return draft;
  const context = reviewedContextDraft(draft);
  const before = (context ? context.message : draft).trimEnd();
  return withReviewedContext(`${before ? `${before}\n\n` : ''}${block}\n\n`, context);
}

interface RectLike { left: number; right: number; top: number; bottom: number }
interface NodeLike { nodeType: number; parentElement?: unknown; closest?: (selector: string) => unknown; getAttribute?: (name: string) => string | null }
/** what quoteAt reads of the page's Selection */
export interface SelectionLike {
  isCollapsed: boolean;
  rangeCount: number;
  toString(): string;
  getRangeAt(index: number): { commonAncestorContainer: unknown; getClientRects(): ArrayLike<RectLike>; intersectsNode(node: never): boolean };
}
export interface QuoteHit { text: string; /** the chat the selected text is in, when it is inside one */ chatId: string | null }

const elementOf = (node: unknown): NodeLike | null => {
  const n = node as NodeLike | null;
  if (!n || typeof n !== 'object') return null;
  return n.nodeType === 1 ? n : (n.parentElement as NodeLike | null | undefined) ?? null;
};

/** A right click at (x, y) on `target`: the quote it asks for, or null when it is a click like any other. It is a quote
 *  only when a text is selected, the click is on it (the thing clicked is part of the selection and the pointer is on
 *  one of its lines) and not in a field the user types in: a selection left somewhere else, or scrolled under another
 *  thing, never takes that thing's click (a little person's right click stays its own, ADR 0297). `pressed` is what
 *  was selected when the right button went down: where the press itself selects the word under it (macOS), that word
 *  is not a quote the user asked for. */
export function quoteAt(selection: SelectionLike | null, target: unknown, x: number, y: number, pressed: string | null): QuoteHit | null {
  if (!selection || selection.isCollapsed || selection.rangeCount < 1) return null;
  const clicked = elementOf(target);
  if (!clicked || clicked.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return null;
  const text = selection.toString();
  if (!text.trim() || text !== pressed) return null;
  const range = selection.getRangeAt(0);
  if (!range.intersectsNode(target as never)) return null;
  const rects = Array.from(range.getClientRects());
  if (!rects.some(r => x >= r.left - PAD && x <= r.right + PAD && y >= r.top - PAD && y <= r.bottom + PAD)) return null;
  const chat = elementOf(range.commonAncestorContainer)?.closest?.('[data-chat-id]') as NodeLike | null | undefined;
  return { text, chatId: chat?.getAttribute?.('data-chat-id') || null };
}
