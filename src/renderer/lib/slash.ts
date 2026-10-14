// The "/" list of a chat's input (ADR 0018): when the message starts with "/" and the caret is still in that first word,
// which commands match what was typed (name prefix first, then a match anywhere in name or description; skills before
// the engine's own commands), and the text once one is picked ("/<name> " in place of the typed word). Pure: used by
// components/ChatInput.tsx (with SlashMenu.tsx) and test/unit/slash.test.ts.
import type { ChatCommand } from '@shared/contract';

/** The typed command word without "/" ('' right after the slash), or null when the list must not show. */
export function slashQuery(text: string, caret: number): string | null {
  if (!text.startsWith('/')) return null;
  const word = /^\/(\S*)/.exec(text)![1]!;
  if (caret < 1 || caret > word.length + 1) return null;
  return word;
}

export function filterCommands(list: readonly ChatCommand[], q: string, max = 60): ChatCommand[] {
  const s = q.toLowerCase();
  const rank = (c: ChatCommand): number => {
    const n = c.name.toLowerCase();
    const base = n === s ? 0 : n.startsWith(s) ? 1 : n.split(/[-:_]/).some(p => p.startsWith(s)) ? 2 : n.includes(s) ? 3 : s && c.description.toLowerCase().includes(s) ? 4 : -1;
    return base < 0 ? -1 : base * 2 + (c.skill ? 0 : 1);
  };
  return list.map(c => ({ c, r: rank(c) })).filter(x => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.c.name.localeCompare(b.c.name)).slice(0, max).map(x => x.c);
}

/** The text with its first word replaced by the picked command, and where the caret goes (after the space). */
export function applyCommand(text: string, name: string): { text: string; caret: number } {
  const rest = text.replace(/^\/\S*/, '').replace(/^ +/, '');
  const head = `/${name} `;
  return { text: head + rest, caret: head.length };
}
