// The simple commands of a shell line or script, with their words out of the quotes (ADR 0355): quotes, comments,
// substitutions, blocks, heredocs, and the variables and arguments whose value the text itself gives. Bash and PowerShell
// read the same characters differently, so the caller names the shell. Linear; null when the text cannot be trusted
// (an open quote, nesting too deep). Used by delegated-holds.ts; not an interpreter: a net over what the text says.
export type Shell = 'bash' | 'powershell';
export interface Command {
  /** out of their quotes; a substitution inside is `$()`, its commands are listed on their own */
  words: string[];
  /** the words as one line: a word that needs quotes has double ones */
  text: string;
  /** as written */
  raw: string;
  /** the same number: one pipeline */
  pipe: number;
  /** inside a substitution: its output is used by another command */
  nested: boolean;
  /** PowerShell: starts with a string, a value and not a program */
  value: boolean;
  /** PowerShell: after `&` */
  called: boolean;
  /** its output goes to a file */
  writes: boolean;
  inputs: string[];
  /** heredocs and here-strings; asText: written with a quoted delimiter */
  body: string; asText: boolean;
}

const MAX_DEPTH = 40, MAX_GROWTH = 400_000, MAX_VALUE = 20_000;
class Untrusted extends Error {}

export const render = (w: string): string => w === '' || /[\s;&|()"'`,\]<>]/.test(w) ? `"${w.replace(/"/g, "'")}"` : w;
export const rendered = (words: readonly string[]): string => words.map(render).join(' ');
export const command = (words: string[], raw: string, over: Partial<Command> = {}): Command =>
  ({ words, text: rendered(words), raw, pipe: -1, nested: false, value: false, called: false, writes: false, inputs: [], body: '', asText: false, ...over });

/** @param args the arguments a script is called with; null: not known @param named PowerShell's named parameters */
export function readCommands(src: string, shell: Shell, args: readonly string[] | null = null, named: ReadonlyMap<string, string> = new Map()): Command[] | null {
  const bash = shell === 'bash', out: Command[] = [];
  const vars = new Map(named), unsure = new Set<string>();
  const bodies: { cmd: Command; end: string; strip: boolean }[] = [];
  let i = 0, pipes = 0, grown = 0, braces = 0, blocks = 0, here = false;
  let given = args === null ? null : [...args];

  const known = (name: string, fallback?: string): string[] | undefined => {
    if (name === '@' || name === '*' || (!bash && name === 'args')) return given === null || (bash && braces) ? undefined : [...given];
    if (bash && /^\d+$/.test(name)) return name === '0' || given === null || braces ? undefined : [given[+name - 1] || (fallback ?? '')];
    const v = vars.get(bash ? name : name.toLowerCase());
    return v === undefined ? undefined : [v];
  };
  const BASH_VAR = /\$(?:([A-Za-z_]\w*|\d|[@*])|\{([A-Za-z_]\w*|\d+|[@*])(?::?[-=]([^}$`"']*))?\})/y, PS_VAR = /\$(?:(\w+)(?![\w:])|\{(\w+)\})/y;
  const variable = (): { length: number; values: string[] | undefined } | null => {
    const re = bash ? BASH_VAR : PS_VAR; re.lastIndex = i;
    const m = re.exec(src);
    if (!m) return null;
    let length = m[0].length, values = known((m[1] ?? m[2])!, m[3]);
    const at = !bash && /^args$/i.test(m[1] ?? '') ? /^\[(\d)\]/.exec(src.slice(i + length, i + length + 3)) : null;
    if (at) { length += at[0].length; values = values && [values[+at[1]!] ?? '']; }
    grown += values?.reduce((n, v) => n + v.length, 0) ?? 0;
    if (grown > MAX_GROWTH) throw new Untrusted();
    return { length, values };
  };
  const doubt = (name: string): void => { const k = bash ? name : name.toLowerCase(); vars.delete(k); unsure.add(k); };
  const assign = (name: string, value: string): void => {
    const k = bash ? name : name.toLowerCase();
    if (unsure.has(k) || value.length > MAX_VALUE || /[$`]/.test(value) || (vars.has(k) && vars.get(k) !== value)) doubt(name); else vars.set(k, value);
  };
  /** what a finished command changes for the ones after it */
  const learn = (c: Command): void => {
    const w = c.words;
    if (bash) {
      const at = /^(?:do|then|else|if|while|until)$/.test(w[0] ?? '') ? 1 : 0, prog = w[at] ?? '';
      for (const x of w) if (/^(?:if|while|until|for|case|select)$/.test(x) && x === w[0]) blocks++; else if (/^(?:fi|done|esac)$/.test(x) && x === w[0]) blocks--;
      const rest = /^(?:export|local|readonly|declare|typeset)$/.test(prog) ? w.slice(at + 1).filter(x => !x.startsWith('-')) : w.slice(at);
      if (rest.length && rest.every(x => /^[A-Za-z_]\w*\+?=/.test(x))) for (const x of rest) {
        const m = /^(\w+)(\+?)=([\s\S]*)$/.exec(x)!;
        if (m[2] || (braces && prog === 'local')) doubt(m[1]!); else assign(m[1]!, m[3]!);
      } else if (/^(?:read|for|select|getopts|mapfile|readarray|printf|unset)$/.test(prog)) for (const x of w) if (/^[A-Za-z_]\w*$/.test(x)) doubt(x);
      if (prog === 'shift' && !braces) { if (given && !blocks && /^\d*$/.test(w[at + 1] ?? '')) given = given.slice(+(w[at + 1] || 1)); else given = null; }
    } else if (/^\$\w+$/.test(w[0] ?? '') && /^[+-]?=$/.test(w[1] ?? '')) {
      if (w[1] === '=' && w.length === 3) assign(w[0]!.slice(1), w[2]!); else doubt(w[0]!.slice(1));
    }
  };

  const parse = (end: string, depth: number): void => {
    if (depth > MAX_DEPTH) throw new Untrusted();
    let cases = 0, word: string | null = null, called = false;
    const fresh = (pipe: number): { c: Command; start: number } => { const c = command([], '', { pipe, nested: depth > 0 }); out.push(c); return { c, start: i }; };
    let { c, start } = fresh(pipes++);
    const head = (): string => c.words.find(w => !/^(?:do|then|else|elif|if|while|until|!)$/.test(w)) ?? '';
    /** where the next word goes: an argument, or the file of a redirect */
    let to: string[] = c.words;
    const stop = (): void => { if (word !== null) { to.push(word); word = null; to = c.words; } };
    const add = (values: string[], split: boolean): void => {
      const list = split ? values.flatMap(v => v.trim().split(/\s+/)) : values;
      list.forEach((v, n) => { if (n) { to.push(word ?? ''); word = ''; } word = (word ?? '') + v; });
    };
    const flush = (next = i): void => {
      stop(); c.raw = src.slice(start, i); c.text = rendered(c.words); learn(c);
      if (head() === 'case') cases++; else if (head() === 'esac') cases--;
      i = next;
    };
    const follow = (length: number, piped: boolean): void => { const pipe = c.pipe; flush(i + length); ({ c, start } = fresh(piped ? pipe : pipes++)); to = c.words; };
    const nest = (skip: number, close: string, mark: string): void => { i += skip; parse(close, depth + 1); word = (word ?? '') + mark; };
    /** inside double quotes, up to the closing one */
    const double = (): void => {
      i++; word ??= '';
      for (;;) {
        if (i >= src.length) throw new Untrusted();
        const ch = src[i]!;
        if (ch === '"') { if (!bash && src[i + 1] === '"') { word += '"'; i += 2; continue; } i++; return; }
        if (ch === (bash ? '\\' : '`')) { word += bash && !/["\\$`]/.test(src[i + 1] ?? '') ? ch + (src[i + 1] ?? '') : src[i + 1] ?? ''; i += 2; continue; }
        if (src.startsWith('$(', i)) { nest(2, ')', '$()'); continue; }
        if (bash && ch === '`') { nest(1, '`', '$()'); continue; }
        if (ch === '$') { const v = variable(); if (v) { if (v.values) add(v.values, false); else word += src.slice(i, i + v.length); i += v.length; continue; } }
        word += ch; i++;
      }
    };
    while (i < src.length) {
      const ch = src[i]!, next = src[i + 1] ?? '';
      if (end && ch === end && !(end === ')' && (cases > 0 || head() === 'case') && head() !== 'esac' && word !== 'esac')) { flush(i + 1); return; }
      if (ch === (bash ? '\\' : '`')) { word = (word ?? '') + next; i += 2; continue; }
      if (ch === '#' && word === null) { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (!bash && ch === '<' && next === '#') { const e = src.indexOf('#>', i); if (e < 0) throw new Untrusted(); i = e + 2; continue; }
      if (!bash && ch === '@' && (next === '"' || next === "'")) {
        const e = src.indexOf(`\n${next}@`, i);
        if (e < 0) throw new Untrusted();
        word = (word ?? '') + src.slice(i + 2, e).trim(); i = e + 3; continue;
      }
      if (ch === '"') { if (!bash && word === null && !c.words.length && !called) c.value = true; double(); continue; }
      if (ch === "'") {
        if (!bash && word === null && !c.words.length && !called) c.value = true;
        const ansi = bash && word?.endsWith('$');
        let e = i + 1, text = '';
        for (;; e++) {
          if (e >= src.length) throw new Untrusted();
          if (ansi && src[e] === '\\') { text += src[++e] ?? ''; continue; }
          if (src[e] === "'") { if (!bash && src[e + 1] === "'") { text += "'"; e++; continue; } break; }
          text += src[e];
        }
        word = (ansi ? word!.slice(0, -1) : word ?? '') + text; i = e + 1; continue;
      }
      if (src.startsWith('$(', i)) { nest(2, ')', '$()'); continue; }
      if (bash && ch === '`') { nest(1, '`', '$()'); continue; }
      if (ch === '$') {
        if (!bash && word === null && !c.words.length && /^\$\w+\s*[+-]?=(?!=)/.test(src.slice(i, i + 80))) {
          word = /^\$\w+/.exec(src.slice(i, i + 80))![0]; i += word.length; stop();
          while (/[ \t]/.test(src[i] ?? '')) i++;
          word = src[i] === '=' ? '=' : src.slice(i, i + 2); i += word.length; stop(); called = true; continue;
        }
        const v = variable();
        if (v) { if (v.values) add(v.values, bash); else word = (word ?? '') + src.slice(i, i + v.length); i += v.length; continue; }
        if (next === '{') {
          word = (word ?? '') + '${'; i += 2;
          while (i < src.length && src[i] !== '}') { if (src.startsWith('$(', i)) nest(2, ')', '$()'); else { word += src[i]; i++; } }
          continue;
        }
        word = (word ?? '') + ch; i++; continue;
      }
      if (ch === '(') { nest(1, ')', '()'); continue; }
      if (ch === ')') {
        // a pattern of `case`, or a stray one
        const opens = head() === 'case', pattern = opens || cases > 0;
        if (pattern) { word = null; c.words.length = 0; to = c.words; }
        if (opens) { cases++; blocks++; }
        follow(1, false); continue;
      }
      if ((ch === '{' || ch === '}') && word === null && (!bash || /[\s;]|^$/.test(next) || (ch === '}' && /[)&|]/.test(next)))) { braces = Math.max(0, braces + (ch === '{' ? 1 : -1)); follow(1, false); continue; }
      if (!bash && (ch === '{' || ch === '}') && !word?.endsWith('$')) { follow(1, false); continue; }
      if (ch === '\n') {
        flush(i + 1);
        for (const b of bodies.splice(0)) {
          let line = '', text = '';
          do {
            const e = src.indexOf('\n', i), stopAt = e < 0 ? src.length : e;
            line = src.slice(i, stopAt); i = Math.min(src.length, stopAt + 1);
            if ((b.strip ? line.replace(/^\t+/, '') : line).trimEnd() === b.end) break;
            text += `${line}\n`;
          } while (i < src.length);
          b.cmd.body += text;
        }
        ({ c, start } = fresh(pipes++)); to = c.words; called = false; continue;
      }
      if (ch === ';') { follow(1, false); called = false; continue; }
      if (ch === '|') { const or = next === '|'; follow(or || next === '&' ? 2 : 1, !or); called = false; continue; }
      if (ch === '&' && next !== '>' && src[i - 1] !== '>' && src[i - 1] !== '<') { follow(next === '&' ? 2 : 1, false); called = c.called = true; continue; }
      if (ch === '&' && next === '>') { stop(); i++; continue; }
      if (ch === '<' && next === '<' && bash) {
        if (src[i + 2] === '<') { stop(); i += 3; to = c.inputs; while (/[ \t]/.test(src[i] ?? '')) i++; here = true; continue; }
        const m = /^<<(-?)[ \t]*(?:(['"])([\w.-]+)\2|(\\?)([\w.-]+))/.exec(src.slice(i, i + 80));
        if (m) { stop(); bodies.push({ cmd: c, end: (m[3] ?? m[5])!, strip: !!m[1] }); c.asText = !!(m[2] || m[4]); i += m[0].length; continue; }
      }
      if (ch === '>' || ch === '<') {
        if (next === '(') { i++; continue; }
        if (word !== null && /^[\d*]$/.test(word)) word = null;
        stop(); i++;
        if (src[i] === '>' || src[i] === '|') i++;
        if (src[i] === '&') { i++; while (/[\d-]/.test(src[i] ?? '')) i++; continue; }
        while (/[ \t]/.test(src[i] ?? '')) i++;
        if (ch === '<') to = c.inputs; else { to = []; if (!/^(?:\/dev\/(?:null|stderr)|\$null|nul\b)/i.test(src.slice(i, i + 12))) c.writes = true; }
        continue;
      }
      if (/\s/.test(ch)) { stop(); i++; continue; }
      word = (word ?? '') + ch; i++;
    }
    if (end) throw new Untrusted();
    flush();
  };
  try { parse('', 0); } catch (e) { if (e instanceof Untrusted) return null; throw e; }
  if (here) for (const c of out) if (c.inputs.length) c.body += `${c.inputs.join('\n')}\n`;
  return out.filter(c => c.words.length || c.body);
}
