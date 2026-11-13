// How a message to an Orchestrator should be handled, chosen in its input (ADR 0034, revised 2026-10-20 by the owner:
// «il pulsante nuova chat oggi è inutile»; «Fast» added by ADR 0296): "Plan" = hand it to a Strategist chat that plans
// it and delegates the parts; "Fast" = the Orchestrator answers itself at once, briefly, without delegating (the app
// refuses app_create_chat and app_assign_task in that turn, appctl/tools.ts). Not ticked = the Orchestrator decides
// with the app's estimate as usual. The message goes with a first line that names its own meaning, so it works even
// where the MCP instructions (SEND_MODE_RULE) do not reach the model; the chat view hides that line and shows a badge
// instead. A message saved with the old "[nuova chat]" line keeps its badge; one with the old "[veloce]" line only
// loses that line (no badge). Pure. Used by ChatInput/ChatItems (renderer), main/wiring-shared.ts (the Orchestrator's
// MCP instructions), main/appctl/tools.ts (the Fast refusal), main/chats/manager.ts and the demo's Orchestrator.

export type SendMode = 'plan' | 'fast';
/** the modes the Orchestrator's input offers, in their order */
export const SEND_MODES: readonly SendMode[] = ['fast', 'plan'];
/** what a saved message asked for: the mode, or the retired "new chat" */
export type SentMode = SendMode | 'new';

/** the machine-readable tags that start the first line */
export const MODE_TAGS: Readonly<Record<SentMode, string>> = { plan: '[strategist]', fast: '[fast]', new: '[nuova chat]' };

/** the whole first line the Orchestrator reads, per mode */
export const MODE_LINES: Readonly<Record<SendMode, string>> = {
  plan: `${MODE_TAGS.plan} Verifica la prima scelta importante, riusa ciò che ho già chiarito e affida il lavoro con app_create_chat e roleId "strategist". Passa la domanda già risposta come intakeQuestion.`,
  fast: `${MODE_TAGS.fast} Rispondi tu, subito, senza delegare né aprire chat: poche righe, prima la risposta. Solo ciò che sai o leggi ora con al massimo una lettura veloce; niente supposizioni: se non lo sai o serve un lavoro vero, dillo in una riga.`,
};

/** the same rules for the Orchestrator's MCP instructions */
export const SEND_MODE_RULE = `A user message whose first line starts with "${MODE_TAGS.plan}" asks you to hand the request to a Strategist chat (app_create_chat, roleId "strategist") that plans and delegates. Resolve the first material choice in your panel and pass the answered question as intakeQuestion. If it is already clear, hand off directly. One whose first line starts with "${MODE_TAGS.fast}" asks for your own answer now: no delegation (the app refuses app_create_chat and app_assign_task in that turn), as short as the answer allows, answer first, only facts you know or read now (one quick read at most), never a guess; when you do not know or it needs real work, say so in one line. Older messages may start with "${MODE_TAGS.new}" (one new work chat).`;

const LINE = /^\[(veloce|strategist|fast|nuova chat)\][^\n]*(?:\n+|$)/;
/** the retired "[veloce]" line is still taken off an old message, with no mode */
const BY_TAG: Readonly<Record<string, SentMode | null>> = { veloce: null, strategist: 'plan', fast: 'fast', 'nuova chat': 'new' };

/** The message as the Orchestrator gets it. */
export const withMode = (mode: SendMode, text: string): string => `${MODE_LINES[mode]}\n\n${text.trim()}`;

/** Which mode a message asked for (null: none), and what the user wrote (the tag line removed). */
export function splitMode(text: string): { mode: SentMode | null; text: string } {
  const m = text.match(LINE);
  return m ? { mode: BY_TAG[m[1]!] ?? null, text: text.slice(m[0].length) } : { mode: null, text };
}
