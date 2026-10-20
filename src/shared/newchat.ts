// How a message to an Orchestrator should be handled, chosen in its input (ADR 0034, revised 2026-10-20 by the owner:
// «il pulsante nuova chat oggi è inutile»): "Veloce" = the quick path (answer it, or ONE chat that works alone, never a
// delegation tree: the cheapest way through, ADR 0087), "Strategist" = hand it to a Strategist chat that plans it and
// delegates the parts. Neither ticked = the Orchestrator decides with task_estimate as usual. The message goes with a
// first line that names its own meaning, so it works even where the MCP instructions (SEND_MODE_RULE) do not reach the
// model; the chat view hides that line and shows a badge instead. Messages saved with the old "[nuova chat]" line still
// read as such (badge "Nuova chat"). Pure. Used by ChatInput/ChatItems (renderer), main/wiring.ts (the Orchestrator's
// MCP instructions) and the demo's Orchestrator.

export type SendMode = 'quick' | 'plan';
/** what a saved message asked for: one of the modes, or the retired "new chat" */
export type SentMode = SendMode | 'new';

/** the machine-readable tags that start the first line */
export const MODE_TAGS: Readonly<Record<SentMode, string>> = { quick: '[veloce]', plan: '[strategist]', new: '[nuova chat]' };

/** the whole first line the Orchestrator reads, per mode */
export const MODE_LINES: Readonly<Record<SendMode, string>> = {
  quick: `${MODE_TAGS.quick} Via rapida: niente piano e niente deleghe. Se basta una risposta breve o una lettura veloce, rispondi tu; altrimenti apri UNA sola chat di lavoro con app_create_chat e scrivi nel suo prompt di fare tutto da sola, senza agent_delegate. Poi rispondimi con una riga.`,
  plan: `${MODE_TAGS.plan} Affida questa richiesta allo Strategist: apri con app_create_chat una chat con roleId "strategist" che la pianifica e delega le parti con agent_delegate. Non farla tu; poi rispondimi con una riga.`,
};

/** the same rules for the Orchestrator's MCP instructions */
export const SEND_MODE_RULE = `A user message whose first line starts with "${MODE_TAGS.quick}" asks for the quick path: no plan, no delegation tree; answer it yourself when a short answer or one quick read is enough, else open ONE work chat (app_create_chat) whose prompt says to do it alone without agent_delegate. A first line starting with "${MODE_TAGS.plan}" asks you to hand the request to a Strategist chat (app_create_chat, roleId "strategist") that plans and delegates; do not do it yourself. A first line starting with "${MODE_TAGS.new}" (older messages) asks for one new work chat. After either, answer in one line.`;

const LINE = /^\[(veloce|strategist|nuova chat)\][^\n]*(?:\n+|$)/;
const BY_TAG: Readonly<Record<string, SentMode>> = { veloce: 'quick', strategist: 'plan', 'nuova chat': 'new' };

/** The message as the Orchestrator gets it. */
export const withMode = (mode: SendMode, text: string): string => `${MODE_LINES[mode]}\n\n${text.trim()}`;

/** Which mode a message asked for (null: none), and what the user wrote (the tag line removed). */
export function splitMode(text: string): { mode: SentMode | null; text: string } {
  const m = text.match(LINE);
  return m ? { mode: BY_TAG[m[1]!]!, text: text.slice(m[0].length) } : { mode: null, text };
}
