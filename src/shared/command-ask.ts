// Which shell blocks of a chat's message are a command left for the user to run (a "Comando da eseguire" request).
// Why: the user missed the Esegui under a chat's block more than once and the work stood still (2026-10-12: "non mi
// appare come notifica quando devo premere Esegui"); his chats put the command for him last in the reply (the user's
// brain rules: "Commands for him to run: one at a time … last thing in the reply"). The rule, kept narrow so an example in
// the middle of an explanation never asks for anything:
//   1. only the turn's last assistant message (the caller passes it; main/run/asks.ts);
//   2. only top-level fenced blocks Esegui can run (shared/runnable.ts: a shell language, not empty, ≤ MAX_RUN_CODE);
//   3. the block is the message's last block and at most one short line of its own follows it, OR the text just before it asks
//      the user to run it ("lancia questo:", "esegui in PowerShell", "da eseguire");
//   4. never when the text just before it calls it an example or says the agent already ran it ("ad esempio",
//      "ho eseguito").
// At most MAX_ASKS per message. Each block keeps its `lead`: the chat's explanation right before it, as plain text, shown
// on the command's card without a click (the user, 2026-10-13: "un chiaro contesto e spiegazione"). Pure: used by
// main/run/asks.ts, pinned by test/unit/command-ask.test.ts.
import { marked } from 'marked';
import { isRunnable, MAX_RUN_CODE } from './runnable';

export interface AskedBlock { index: number; lang: string; code: string; /** the paragraph before it, plain text ('' = none) */ lead: string }

export const MAX_ASKS = 3;
/** what may follow the last block for it to still be "the last thing": one short closing line that starts a sentence
 *  of its own ("Poi dimmi com'è andata."), not the rest of the sentence before the block ("e mostra un commit…") */
const TAIL_CHARS = 120;

/** The user is asked to run it (Italian first: his chats write Italian; a few English forms). */
const ASK = /\b(esegui(?:lo|la|li)?|lancia(?:lo|la|li|mi)?|lanciate|avvia(?:lo|la)?|incolla(?:lo|la)?|da (?:eseguire|lanciare)|premi esegui|clicca esegui|nel (?:tuo )?terminale|in powershell|run (?:this|it)|please run)\b/i;
/** …unless it is an example, or the agent's own past run. */
const NOT = /\b(esempio|ad es\.?|per es\.?|e\.g\.|for example|for instance|ho (?:eseguito|lanciato|usato|fatto girare|provato)|abbiamo (?:eseguito|lanciato)|i ran|i used)\b/i;

/** The paragraph right before a block (its last 300 characters): where "lancia questo:" sits. */
function leadOf(text: string): string {
  const paras = text.replace(/\r\n/g, '\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  return (paras.at(-1) ?? '').slice(-300);
}

/** A lead as plain text for the card: links keep their label, emphasis and code marks go, one line. */
export function plainLead(md: string): string {
  return md.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`|^\s*[#>]+\s*/gm, '').replace(/\s+/g, ' ').trim();
}

/** The blocks of this message that ask the user to run them, in order. `code` is normalized like the runner's. */
export function askedBlocks(text: string): AskedBlock[] {
  if (!text || !text.includes('```') && !text.includes('~~~')) return [];
  let tokens: ReturnType<typeof marked.lexer>;
  try { tokens = marked.lexer(text, { gfm: true }); } catch { return []; }
  // top-level fenced blocks only (the ones that get a toolbar: renderer/lib/markdown.ts markdownParts), with the text
  // before each one and the text after the last one
  const blocks: { lang: string; code: string; lead: string }[] = [];
  let between = '';
  for (const t of tokens) {
    if (t.type === 'code' && (t as { codeBlockStyle?: string }).codeBlockStyle !== 'indented') {
      const lang = String((t as { lang?: string }).lang ?? '').trim().split(/\s+/)[0] ?? '';
      blocks.push({ lang, code: String((t as { text?: string }).text ?? ''), lead: between });
      between = '';
    } else between += t.raw;
  }
  const tail = between.trim();
  const shortTail = !tail || (tail.length <= TAIL_CHARS && !tail.includes('\n') && !/^\p{Ll}/u.test(tail));
  const out: AskedBlock[] = [];
  blocks.forEach((b, i) => {
    const code = b.code.replace(/\r\n/g, '\n').trimEnd();
    if (!isRunnable(b.lang) || !code.trim() || code.length > MAX_RUN_CODE) return;
    const lead = leadOf(b.lead);
    if (NOT.test(lead)) return;
    const last = i === blocks.length - 1 && shortTail;
    if (last || ASK.test(lead)) out.push({ index: i, lang: b.lang, code, lead: plainLead(lead) });
  });
  return out.slice(-MAX_ASKS);
}
