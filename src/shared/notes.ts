// The note lines the user's clicks leave for a chat ("[Mandato] …", "[Copiato] …", "[Non serve] …"; ADR 0038): shared
// so main reads a message of notes only as the app's own (main/run/asks.ts: it is no answer to the commands the chat
// left, they stay open) and the renderer folds it (lib/foreign.ts, lib/sendable.ts). Pure.

/** A note line: "[Mandato] first words…" (also "[Copiato]", "[Non serve]"). */
export const NOTE_LINE = /^\[(Mandato|Copiato|Non serve)\] /;

/** A message made only of note lines (no text the user typed). */
export function isNotesOnly(text: string): boolean {
  const lines = text.trim().split('\n');
  return lines.length > 0 && lines.every(l => NOTE_LINE.test(l));
}
