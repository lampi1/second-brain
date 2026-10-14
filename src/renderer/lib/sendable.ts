// "Mandato": which code blocks of a chat message are a text for the user to send (a mail, a Teams message, a DevOps or
// PR comment: agents put them in a fenced block, me.md "Un testo da approvare o copiare … in blocco di codice"), and the
// short lines that tell the chat what the user did with them. Why: the user, 2026-10-13: "quando ti chiedo cose da
// mandare mettimi sempre un pulsantino 'mandato' in modo che ti segni che l'ho fatto, e devi capire meglio da sola
// quando finisco di fare qualcosa". The line never carries the block, only its first line cut to ~60 characters with
// long token-like words masked (no secrets leave the block). Pure: no React, no store. Used by CodeBlock.tsx (the
// buttons), store/store.ts (the notes that ride on the chat's next message), lib/foreign.ts and ChatItems.tsx (the
// folded line). ADR 0038.

/** Languages of a text to send: none, or one of these tags. Shell, SQL and code blocks never are. */
const TEXT = new Set(['', 'text', 'txt', 'plain', 'plaintext', 'markdown', 'md', 'mail', 'email', 'e-mail', 'teams', 'message', 'msg', 'comment']);

export function isSendable(lang: string | null | undefined): boolean {
  return TEXT.has((lang ?? '').trim().toLowerCase());
}

export type NoteKind = 'sent' | 'copied' | 'dismissed';
export const NOTE_TAG: Record<NoteKind, string> = { sent: 'Mandato', copied: 'Copiato', dismissed: 'Non serve' };
import { NOTE_LINE } from '@shared/notes';
export { NOTE_LINE };

/** How long a click on Mandato can be undone before the chat is told. */
export const UNDO_MS = 5000;
const MAX = 60;

/** The block's first non-empty line, one line, at most ~60 characters, words that look like tokens or keys masked. */
export function firstWords(code: string, max = MAX): string {
  const line = code.split('\n').map(l => l.trim()).find(Boolean) ?? '';
  const t = line.replace(/\S{24,}/g, w => (/^https?:\/\//i.test(w) ? w.replace(/[?#].*$/, '') : '[…]')).replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export const noteLine = (kind: NoteKind, code: string): string => `[${NOTE_TAG[kind]}] ${firstWords(code) || '(blocco vuoto)'}`;

/** A user message whose last lines are notes: the user's own text and the notes, apart (the bubble shows the notes as
 *  one muted line). A message made only of notes gives text ''. */
export function splitNotes(text: string): { text: string; notes: string[] } {
  const lines = text.split('\n');
  let i = lines.length;
  while (i > 0 && NOTE_LINE.test(lines[i - 1]!)) i--;
  if (i === lines.length) return { text, notes: [] };
  return { text: lines.slice(0, i).join('\n').trimEnd(), notes: lines.slice(i) };
}

/** A short stable id of a block: its chat and a hash of its text. Not the message id: a transcript read back after a
 *  restart gives its messages new ids, and the mark must still be there (the same text twice in one chat shares it). */
export function blockKey(chatId: string, code: string): string {
  let h = 5381;
  const s = code.replace(/\r\n/g, '\n').trimEnd();
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${chatId}/${(h >>> 0).toString(36)}`;
}

/** "14:05" */
export const hhmm = (at: number): string => {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
