// The built-in agents' purpose in the UI language. A role's name, purpose and character always come from the role
// (main: agents/catalog.ts, shared/roles.ts ROLE_DEFAULTS, written in Italian), so the line the cards and the chat
// details show is the dictionary's for those ids (catalog.purpose.<id>); any other agent keeps its own text. Used by
// AgentCatalogCard.tsx, AgentStudio.tsx, AgentIdentity.tsx and ChatTile.tsx; pinned by test/unit/visible-language.test.ts.
import { t, type Key } from '../i18n';

export const BUILT_IN_PURPOSE = ['orchestrator', 'strategist', 'scout', 'artisan', 'sentinel', 'herald', 'flash', 'pulse'] as const;

/** The purpose to show for this agent: the built-in one in the UI language, else its own. */
export function rolePurpose(id: string | undefined, purpose: string): string {
  return id && (BUILT_IN_PURPOSE as readonly string[]).includes(id) ? t(`catalog.purpose.${id}` as Key) : purpose;
}
