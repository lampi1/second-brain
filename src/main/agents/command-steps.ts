// A command line as the plain steps it runs, for the read-only classifier (tool-policy.ts readOnlyCommand, issue #485):
// a chain (`a && b`, `a; b`, one per line), a bash `for NAME in literals; do …; done` loop, a bash function defined
// and called on the same line (`Q(){ grep -rn "$1" src; }; Q foo`), a `cd` to a literal folder and the redirections
// that only throw output away (`2>/dev/null`, `2>&1`, PowerShell `2>$null`) are read here, so each step is checked on
// its own by the strict one-command check, with the loop's values and the call's arguments written in. What the
// reader cannot follow returns null and the line stays the user's call, as before: a substitution, a background `&`,
// a nested loop, a variable that is not the loop's or a positional argument, a value or argument that is not plain
// text. Pure; used by tool-policy.ts; pinned by test/unit/agents/command-steps.test.ts.

/** The shell that runs the line: Claude's Bash (Git Bash on Windows) and PowerShell tools say it, the other engines'
 *  command tools do not (PowerShell, bash or cmd). */
export type CommandShell = 'bash' | 'powershell' | null;
export const shellOfTool = (tool: string): CommandShell => tool === 'Bash' ? 'bash' : tool === 'PowerShell' ? 'powershell' : null;

/** One step: a command to check, or a move of the folder (`cd`). certain: the next steps run only if the move worked
 *  (`cd x && …`); after an uncertain one the folder is not known. */
export type Step = { text: string } | { cd: string; certain: boolean };

