// "Nuova chat" from an Orchestrator's input (ADR 0034): the user ticks it and the message goes to the Orchestrator with a first line
// that tells her to open a NEW work chat for the request (her usual app_create_chat), not to do the work herself.
// The line names its own meaning, so it works even where the MCP instructions (NEW_CHAT_RULE) do not reach the model;
// the chat view hides it and shows a "Nuova chat" badge instead. Pure. Used by ChatInput/ChatItems (renderer),
// main/wiring.ts (the Orchestrator's MCP instructions) and the demo's Orchestrator.

/** the machine-readable tag that starts the first line */
export const NEW_CHAT_TAG = '[nuova chat]';

/** the whole first line the Orchestrator reads */
export const NEW_CHAT_LINE = `${NEW_CHAT_TAG} Apri una nuova chat di lavoro per questa richiesta con app_create_chat (titolo, cartella, modello e brief come sempre) e non farla tu; poi rispondimi con una riga.`;

/** the same rule for the Orchestrator's MCP instructions */
export const NEW_CHAT_RULE = `A user message whose first line starts with "${NEW_CHAT_TAG}" asks for a NEW work chat: open it with app_create_chat (your usual title, cwd, model and brief) for the request below that line, do not do the work yourself, then answer in one line.`;

const LINE = /^\[nuova chat\][^\n]*(?:\n+|$)/;

/** The message as the Orchestrator gets it. */
export const withNewChat = (text: string): string => `${NEW_CHAT_LINE}\n\n${text.trim()}`;

/** Whether a message asks for a new chat, and what the user wrote (the tag line removed). */
export function splitNewChat(text: string): { newChat: boolean; text: string } {
  const m = text.match(LINE);
  return m ? { newChat: true, text: text.slice(m[0].length) } : { newChat: false, text };
}
