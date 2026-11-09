// What an agent types into a page through the app's browser (type, fill_form) never reaches the chat feed in clear:
// since agents sign in by themselves on every host (ADR 0237) that text can be a password, and the feed is shown,
// persisted and read back. The tool input keeps its refs with every typed value replaced by "•••", and the row's
// summary or panel title loses any copy of those values. The page side masks password values on its own (browser/page.ts).
// Pure, unit-tested (test/unit/chats/typed-text.test.ts); used by manager-sink.ts (live items and permission panels)
// and transcript.ts (history read back from Claude's transcript).
import type { ChatItem, PendingRequest } from '../../shared/contract';

type Obj = Record<string, unknown>;
const MASK = '•••';
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});

/** The app's browser server under any engine's naming: mcp__second-brain__type (Claude, Codex), a plugin prefix, the
 *  demo's sb-browser, an optional browser_ tool prefix. */
const TYPING_TOOL = /^mcp__[\w-]*?(?:second-brain|sb-browser)[\w-]*?__(?:browser_)?(type|fill_form)$/i;
/** Cursor (ACP) names a tool by its kind and puts "<server>: <tool>" in the title. */
const TYPING_TITLE = /\b(?:second-brain|sb-browser)\b\W+(?:browser_)?(type|fill_form)\b/i;

/** Which typing tool a call is ('' for any other tool). */
function typingTool(name: string, title = ''): 'type' | 'fill_form' | '' {
  const m = TYPING_TOOL.exec(name) ?? TYPING_TITLE.exec(title);
  return m ? (m[1]!.toLowerCase() as 'type' | 'fill_form') : '';
}

/** The values a typing call writes into the page. */
function typedValues(kind: 'type' | 'fill_form', input: unknown): string[] {
  const i = obj(input);
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
  if (!kind) return input;
  const i = obj(input);
  if (kind === 'type') return typeof i.text === 'string' ? { ...i, text: MASK } : input;
  if (!Array.isArray(i.fields)) return input;
  return { ...i, fields: i.fields.map(f => (f && typeof f === 'object' && 'value' in f ? { ...(f as Obj), value: MASK } : f)) };
}

/** A feed item with what a typing call wrote masked in its input and summary; any other item as it is. */
export function maskTypedItem(item: ChatItem): ChatItem {
  if (item.kind !== 'tool') return item;
  const kind = typingTool(item.name, item.summary);
  if (!kind) return item;
  const values = typedValues(kind, item.input);
  return { ...item, input: maskTypedInput(item.name, item.input, item.summary), summary: scrub(item.summary, values) };
}

/** A permission panel for a typing call with its input, title and detail masked. */
export function maskTypedRequest<T extends Omit<PendingRequest, 'chatId'>>(req: T): T {
  const kind = typingTool(req.tool, req.title);
  if (!kind) return req;
  const values = typedValues(kind, req.input);
  return { ...req, input: maskTypedInput(req.tool, req.input, req.title), title: scrub(req.title, values), detail: scrub(req.detail, values) };
}
