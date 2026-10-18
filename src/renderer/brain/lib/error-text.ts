// A raw error of a brain page → one short line to show and, when there is more (a Node stack trace, a child's stderr,
// several lines), the full text to keep folded under "Dettagli". The brain's data server answers with whatever its
// child printed (seen 2026-10-18: a whole MODULE_NOT_FOUND stack on the Miglioramento page), so the page must never
// show that raw. DOM-free, unit-tested (test/unit/brain-ui/error-text.test.ts); used by components/States.tsx.

/** the longest line the error box shows before folding the rest */
export const SHORT_MAX = 200;

const NOISE = [
  /^node:internal\//, // the loader frame Node prints first
  /^\s+at\s/, // stack frames
  /^\s*(throw err;|\^+)\s*$/, // the caret under the throwing line
  /^\s*[{}]\s*$/, /^\s*(code|requireStack|errno|syscall):/, // the error's enumerable fields, printed after the stack
  /^\s*\[?[A-Za-z]*Error\]?:?\s*$/, // a bare "Error:" line
];
/** "Error: x", "TypeError: x", "Error [ERR_MODULE_NOT_FOUND]: x" → "x" */
const PREFIX = /^(?:[A-Za-z]*Error)(?:\s\[[A-Z_]+\])?:\s+/;

export interface ErrorText { short: string; details: string | null }

export function shortError(raw: unknown): ErrorText {
  const text = String(raw ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return { short: '', details: null };
  const lines = text.split('\n').map(l => l.trimEnd()).filter(l => l.trim());
  // the error's own message line first (Node prints it after its loader frame), else the first line that is not noise
  const named = lines.find(l => PREFIX.test(l));
  const first = named ?? lines.find(l => !NOISE.some(r => r.test(l))) ?? lines[0] ?? '';
  let short = first.replace(PREFIX, '').trim();
  if (short.length > SHORT_MAX) short = `${short.slice(0, SHORT_MAX - 1).trimEnd()}…`;
  const more = lines.length > 1 || first.length !== text.length || short !== first;
  return { short, details: more && text !== short ? text : null };
}
