// English texts of the chat composer's inline suggestion (issue #167, ADR 0118); same keys as suggest.it.ts.
import type { suggestIt } from './suggest.it';
export const suggestEn: typeof suggestIt = {
  'suggest.srHint': (p: { text: string }) => `Suggestion: “${p.text}”. Tab accepts it, Esc hides it.`,
  'suggest.group': 'Writing',
  'suggest.groupDesc': 'How the app helps while you write in the chats.',
  'suggest.title': 'Suggestions while you type',
  'suggest.hint': 'Grey text after the cursor: Tab accepts it, Esc hides it, any other key ignores it. From your past messages, the “/” commands, the roles, the chats and the files: zero tokens.',
};
