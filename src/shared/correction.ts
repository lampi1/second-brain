// The "Correggi il pensiero" message tag (ADR 0058), shared: the renderer writes it (renderer/lib/correction.ts) and main
// counts it as Brother's correction of an agent run (AGENTS-DESIGN §5).

// in English, like every prompt the app injects into a chat (i18n rule); the user's fix stays in their own words
export const CORRECTION_TAG = '[Reasoning correction]';
/** the first, Italian format: corrections already sent still count */
const LEGACY_TAG = '[Correzione del ragionamento]';

/** A user message that is a reasoning correction: it starts with the tag on its own line. */
export function isCorrection(text: string): boolean {
  const first = text.replace(/\r\n/g, '\n').trimStart().split('\n', 1)[0]!.trim();
  return first === CORRECTION_TAG || first === LEGACY_TAG;
}
