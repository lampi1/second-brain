// What an agent types into a page through the app's browser (type, fill_form, key) never reaches the chat feed in clear:
// since agents sign in by themselves on every host (ADR 0237) that text can be a password, and the feed is shown,
// persisted and read back. The tool input keeps its refs with every typed value replaced by "•••" (for key, each run of
// character strokes: "s e c r e t Enter" → "••• Enter"), and the row's summary or panel title loses any copy of them. The page side masks password values on its own (browser/page.ts).
// Pure, unit-tested (test/unit/chats/typed-text.test.ts); used by manager-sink.ts (live items and permission panels)
// transcript.ts (history read back from Claude's transcript) and wire-record.ts (the recorded engine wires).
import type { ChatItem, PendingRequest } from '../../shared/contract';

type Obj = Record<string, unknown>;
const MASK = '•••';
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});

/** The app's browser server under any engine's naming: mcp__second-brain__type (Claude, Codex), a plugin prefix, the
 *  demo's sb-browser, an optional browser_ tool prefix. */
const TYPING_TOOL = /^mcp__[\w-]*?(?:second-brain|sb-browser)[\w-]*?__(?:browser_)?(type|fill_form|key)$/i;
/** Cursor (ACP) names a tool by its kind and puts "<server>: <tool>" in the title. */
const TYPING_TITLE = /\b(?:second-brain|sb-browser)\b\W+(?:browser_)?(type|fill_form|key)\b/i;

/** Which typing tool a call is ('' for any other tool). */
export type Typing = 'type' | 'fill_form' | 'key';
export function typingTool(name: string, title = ''): Typing | '' {
  const m = TYPING_TOOL.exec(name) ?? TYPING_TITLE.exec(title);
  return m ? (m[1]!.toLowerCase() as Typing) : '';
}

/** A key spec (browser/keys.ts parseKeys) with each run of strokes that type a character (one character, shift at
 *  most) replaced by "•••"; named keys and shortcuts stay. */
export function maskKeys(spec: string): string {
  const out: string[] = [];
  for (const combo of spec.trim().split(/\s+/).filter(Boolean)) {
    const parts = combo === '+' ? ['+'] : combo.endsWith('++') ? [...combo.slice(0, -2).split('+'), '+'] : combo.split('+');
    const name = parts.pop() ?? '';
    const char = [...name].length === 1 && parts.every(m => /^shift$/i.test(m));
    if (!char) out.push(combo);
    else if (out[out.length - 1] !== MASK) out.push(MASK);
  }
  return out.join(' ');
}

/** The values a typing call writes into the page. */
function typedValues(kind: Typing, input: unknown): string[] {
  const i = obj(input);
  if (kind === 'key') return typeof i.keys === 'string' && maskKeys(i.keys) !== i.keys.trim() ? [i.keys] : [];
  if (kind === 'type') return typeof i.text === 'string' && i.text ? [i.text] : [];
  return (Array.isArray(i.fields) ? i.fields : []).map(f => obj(f).value).filter((v): v is string => typeof v === 'string' && v !== '');
}

/** A text with every copy of the values replaced, a whitespace-collapsed copy and a cut one ("abc…") included. */
export function scrub(text: string, values: string[]): string {
  let out = text;
  for (const v of values) {
    const flat = v.replace(/\s+/g, ' ').trim();
    for (const copy of [v, flat]) if (copy) out = out.split(copy).join(MASK);
    // a summary cut at its limit keeps only the value's start before "…"
    if (out.endsWith('…') && flat.length >= 4) {
      const body = out.slice(0, -1);
      for (let n = Math.min(flat.length, body.length); n >= 4; n--) {
        if (body.endsWith(flat.slice(0, n))) { out = `${body.slice(0, -n)}${MASK}`; break; }
      }
    }
  }
  return out;
}

/** The input of a typing call with its values masked; any other input as it is. */
export function maskTypedInput(name: string, input: unknown, title = ''): unknown {
  const kind = typingTool(name, title);
  return kind ? maskArgs(kind, input) : input;
}

/** The arguments of a typing call of a known kind with what it types masked. */
export function maskArgs(kind: Typing, input: unknown): unknown {
  const i = obj(input);
  if (kind === 'type') return typeof i.text === 'string' ? { ...i, text: MASK } : input;
  if (kind === 'key') return typeof i.keys === 'string' && maskKeys(i.keys) !== i.keys.trim() ? { ...i, keys: maskKeys(i.keys) } : input;
  if (!Array.isArray(i.fields)) return input;
  return { ...i, fields: i.fields.map(f => (f && typeof f === 'object' && 'value' in f ? { ...(f as Obj), value: MASK } : f)) };
}

/** A feed item with what a typing call wrote masked in its input and summary; any other item as it is. */
export function maskTypedItem(item: ChatItem): ChatItem {
  if (item.kind !== 'tool') return item;
  const kind = typingTool(item.name, item.summary);
  if (!kind) return item;
  const values = typedValues(kind, item.input);
  if (!values.length && kind === 'key') return item;   // only named keys: nothing typed
  return { ...item, input: maskTypedInput(item.name, item.input, item.summary), summary: scrub(item.summary, values) };
}

/** A permission panel for a typing call with its input, title and detail masked. */
export function maskTypedRequest<T extends Omit<PendingRequest, 'chatId'>>(req: T): T {
  const kind = typingTool(req.tool, req.title);
  if (!kind) return req;
  const values = typedValues(kind, req.input);
  return { ...req, input: maskTypedInput(req.tool, req.input, req.title), title: scrub(req.title, values), detail: scrub(req.detail, values) };
}
