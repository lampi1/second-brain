// Brain rule 5 (#342): text with backslashes goes into files through Write/Edit, never through Bash. Git Bash on Windows
// turns `\\` into control characters or drops escapes, and agents kept breaking the rule although it is always loaded
// (3 times in 4 days in the owner's error log). A Bash command that writes a file (a heredoc or here-string into a file,
// tee, or an interpreter with a write call; node -e / python -c with a write call; sed -i, perl -i) and carries a
// backslash is refused with a short reason; a command that only reads (grep 'a\\b', cat, git, a script that only
// prints) is never refused. Quoted text is blanked before the tools are looked for, so a tool name or a `>` inside a
// title or a search pattern is not a command, and tools count only in command position. Pure; used by guards.ts for the
// Bash tool (PowerShell is not Bash). Tests: test/unit/bash-backslash.test.ts.

/** the start of a command: the line's start, after a pipe, `;`, `&`, `(`, or after a prefix that runs the next word */
const AT = String.raw`(?:^|[|;&(]\s*|\b(?:sudo|exec|env|xargs|command|time|-exec)\s+)`;
/** a heredoc operator (not a here-string) */
const HEREDOC = /<<-?\s*(['"]?)[A-Za-z_][\w-]*\1/;
const HERESTRING = /<<</;
/** a redirect into a file (not `2>&1`, `&>`, `=>`, `->` or /dev/null) */
const INTO_FILE = /(?:^|[^\d&>=-])>>?\s*(?!&|\/dev\/null\b)[^\s|&;]/;
const TEE = new RegExp(`${AT}tee\\b`);
const INTERP = new RegExp(`${AT}(?:npx\\s+)?(?:node|python3?|py|perl|ruby|deno|bun|tsx|ts-node)\\b`);
/** a one-line program (its flag may touch its quoted text: node -e"…") */
const INLINE = new RegExp(`${AT}(?:npx\\s+)?(?:(?:node|deno|bun|tsx)\\b[^\\n|;&]*\\s(?:-e|--eval|-p|--print)|(?:python3?|py)\\b[^\\n|;&]*\\s-c)(?=[\\s"'])`);
/** a call that writes a file (printing to stdout or stderr is not one) */
const WRITE_CALL = /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|fs\.write|write_text|write_bytes)\b|(?<!std(?:out|err))\.write\s*\(|\bopen\s*\([^)]*['"][wa]\+?b?['"]/;
const IN_PLACE = new RegExp(`${AT}(?:sed|perl)\\b[^\\n|;&]*\\s(?:-[a-zA-Z0-9]*i[a-zA-Z]*\\b|--in-place\\b)`);

export const BACKSLASH_REASON = 'Text with backslashes: use the Write or Edit tool, not Bash (node -e, heredoc, sed -i). Bash on Windows drops or changes backslashes (brain rule 5).';

/** a line with its quoted strings blanked */
const unquoted = (line: string): string => line.replace(/'[^'\n]*'|"(?:[^"\\\n]|\\.)*"/g, '""');

/** The reason to refuse a Bash command, or null. */
export function backslashWrite(command: string): string | null {
  const c = String(command || '');
  if (!c.includes('\\')) return null;
  const writeCall = WRITE_CALL.test(c);
  const writes = c.split('\n').some(line => {
    const u = unquoted(line);
    if (HEREDOC.test(line) && !HERESTRING.test(line)) return INTO_FILE.test(u) || TEE.test(u) || (INTERP.test(u) && writeCall);
    if (HERESTRING.test(line)) return INTERP.test(u) && writeCall;
    return (INLINE.test(u) && writeCall) || IN_PLACE.test(u);
  });
  return writes ? BACKSLASH_REASON : null;
}
