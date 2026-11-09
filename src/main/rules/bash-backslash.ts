// Brain rule 5 (#342): text with backslashes goes into files through Write/Edit, never through Bash. Git Bash on Windows
// turns `\\` into control characters or drops escapes, and agents kept breaking the rule although it is always loaded
// (3 times in 4 days in the owner's error log). A Bash command that writes a file (node -e / python -c with a write
// call, a heredoc into a file, tee or an interpreter, sed -i, perl -i) and carries a backslash is refused with a short
// reason; a command that only reads (grep 'a\\b', cat, git) is never refused. Pure; used by guards.ts for the Bash tool
// (PowerShell is not Bash). Tests: test/unit/bash-backslash.test.ts.

/** a heredoc whose text goes into a file or an interpreter */
const HEREDOC = /<<-?\s*(['"]?)[A-Za-z_][\w-]*\1/;
const INTO_FILE = /(?:^|[^\d&>])>>?\s*(?!&|\/dev\/null\b)[^\s|&;]/m;
const INTO_TOOL = /\b(?:tee|node|python3?|py|perl|ruby|deno|bun)\b/;
/** a one-line program that writes a file */
const INLINE_WRITE = /\b(?:node|deno|bun)\b[^\n]*\s(?:-e|--eval|-p|--print)\s|\bpython3?\b[^\n]*\s-c\s|\bpy\b[^\n]*\s-c\s/;
const WRITE_CALL = /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|fs\.write|write_text|write_bytes|\.write\s*\(|open\s*\([^)]*['"][wa]\+?b?['"])/;
const IN_PLACE = /\b(?:sed|perl)\b[^\n|;&]*\s(?:-[a-zA-Z]*i\b|--in-place\b)/;

export const BACKSLASH_REASON = 'Text with backslashes: use the Write or Edit tool, not Bash (node -e, heredoc, sed -i). Bash on Windows drops or changes backslashes (brain rule 5).';

/** The reason to refuse a Bash command, or null. */
export function backslashWrite(command: string): string | null {
  const c = String(command || '');
  if (!c.includes('\\')) return null;
  const writes = (HEREDOC.test(c) && (INTO_FILE.test(c.split('\n')[0]!) || INTO_TOOL.test(c.split('\n')[0]!)))
    || (INLINE_WRITE.test(c) && WRITE_CALL.test(c))
    || IN_PLACE.test(c);
  return writes ? BACKSLASH_REASON : null;
}
