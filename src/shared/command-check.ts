// Checks an Esegui command before the user sees it: the mistakes that make it fail before it starts (#388). Why: in two
// days five Esegui commands failed at once (three times a bash.exe path that does not exist on the PC, an interactive
// bash with no stdin, a `<commit>` placeholder left in), each one a run, a failure and a new question for the user. A
// command with a problem found here goes back to the chat that wrote it (main/run/asks.ts) instead of showing.
// What it finds, kept narrow so a good command is never held back:
//   - on Windows, a leftover placeholder `<name>` (outside comments, quoted text and here-strings, or a quoted "<name>"
//     alone; never a -match pattern); in bash `<` is a redirection;
//   - a shell or interpreter started with nothing to run (bash, wsl, powershell, cmd, python, node alone or with only
//     -l/-i/-NoExit), and Read-Host / Get-Credential / pause as a command: Esegui has no keyboard;
//   - a program or script the block starts (the command itself, after -File or an interpreter) at an absolute path that
//     does not exist (environment variables and ~ expanded; other variables, WSL and bash POSIX paths skipped);
//   - a relative script the block's first command starts (`.\x.ps1`, `-File x.ps1`, `node scripts/x.mjs`) missing
//     from the chat's folder, only when the block never changes folder.
// A path named earlier in the block is never checked (the block may make it).
// The PowerShell 5.1 parse check needs powershell.exe: main/run/precheck.ts. Pure (the file system comes in `exists`):
// used by main/run/precheck.ts, pinned by test/unit/command-check.test.ts.

export interface CheckEnv {
  /** the chat's folder: relative script paths are read against it */
  cwd: string;
  exists(path: string): boolean;
  env?: Record<string, string | undefined>;
  home?: string;
  platform?: NodeJS.Platform;
}