const MAX_STEPS = 200, MAX_VALUES = 50, MAX_DEPTH = 3;
/** a loop's variable: lower case (a variable of the environment, PATH or IFS, would change what runs), no proxy */
const LOOP_NAME = /^(?!(?:https?|ftp|all|no)_proxy$)[a-z_][a-z0-9_]*$/;
/** a loop value or a call's argument written into the body: plain text that means the same quoted or not */
const PLAIN_VALUE = /^[\w.\/:@+,=%-]+$/;
/** a call's argument, quoted: anything that cannot end the quote or start an expansion */
const QUOTED_ARG = /^[^$`\\"'\r\n]*$/;
/** redirections that only throw output away, per shell (the null device each shell knows) */
const DISCARD: Record<'bash' | 'powershell' | 'other', RegExp> = {
  // each ends where a word ends: bash reads `>&2pwned` as a file named 2pwned
  bash: /^(?:[12]?>&[12]|(?:&|[12])?>{1,2}[ \t]*\/dev\/null|<[ \t]*\/dev\/null)(?![^\s;&|)])/,
  // `nul` is a plain file name for pwsh off Windows: only $null
  powershell: /^(?:[1-6*]?>&1|[1-6*]?>{1,2}[ \t]*\$null)(?![^\s;&|)])/i,
  other: /^[12]?>&1(?![^\s;&|)])/,
};
const MOVES = /^(?:cd|pushd|chdir|set-location|sl|push-location)$/i;

interface Piece { text: string; sep: string }

/** The line in pieces between separators, outside quotes, discarding redirections removed. null: a background `&`, a
 *  `|&`, an unterminated quote, or a `;` where the shell may be cmd (it is no separator there). */
function pieces(raw: string, shell: CommandShell): Piece[] | null {
  const out: Piece[] = [];
  const discard = DISCARD[shell ?? 'other'];
  let cur = '', quote: '"' | "'" | null = null;
  const push = (sep: string) => { out.push({ text: cur.trim(), sep }); cur = ''; };
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    // a comment (bash, PowerShell) runs to the end of its line, whatever quotes it holds; cmd has none
    if (ch === '#' && shell && (cur === '' || /\s$/.test(cur))) { while (i + 1 < raw.length && raw[i + 1] !== '\n') i++; continue; }
    const rest = raw.slice(i);
    // a redirection starts a word: in `a2>/dev/null` the 2 belongs to the file name
    const thrown = /^[\d&]/.test(ch) && cur !== '' && !/\s$/.test(cur) ? null : discard.exec(rest);
    if (thrown) { cur += ' '; i += thrown[0].length - 1; continue; }
    if (rest.startsWith('&&') || rest.startsWith('||')) { push(rest.slice(0, 2)); i++; continue; }
    if (rest.startsWith('|&')) return null;
    if (ch === '&') return null;
    if (ch === '\n') { push('\n'); continue; }
    if (ch === '\r' && raw[i + 1] === '\n') continue;
    if (ch === ';') { if (!shell) return null; push(';'); continue; }
    cur += ch;
  }
  if (quote) return null;
  push('');
  return out.filter(p => p.text !== '');
}

/** The words of a piece, quotes removed (a quoted stretch stays in its word). null: quotes it cannot read. */
function words(text: string, shell: CommandShell): { word: string; quoted: boolean }[] | null {
  const out: { word: string; quoted: boolean }[] = [];
  const re = /(?:"[^"]*"|'[^']*'|[^\s"'])+/g;
  // the word as the shell looks it up: every quote gone, and under bash every backslash (`ca""t` and `ca\t` are `cat`);
  // PowerShell and cmd keep a backslash, their folder separator
  const esc = shell === 'bash';
  for (const m of text.matchAll(re)) out.push({ word: m[0].replace(/"([^"]*)"|'([^']*)'/g, '$1$2').replace(esc ? /\\/g : /(?!)/g, ''), quoted: /["']/.test(m[0]) || (esc && m[0].includes('\\')) });
  return out;
}

/** `$NAME` and `${NAME}` written as the value (the value is plain: the same quoted or not). */
const fill = (text: string, name: string, value: string): string =>
  text.replace(new RegExp(`\\$\\{${name}\\}|\\$${name}(?![\\w])`, 'g'), () => value);

/** A function's positional arguments ($1…$9, ${1}…${9}) written in; a missing one is empty. */
const fillArgs = (text: string, args: string[]): string =>
  text.replace(/\$\{([1-9])\}|\$([1-9])(?!\d)/g, (_m, a?: string, b?: string) => args[Number(a ?? b) - 1] ?? '');

interface Fn { body: string[]; called?: true }

/** The steps of a line, or null when the reader cannot follow it. */
export function commandSteps(raw: string, shell: CommandShell): Step[] | null {
  // a substitution or a heredoc anywhere (also inside a function never called, or in quotes bash would still expand)
  if (/`|\$\(|[<>]\(|<</.test(raw)) return null;
  // an escaped blank or line end (`a\ #` is one word, `\` + newline joins two lines), and a lone carriage return (PowerShell
  // ends a comment there): where a comment or a piece ends would differ from the shell's
  if (/\\\s|\r(?!\n)/.test(raw)) return null;
  // bash's ${b} and ${1} as $b and $1 (followed by no name character, the same thing)
  const list = pieces(shell === 'bash' ? raw.replace(/\$\{([a-z_]\w*|[1-9])\}(?!\w)/gi, (_m, n: string) => `$${n}`) : raw, shell);
  if (!list) return null;
  const fns = new Map<string, Fn>();
  const steps = expand(list, shell, fns, 0);
  // a function defined and never called on the line: what for (its body was never checked)
  return steps && [...fns.values()].every(f => f.called) ? steps : null;
}

function expand(list: Piece[], shell: CommandShell, fns: Map<string, Fn>, depth: number): Step[] | null {
  const out: Step[] = [];
  const add = (s: Step): boolean => { out.push(s); return out.length <= MAX_STEPS; };
  for (let i = 0; i < list.length; i++) {
    const p = list[i]!;
    if (shell === 'bash') {
      // for NAME in v1 v2 …; do …; done
      const loop = /^for\s+([A-Za-z_]\w*)\s+in\s+([\s\S]*)$/.exec(p.text);
      if (loop) {
        const name = loop[1]!, vals = words(loop[2]!, shell);
        if (!LOOP_NAME.test(name)) return null;
        if (!vals || !vals.length || vals.length > MAX_VALUES || vals.some(v => !PLAIN_VALUE.test(v.word))) return null;
        const body: Piece[] = [];
        let j = i + 1, closed = false;
        for (; j < list.length; j++) {
          let t = list[j]!.text;
          if (j === i + 1) { if (!/^do(?:\s|$)/.test(t)) return null; t = t.slice(2).trim(); }
          if (t === 'done') { closed = true; break; }
          if (/^(?:for|while|until|if|case|select|function)\b|\(\s*\)|[{}]/.test(t) || /(?:^|\s)done$/.test(t)) return null;
          if (t) body.push({ text: t, sep: list[j]!.sep });
        }
        if (!closed || !body.length) return null;
        for (const v of vals) {
          const filled = body.map(b => ({ ...b, text: fill(b.text, name, v.word) }));
          const steps = expand(filled, shell, fns, depth + 1);
          if (!steps || steps.some(s => 'cd' in s)) return null;   // a move inside a loop: where the next turn runs is lost
          for (const s of steps) if (!add(s)) return null;
        }
        i = j;
        continue;
      }
      // NAME(){ …; }  or  function NAME { …; }
      const def = /^(?:function\s+([A-Za-z_][\w-]*)\s*(?:\(\s*\))?|([A-Za-z_][\w-]*)\s*\(\s*\))\s*\{([\s\S]*)$/.exec(p.text);
      if (def) {
        const name = def[1] ?? def[2]!;
        const body: string[] = [];
        const first = def[3]!.trim();
        let j = i, closed = false;
        for (;;) {
          const t = j === i ? first : list[j]!.text;
          if (t === '}') { closed = true; break; }
          if (t.endsWith('}') && !/[{}]/.test(t.slice(0, -1))) { const b = t.slice(0, -1).trim(); if (b) body.push(b); closed = true; break; }
          if (/[{}]/.test(t) || /^(?:for|while|until|if|case|select|function)\b/.test(t) || /\$(?:[@*#?0!-]|\{[@*#?0!-])/.test(t)) return null;
          if (t) body.push(t);
          if (++j >= list.length) break;
        }
        if (!closed || !body.length) return null;
        fns.set(name, { body });
        i = j;
        continue;
      }
    }
    // a whole line of comment runs nothing (cmd has no such comment)
    if (shell && p.text.startsWith('#')) continue;
    const w = words(p.text, shell);
    if (!w || !w.length) return null;
    const head = w[0]!;
    const fn = !head.quoted ? fns.get(head.word) : undefined;
    // a defined function anywhere but at the head (a pipe stage, an argument of `xargs`) would run unchecked
    if ([...fns.keys()].some(n => w.slice(fn ? 1 : 0).some(x => x.word === n || x.word.split('|').includes(n)))) return null;
    if (fn) {
      fn.called = true;
      if (depth >= MAX_DEPTH) return null;
      const args = w.slice(1);
      if (args.some(a => !(a.quoted ? QUOTED_ARG : PLAIN_VALUE).test(a.word))) return null;
      // an argument with blanks is one word only where the body quotes it: kept quoted, the body's quotes around it
      // read it as one word either way
      const body = fn.body.map(t => ({ text: fillArgs(t, args.map(a => a.word)), sep: ';' }));
      if (args.some(a => /\s/.test(a.word)) && fn.body.some(t => /(?<!")\$\{?[1-9]/.test(t))) return null;
      const steps = expand(body, shell, fns, depth + 1);
      if (!steps || steps.some(s => 'cd' in s)) return null;
      for (const s of steps) if (!add(s)) return null;
      continue;
    }
    if (!head.quoted && MOVES.test(head.word)) {
      const to = w.slice(1);
      if (to.length !== 1 || /[$`*?\[\]]/.test(to[0]!.word) || to[0]!.word.startsWith('-')) return null;
      // `a || cd x && b`: b also runs when a worked and the move never happened
      if (!add({ cd: to[0]!.word, certain: p.sep === '&&' && list[i - 1]?.sep !== '||' })) return null;
      continue;
    }
    if (!add({ text: p.text })) return null;
  }
  return out;
}
