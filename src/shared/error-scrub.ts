// What an interface error report keeps of the error (ADR 0192, review 2026-10-29): the page is not trusted and an error's
// message often carries what the user typed or sees (a note's title in quotes, a path, an id). So a message keeps its
// first line only, with every quoted substring ('…', "…", «…», `…`) replaced by «…», paths and URLs folded to <path>,
// long numbers to <n> and long hex ids to <id>; a stack keeps its frames only, each as file:line (the file's base name),
// never the message lines it repeats; a React component stack keeps the component and its file:line. Pure, used on both
// sides: renderer/lib/ui-errors.ts (before sending) and main/renderer-errors.ts (again, as the page is not trusted).
// Tests: test/unit/renderer-errors.test.ts.

const QUOTED = /'[^'\n]*'|"[^"\n]*"|«[^»\n]*»|`[^`\n]*`|“[^”\n]*”|‘[^’\n]*’/g;
const PATHLIKE = /(?:[a-z][\w+.-]*:\/\/[^\s)]+|[A-Za-z]:[\\/][^\s)]*|\\\\[^\s)]+|(?:~|\.{1,2})?\/[^\s/\\)]+(?:\/[^\s/\\)]+)+|[^\s/\\()]+(?:[\\/][^\s/\\()]+){2,})/g;

/** The message as kept: first line, quotes, paths, long numbers and ids folded, cut to `max`. */
export function scrubMessage(raw: string, max = 500): string {
  const first = (raw.split(/\r?\n/).find(l => l.trim()) ?? '').trim();
  return first
    .replace(QUOTED, '«…»')
    .replace(PATHLIKE, '<path>')
    .replace(/\b(?=[0-9a-f]*[a-f])[0-9a-f]{12,}\b/gi, '<id>')
    .replace(/\d{4,}/g, '<n>')
    .slice(0, max);
}

/** file:line of a frame line (V8 `at fn (url:line:col)`, Firefox `fn@url:line:col`), the file by its base name; null =
 *  no location (a message line, `<anonymous>`, native code). */
function location(line: string): string | null {
  const m = /([^\s()\\/@?#]+?)(?:[?#][^\s():]*)?:(\d+)(?::\d+)?\)?\s*$/.exec(line);
  return m ? `${m[1]}:${m[2]}` : null;
}

/** A stack as kept: one file:line per frame, nothing else (a stack kept already reads the same); undefined when no
 *  frame has a location. */
export function scrubStack(raw: string, max = 2000): string | undefined {
  const frames = raw.split(/\r?\n/).filter(l => /^\s*at\s|@|^[^\s()]+:\d+$/.test(l.trim())).map(location).filter((x): x is string => !!x);
  const out = frames.join('\n').slice(0, max);
  return out || undefined;
}

/** A React component stack as kept: each component's name and file:line. */
export function scrubComponentStack(raw: string, max = 2000): string | undefined {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const name = /^(?:at|in)\s+([\w$.]+)/.exec(l)?.[1] ?? /^([\w$.]+)@/.exec(l)?.[1];
    if (!name) return null;
    const at = location(l);
    return `at ${name}${at ? ` (${at})` : ''}`;
  }).filter((x): x is string => !!x);
  const out = lines.join('\n').slice(0, max);
  return out || undefined;
}

/** An error event's source (`url:line:col`) as kept: file:line. */
export const scrubSource = (raw: string): string | undefined => location(raw) ?? undefined;
