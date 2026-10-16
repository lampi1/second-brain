// "Correggi il pensiero" (ADR 0058): the user selects a sentence in a chat's reasoning and writes a short correction.
// This file holds the message the chat gets (the sentence quoted: Claude's transcript keeps no thinking text, so the quote
// is how it knows what it thought), its reading back for the bubble, the sentences to mark in the reasoning blocks, and
// when a correction may not go (an open question or permission: stopping the turn would cancel it). Pure: no React, no
// store. Used by store.ts (correctThought) and ChatItems.tsx (the Ragionamento block, the correction bubble).
import type { ChatItem, ChatSummary } from '@shared/contract';
import { splitNotes } from './sendable';

// in English, like every prompt the app injects into a chat (i18n rule); the user's fix stays in their own words
export const CORRECTION_TAG = '[Reasoning correction]';
/** the longest quote sent: a whole paragraph selected is cut, its start is enough to find it */
export const QUOTE_MAX = 400;

/** The selected text as one line, cut at QUOTE_MAX (the guillemets around it are made plain quotes). */
export function cleanQuote(s: string): string {
  const t = s.replace(/[«»]/g, '"').replace(/\s+/g, ' ').trim();
  return t.length > QUOTE_MAX ? `${t.slice(0, QUOTE_MAX - 1)}…` : t;
}

/** The message the chat gets. */
export function correctionText(quote: string, fix: string): string {
  return `${CORRECTION_TAG}\nIn your reasoning you wrote: «${cleanQuote(quote)}»\nNot like that: ${fix.trim()}\nRedo this step taking the correction into account.`;
}

const PARSE = [
  /^\[Reasoning correction\]\nIn your reasoning you wrote: «([^»]*)»\nNot like that: ([\s\S]*?)\nRedo this step taking the correction into account\.$/,
  // the first, Italian format: corrections already sent keep their bubble
  /^\[Correzione del ragionamento\]\nNel tuo ragionamento hai scritto: «([^»]*)»\nNo, così: ([\s\S]*?)\nRifai questo passo tenendo conto della correzione\.$/,
];

/** A user message that is a correction: its quote and fix (null: any other message). */
export function parseCorrection(text: string): { quote: string; fix: string } | null {
  const t = text.replace(/\r\n/g, '\n').trim();
  for (const re of PARSE) {
    const m = re.exec(t);
    if (m) return { quote: m[1] ?? '', fix: m[2] ?? '' };
  }
  return null;
}

/** Where a quote sits in a reasoning text (whitespace may differ: the quote is one line), or null. */
export function findQuote(text: string, quote: string): { start: number; end: number } | null {
  const words = quote.replace(/…$/, '').split(' ').filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return null;
  const m = new RegExp(words.join('\\s+')).exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

/** The text cut into plain and marked pieces, one mark per quote found (overlaps: the first wins). */
export function markPieces(text: string, quotes: readonly string[]): { text: string; mark: boolean }[] {
  const spans = quotes.map(q => findQuote(text, q)).filter((x): x is { start: number; end: number } => !!x).sort((a, b) => a.start - b.start);
  const out: { text: string; mark: boolean }[] = [];
  let at = 0;
  for (const s of spans) {
    if (s.start < at) continue;
    if (s.start > at) out.push({ text: text.slice(at, s.start), mark: false });
    out.push({ text: text.slice(s.start, s.end), mark: true });
    at = s.end;
  }
  if (at < text.length || !out.length) out.push({ text: text.slice(at), mark: false });
  return out;
}

/** For each reasoning block, the sentences the user corrected: each correction marks the latest reasoning before it
 *  that holds its quote. */
export function correctedThoughts(items: readonly ChatItem[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  items.forEach((it, i) => {
    if (it.kind !== 'user') return;
    const c = parseCorrection(splitNotes(it.text).text); // notes may ride on it (Mandato, Copiato)
    if (!c) return;
    for (let j = i - 1; j >= 0; j--) {
      const t = items[j];
      if (t?.kind === 'thinking' && findQuote(t.text, c.quote)) { out.set(t.id, [...(out.get(t.id) ?? []), c.quote]); return; }
    }
  });
  return out;
}

/** Why a correction cannot go now (null: it can). An open question or permission would be cancelled by the stop. */
export function correctionBlocked(chat: ChatSummary | undefined, asking: boolean): string | null {
  if (!chat) return 'La chat non c’è più.';
  if (asking || chat.state === 'waiting' || chat.pending > 0) return 'La chat aspetta una tua risposta: rispondi prima al pannello, poi correggi.';
  return null;
}

/** Only Claude takes a message in the middle of a turn (after its next tool step); Cursor and the API engines get it
 *  after the turn, so for them the correction always stops the turn. */
export const canCorrectAtNextStep = (chat: ChatSummary | undefined): boolean => chat?.harness === 'claude';
