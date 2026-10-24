// When the user last typed a message into a chat themselves (the renderer's chat:send, a sender-checked IPC from the
// app's own window): the one proof app_config takes that a configuration change is the user's ask (ADR 0149). A chat
// item of kind 'user' is not enough: the app's news, the Battito card, mail and other main-side sends land as 'user'
// items too. In memory only (a restart forgets it: the user asks again). Used by main/index.ts (note) and
// appctl/tools.ts (lastTyped).
const typed = new Map<string, number>();

/** The user typed and sent a message to this chat now. */
export function noteUserTyped(chatId: string, at = Date.now()): void {
  typed.set(chatId, at);
  if (typed.size > 200) typed.delete(typed.keys().next().value!);
}
/** When the user last typed into this chat, or undefined. */
export const lastTyped = (chatId: string): number | undefined => typed.get(chatId);
