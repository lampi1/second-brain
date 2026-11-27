// app_show_credentials (ADR 0367, owner 2026-11-27: «dammi le credenziali di test 3»): the Orchestrator asks the app to
// show the user a card with URL / Utente / Password of an entry of his credentials file, by a reference (a host, a user
// name, the words he used). The values never enter the model's context, a transcript or a log: the tool's result and
// the card's chat item carry only the entry's opaque id and its group label; the renderer reads URL and user name, and
// the password on «Mostra», from main while the card is live (10 minutes, browser/service.ts), and copies a field only on
// the user's click. A rule-2 exception (docs/agents/rules.md). Mounted on the Orchestrator's own endpoint by
// appctl/tools.ts; tested by test/unit/appctl-credential-card.test.ts.
import type { ChatItem } from '../../shared/contract';
import { sysEn } from '../../shared/sys';
import type { CardMatch } from '../browser/logins';
import { ToolRefusal } from '../mcp/refusal';

interface Tool { name: string; description: string; inputSchema: object; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean }; run(a: Record<string, unknown>): string }

export interface CredentialsCardDeps {
  /** the entry a reference names; on a hit the card goes live (BrowserService.credentialCardMatch) */
  match(ref: string): CardMatch;
  /** the Orchestrator that calls (its own endpoint) */
  orchestratorId(): string | null;
  /** the card's item into that Orchestrator's transcript (ChatService.appNotice) */
  show(chatId: string, item: Extract<ChatItem, { kind: 'system' }>): void;
  now?: () => number;
}

export const CREDENTIALS_TOOL = 'app_show_credentials';

/** The card's chat item: the entry id and group only (sys.credentialCard), never a value. */
export function credentialCardItem(entryId: string, group: string, at: number): Extract<ChatItem, { kind: 'system' }> {
  const params = { entryId, group };
  return { kind: 'system', id: `cred-${entryId}-${at.toString(36)}`, at, level: 'info', code: 'credentialCard', params, text: sysEn('credentialCard', params) };
}

export function credentialsCardTool(d: CredentialsCardDeps): Tool {
  return {
    name: CREDENTIALS_TOOL,
    description: 'Show the user a card with the URL, user name and password of a test account from his credentials file, when he asks for credentials ("dammi le credenziali di test 3"). ref = the host, the user name or his words ("test 3"). The app reads the values and shows them to him only, each with its own Copia, the password masked behind «Mostra»; the card closes by itself after 10 minutes. You never get the values: never read the credentials file, never write a URL, user name or password in chat. After it, answer in one short line at most (the card is the answer). Refused with the fix when no entry, several entries or a production entry match.',
    inputSchema: { type: 'object', properties: { ref: { type: 'string', description: 'host, user name or the words the user used for the environment (never a password)' } }, required: ['ref'] },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    run: a => {
      const ref = typeof a.ref === 'string' ? a.ref.slice(0, 200) : '';
      const chatId = d.orchestratorId();
      if (!chatId) throw new ToolRefusal('Refused: only the open Orchestrator shows credentials to the user.');
      const m = d.match(ref);
      if ('refusal' in m) throw new ToolRefusal(m.refusal);
      d.show(chatId, credentialCardItem(m.id, m.group, (d.now ?? Date.now)()));
      return `Shown to the user: the credentials card of «${m.group || 'entry'}» (URL, user, password with Copia; it closes in 10 minutes). You do not have the values and must not write them.`;
    },
  };
}
