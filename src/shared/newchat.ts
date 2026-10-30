// How a message to an Orchestrator should be handled, chosen in its input (ADR 0034, revised 2026-10-20 by the owner:
// «il pulsante nuova chat oggi è inutile»): "Strategist" = hand it to a Strategist chat that plans it and delegates the
// parts. Not ticked = the Orchestrator decides with the app's estimate as usual. "Veloce" is gone (#124, 2026-10-21; its
// last traces by ADR 0201): quick questions have one lane, Flash (ADR 0105, 0107). The message goes with a first line that
// names its own meaning, so it works even where the MCP instructions (SEND_MODE_RULE) do not reach the model; the chat
// view hides that line and shows a badge instead. A message saved with the old "[nuova chat]" line keeps its badge; one
// with the old "[veloce]" line only loses that line (no badge). Pure. Used by ChatInput/ChatItems (renderer), main/wiring.ts (the Orchestrator's
// MCP instructions) and the demo's Orchestrator.

export type SendMode = 'plan';
/** what a saved message asked for: the mode, or the retired "new chat" */
export type SentMode = SendMode | 'new';

/** the machine-readable tags that start the first line */
export const MODE_TAGS: Readonly<Record<SentMode, string>> = { plan: '[strategist]', new: '[nuova chat]' };

/** the whole first line the Orchestrator reads, per mode */
export const MODE_LINES: Readonly<Record<SendMode, string>> = {
  plan: `${MODE_TAGS.plan} Affida questa richiesta allo Strategist: apri con app_create_chat una chat con roleId "strategist" che la pianifica e delega le parti con agent_delegate. Non farla tu; poi rispondimi con una riga.`,
};

/** the same rules for the Orchestrator's MCP instructions */
export const SEND_MODE_RULE = `A user message whose first line starts with "${MODE_TAGS.plan}" asks you to hand the request to a Strategist chat (app_create_chat, roleId "strategist") that plans and delegates; do not do it yourself; then answer in one line. Older messages may start with "${MODE_TAGS.new}" (one new work chat).`;

const LINE = /^\[(veloce|strategist|nuova chat)\][^\n]*(?:\n+|$)/;
/** the retired "[veloce]" line is still taken off an old message, with no mode */
const BY_TAG: Readonly<Record<string, SentMode | null>> = { veloce: null, strategist: 'plan', 'nuova chat': 'new' };

/** The message as the Orchestrator gets it. */
export const withMode = (mode: SendMode, text: string): string => `${MODE_LINES[mode]}\n\n${text.trim()}`;

/** Which mode a message asked for (null: none), and what the user wrote (the tag line removed). */
export function splitMode(text: string): { mode: SentMode | null; text: string } {
  const m = text.match(LINE);
  return m ? { mode: BY_TAG[m[1]!] ?? null, text: text.slice(m[0].length) } : { mode: null, text };
}
