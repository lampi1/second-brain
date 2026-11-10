// The envelope a Claude engine gets around a message the user did not type (ADR 0261): an agent's mail, a delegated
// contract, the app's resume, wake-ups and notices go inside <agent-message from="second-brain">…</agent-message>, so
// a project's own UserPromptSubmit hooks (AI-DLC's record-human-turn) tell them from the user's turns. The whole text
// is the block: such hooks match the trimmed prompt end to end. The user's typed text never gets it. Used by
// chats/manager.ts (deliverNow), chats/manager-continuity.ts (the app's own quiet turns) and chats/transcript.ts
// (history shows the message without the envelope).

export const AGENT_MESSAGE_FROM = 'second-brain';
const OPEN = `<agent-message from="${AGENT_MESSAGE_FROM}">`;
const CLOSE = '</agent-message>';

/** The text inside the envelope, whole: the block starts and ends the prompt. */
export function agentMessage(text: string): string {
  return `${OPEN}\n${text.trim()}\n${CLOSE}`;
}

/** What goes to the engine: wrapped only for a Claude engine and a message that is not the user's own. */
export function forEngine(text: string, opts: { claude: boolean; relayed: boolean }): string {
  return opts.claude && opts.relayed ? agentMessage(text) : text;
}

/** A transcript row as the app sent it, without the app's envelope (any other text unchanged). */
export function withoutAgentMessage(raw: string): string {
  const t = raw.trim();
  if (!t.startsWith(`${OPEN}\n`) || !t.endsWith(`\n${CLOSE}`)) return raw;
  return t.slice(OPEN.length + 1, t.length - CLOSE.length - 1);
}
