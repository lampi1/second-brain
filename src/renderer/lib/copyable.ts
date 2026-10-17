// Which `inline code` of a chat message is a thing to copy (a path, a URL, an id, a command) and which is only a word
// or a phrase set in code (`true`, `map`, `il totale è sbagliato.`): only the first get "click to copy" (the user,
// 2026-10-13: "sempre il copia nelle cose copiabili"), so a message is not a field of buttons. And which of them is a
// file path, whose click opens a preview instead (LinkPeek.tsx); a path may end with :line or :line:col (agents' and
// reviewers' reports), which lineless() takes away before the file is read or opened. Pure; used by lib/markdown.ts
// (it marks the code elements) and LinkPeek.tsx; pinned by test/unit/copyable.test.ts.

import { fileReference } from '@shared/file-view';

/** "C:\x\a.ts:12:3" → "C:\x\a.ts" (a path's line and column suffix). */
export const lineless = (s: string): string => fileReference(s).path;

/** A Windows absolute path, a file: URL or a relative path with a folder and a file extension (src/a.ts, .\x\y.md),
 *  optionally with :line(:col). */
export function isFilePath(s: string): boolean {
  const t = lineless(s);
  if (!t || t.length > 400 || /[\r\n<>|"*?]/.test(t)) return false;
  if (/^file:\/\/\/?[a-z]:[\\/]/i.test(t)) return true;
  if (/^[a-z]:[\\/]/i.test(t)) return t.indexOf(':', 2) === -1;
  if (/\s/.test(t) || /^[a-z][a-z0-9+.-]*:/i.test(t) || /^[\\/]{2}/.test(t)) return false;
  return /[\\/]/.test(t) && /\.[a-z0-9]{1,8}$/i.test(t);
}

export const isUrl = (s: string): boolean => /^https?:\/\/\S+$/i.test(s.trim());

/** a token that looks technical: a sign inside it (check:branch, a.ts, x=1, my_var), a flag (-5, --oneline), $env */
const TECH = /^-{1,2}[a-z0-9]|\S[-/\\.:=$@|_]\S|^[$@]\S/i;

/** Worth a copy: a path or a URL, a number-like id (4721, #812, AB-1234), one word of 6 characters or more (an
 *  identifier, a branch), or a command: words that start like one with at least one technical token. Never prose. */
export function isCopyable(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 2000) return false;
  if (isFilePath(t) || isUrl(t)) return true;
  if (/^#?[A-Z]{0,6}-?\d{3,}$/i.test(t)) return true;
  const words = t.split(/\s+/);
  if (words.length === 1) return t.length >= 6 && !/[.,;:!?]$/.test(t);
  if (/^(?:SELECT|UPDATE|DELETE|INSERT|WITH|EXEC)\s/.test(t)) return true; // a query's text
  return /^[a-z][\w.-]*$/i.test(words[0]!) && words.some(w => TECH.test(w));
}