const PLACEHOLDER = /<([A-Za-z][\w.-]{0,40})>/;
/** programs that, started with no command or script, wait for the keyboard */
const SHELLS = /^(?:bash|sh|zsh|wsl|powershell|pwsh|cmd|python3?|py|node)(?:\.exe)?$/i;
/** flags that change nothing about waiting for input */
const IDLE_FLAG = /^(?:-l|-i|--login|--interactive|-noprofile|-nologo|-noexit|-executionpolicy|bypass|unrestricted|remotesigned|\/k)$/i;
const WAITS = /^(Read-Host|Get-Credential|pause)$/i;
const RUNS_EXT = /\.(?:exe|cmd|bat|com|ps1|sh|py|mjs|cjs|js)$/i;
const MOVES = /(?:^|[\s;|&({])(?:cd|chdir|Set-Location|Push-Location|sl|pushd)(?=$|\s)/im;

/** The block without comment lines and `<# … #>` comments (a placeholder or a path in a comment is harmless). */
function code(block: string): string {
  return block.replace(/<#[\s\S]*?#>/g, '').split(/\r?\n/).filter(l => !/^\s*(?:#|REM\b|::)/i.test(l)).join('\n');
}

/** Words of one command line, quotes removed (good enough for paths and program names). */
function words(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  return out;
}

/** The command segments: lines split at ; && || (a pipe keeps its left side: `x | bash` reads x). */
function segments(text: string): { words: string[]; piped: boolean }[] {
  const out: { words: string[]; piped: boolean }[] = [];
  for (const line of text.split(/\r?\n/)) {
    for (const part of line.split(/;|&&|\|\|/)) {
      const pipes = part.split(/(?<!\|)\|(?!\|)/);
      pipes.forEach((p, i) => { const w = words(p.trim()); if (w[0] === '&' || w[0] === '.') w.shift(); if (w.length) out.push({ words: w, piped: i > 0 }); });
    }
  }
  return out;
}

/** A path with %VAR%, $env:VAR and ~ expanded; null when another variable is in it (it is known only when it runs). */
function expand(p: string, e: CheckEnv): string | null {
  const env = e.env ?? {};
  const get = (k: string): string | undefined => env[k] ?? Object.entries(env).find(([n]) => n.toLowerCase() === k.toLowerCase())?.[1];
  let bad = false;
  let s = p.replace(/%([A-Za-z_][\w()]*)%/g, (_, k: string) => get(k) ?? ((bad = true), ''))
    .replace(/\$\{?env:([A-Za-z_][\w()]*)\}?/gi, (_, k: string) => get(k) ?? ((bad = true), ''));
  if (bad || /[$%*?`]/.test(s)) return null;
  if (/^~(?=$|[\\/])/.test(s) && e.home) s = e.home + s.slice(1);
  return s;
}

const isAbs = (p: string, platform: NodeJS.Platform): boolean => (platform === 'win32' ? /^[A-Za-z]:[\\/]|^\\\\/.test(p) : p.startsWith('/'));
const join = (dir: string, rel: string, platform: NodeJS.Platform): string => {
  const sep = platform === 'win32' ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${sep}${rel.replace(/^\.[\\/]/, '').replace(/[\\/]/g, sep)}`;
};

/** The block with quoted text blanked (here-strings and multi-line strings too) and inline comments dropped: what is
 *  left is what PowerShell reads as code. keepAlone = a quoted string that is only a `<name>` stays (a "<path>" left in). */
function bare(text: string, keepAlone = false): string {
  const q = keepAlone ? /"(?!<[^"<>\s]*>")[^"]*"|'(?!<[^'<>\s]*>')[^']*'/g : /"[^"]*"|'[^']*'/g;
  return text.replace(/@"[\s\S]*?\n"@|@'[\s\S]*?\n'@/g, '""')
    .replace(/(-(?:not)?match|-(?:not)?like|-c?replace|-split|-Pattern|Select-String)\s+("[^"]*"|'[^']*')/gi, '$1 ""')
    .replace(q, m => `""${'\n'.repeat(m.split('\n').length - 1)}`)
    .split('\n').map(l => l.replace(/(^|\s)#.*$/, '')).join('\n');
}

const INTERP = /^(?:node|python3?|py|bash|sh|pwsh|powershell)(?:\.exe)?$/i;
const POSIX_SHELL = /^(?:bash|sh|wsl)(?:\.exe)?$/i;
const base = (w: string): string => w.split(/[\\/]/).pop() ?? '';

/** What makes this command fail before it starts, in Italian (the chats speak Italian with the user); [] = none found. */
export function commandProblems(block: string, e: CheckEnv): string[] {
  const platform = e.platform ?? process.platform;
  const text = code(block);
  const out: string[] = [];
  // PowerShell only: in bash `<` is a redirection (sort <in.txt)
  const ph = platform === 'win32' ? PLACEHOLDER.exec(bare(text, true)) : null;
  if (ph) out.push(`contiene un segnaposto da riempire: <${ph[1]}>`);
  const segs = segments(bare(text));
  for (const s of segs) {
    // a prompt for the keyboard: the segment's command (also `$x = Read-Host`), or `(Get-Credential)` as an argument
    const cmd = s.words[1] === '=' ? s.words[2] : s.words[0];
    const w = WAITS.exec(cmd ?? '') ?? s.words.map(x => /^\((Read-Host|Get-Credential)\)?$/i.exec(x)).find(Boolean);
    if (w) { out.push(`${w[1]} aspetta un input da tastiera: Esegui non ne ha`); break; }
  }
  for (const s of segments(text)) {
    const [prog = '', ...args] = s.words;
    const name = base(prog);
    if (!SHELLS.test(name)) continue;
    if ((!s.piped && args.every(a => IDLE_FLAG.test(a))) || args.some(a => /^-noexit$/i.test(a))) {
      out.push(`${name} parte senza un comando da eseguire e resta in attesa di input: Esegui non ha tastiera (usa per esempio -c "…" o -Command "…")`);
      break;
    }
  }
  // paths: only what the block starts (the program, after -File, after an interpreter); real words, so the quoted
  // paths come from the raw text's segments
  const seen = new Set<string>(), moves = MOVES.test(bare(text));
  segments(text).forEach((s, si) => {
    if (platform === 'win32' && /^wsl(?:\.exe)?$/i.test(base(s.words[0] ?? ''))) return;   // Linux paths inside WSL
    s.words.forEach((w, i) => {
      if (!RUNS_EXT.test(w) || seen.has(w)) return;
      seen.add(w);
      const prev = s.words[i - 1] ?? '';
      const started = i === 0 || /^-file$/i.test(prev) || INTERP.test(base(prev));
      if (!started) return;
      // a POSIX path given to bash on Windows (/c/Users/…, ~/x.sh): not a Windows path
      if (platform === 'win32' && /^[/~]/.test(w) && POSIX_SHELL.test(base(prev))) return;
      // the block may create it first (a download, a copy, a build that names it)
      if (text.slice(0, text.indexOf(w)).includes(w.replace(/^\.[\\/]/, ''))) return;
      const p = expand(w, e);
      if (p === null) return;
      if (isAbs(p, platform)) { if (!e.exists(p)) out.push(`il percorso ${w} non esiste su questo PC`); return; }
      // a relative script: only in the block's first command (a build or a cd before it may make it), with a folder
      if (si > 0 || moves || (!/[\\/]/.test(w) && i === 0)) return;
      if (!e.exists(join(e.cwd, w, platform))) out.push(`lo script ${w} non esiste nella cartella ${e.cwd}`);
    });
  });
  return [...new Set(out)];
}
