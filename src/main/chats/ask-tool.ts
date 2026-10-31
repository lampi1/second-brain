// ask_user: the yes/no question for a chat whose engine has no question tool that reaches the app (engines/registry.ts
// appAsks: OpenCode over ACP, whose own `question` tool exists only for its app/cli/desktop clients). On the chat's own
// MCP endpoint (the caller is the token's chat, never an argument), shown only to those chats (tool-visibility.ts):
// the question becomes the same Sì/No panel as AskUserQuestion / Cursor's AskQuestion, with the same brief gate (ADR
// 0135, 0150), and the user's answer comes back as the user's next message (chats/acp.ts askUser). A Strategist's
// answered questions count for its plan as on the other engines (manager-requests.ts withClarified). Used by wiring.ts.
import type { McpTool } from '../mcp/server';
import { callerOf } from '../mcp/caller';
import type { AppAsk } from './session';

/** What the tool needs from the chats (ChatManager). */
export interface AskChats { askUser(chatId: string, q: AppAsk): Promise<string | null> }

export const ASK_USER_SHOWN = 'Shown to the user as a Sì/No panel. End your turn now: the answer arrives as the user\'s next message. Do not ask it again.';

export function askTools(chats: AskChats): McpTool[] {
  return [{
    name: 'ask_user',
    description: 'Ask the user ONE yes/no decision as a Sì/No panel (your engine has no question tool of its own; this is it). '
      + 'Before it call show_ui with component "brief" and target "next-ask" (what you did, its evidence, what Sì and No do). '
      + 'The answer arrives as the user\'s next message: end your turn after calling it.',
    inputSchema: { type: 'object', required: ['question', 'recommended'], additionalProperties: false, properties: {
      question: { type: 'string', maxLength: 1000, description: 'one short yes/no question in the user\'s language, e.g. "Parto con la correzione?"' },
      recommended: { type: 'string', enum: ['yes', 'no'], description: 'the answer you recommend (marked «(consigliato)»): the one that moves the task forward' },
      header: { type: 'string', maxLength: 30, description: 'optional: a 1-3 word label, e.g. "Correzione"' },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (a, ctx) => {
      const id = callerOf(ctx.params);
      const question = typeof a.question === 'string' ? a.question : '';
      const recommended = a.recommended === 'no' ? 'no' : 'yes';
      const header = typeof a.header === 'string' ? a.header : undefined;
      const refused = await chats.askUser(id, { question, recommended, ...(header ? { header } : {}) });
      if (refused) throw new Error(refused);
      return ASK_USER_SHOWN;
    },
  }];
}
