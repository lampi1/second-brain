// German (de-AT, informal "du") texts of the chat composer's inline suggestion (issue #167, ADR 0118); same keys as
// suggest.it.ts. Spread into i18n/de.ts.
import type { suggestIt } from './suggest.it';
export const suggestDe: typeof suggestIt = {
  'suggest.srHint': (p: { text: string }) => `Vorschlag: „${p.text}“. Tab übernimmt ihn, Esc blendet ihn aus.`,
  'suggest.group': 'Schreiben',
  'suggest.groupDesc': 'Wie dir die App beim Schreiben in den Chats hilft.',
  'suggest.title': 'Vorschläge beim Tippen',
  'suggest.hint': 'Grauer Text nach dem Cursor: Tab übernimmt ihn, Esc blendet ihn aus, jede andere Taste ignoriert ihn. Aus deinen früheren Nachrichten, den „/“-Befehlen, den Rollen, den Chats und den Dateien: null Tokens.',
};
