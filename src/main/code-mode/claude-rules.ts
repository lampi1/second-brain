// Claude's own permission rules for run_code's internal calls (Code Mode, ADR 0331). A Claude chat in Code Mode no
// longer sees its native Bash/Read/Edit/… tools, so Claude never checks those calls against its deny and ask rules: the
// user's, the project's and local settings files, the managed policy, and the session's inline --settings (the STABLE
// app's guard rails, stableGuards, among them). This module reads the same rules and matches a wrapper call against
// them, so a call Claude would deny is denied and one it would ask about asks. Fail closed: a settings file that exists
// but cannot be read or parsed denies every call (the app cannot tell what it would forbid). Matching leans to the
// safe side (a deny pattern matches each part of a compound command, either Bash or PowerShell rule forms, a path rule
// with no folder anywhere). Sets are cached by their files' state and rules compiled once, so a call with thousands of
// rules stays in milliseconds on Electron's main thread. Pure apart from reading the files; used by chats/manager-sink.ts (decideFor) and the
// wrappers' search filter (code-mode/natives.ts), tested in test/unit/code-mode/claude-rules.test.ts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** One rule with the folder its relative `/x` paths start from (the settings file's project root). */
export interface ClaudeRule { rule: string; base: string }
export type ClaudeRuleSet = { ok: true; deny: ClaudeRule[]; ask: ClaudeRule[] } | { ok: false; error: string };

/** Where one Claude session reads its rules: its settings files (Claude's order), its inline --settings, and the
 *  folder it works in (relative paths of the rules and of the calls). */
export interface ClaudeRuleSources { files: string[]; inline: Record<string, unknown> | null; cwd: string }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Claude's settings files for a session in `cwd`: managed policy, the user's (CLAUDE_CONFIG_DIR or ~/.claude), the
 *  project's shared and local ones. */
export function claudeRuleFiles(cwd: string, env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string[] {
  const managed = process.platform === 'win32'
    ? [path.join(env.ProgramFiles ?? 'C:\\Program Files', 'ClaudeCode', 'managed-settings.json'), path.join(env.ProgramData ?? 'C:\\ProgramData', 'ClaudeCode', 'managed-settings.json')]
    : process.platform === 'darwin' ? ['/Library/Application Support/ClaudeCode/managed-settings.json'] : ['/etc/claude-code/managed-settings.json'];
  const user = env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, 'settings.json') : path.join(home, '.claude', 'settings.json');
  return [...new Set([...managed, user, path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json')].map(f => path.resolve(f)))];
}

/** Readable sets by their sources' identity (each file's path, size and times, the inline settings, cwd, home): a
 *  call reads the files again only when one changed. Only readable sets are kept (an unreadable one is read again
 *  at the next call, fail closed); a few entries, the oldest out first. */
const setCache = new Map<string, Extract<ClaudeRuleSet, { ok: true }>>();
const SET_CACHE_MAX = 16;

/** The cache key of a session's sources, or null when a file's state cannot be told (no caching: read it). */
function sourcesKey(src: ClaudeRuleSources, home: string): string | null {
  const stamps: string[] = [];
  for (const file of src.files) {
    try { const st = fs.statSync(file); stamps.push(`${file}|${st.size}|${st.mtimeMs}|${st.ctimeMs}|${st.isFile() ? 'f' : 'x'}`); }
    catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') { stamps.push(`${file}|-`); continue; }
      return null;
    }
  }
  return JSON.stringify([stamps, src.inline, src.cwd, home]);
}

/** The deny and ask rules of a session's sources (auto mode's soft_deny `Tool(pattern)` rules count as ask). A file
 *  that is missing adds nothing; one that exists but cannot be read or parsed makes the whole set unreadable. The
 *  same unchanged sources give the same set (cached: its rules stay compiled across calls). */
export function readClaudeRuleSet(src: ClaudeRuleSources, home = os.homedir()): ClaudeRuleSet {
  const key = sourcesKey(src, home);
  const hit = key !== null ? setCache.get(key) : undefined;
  if (hit) return hit;
  const set = readRuleSetNow(src, home);
  if (set.ok && key !== null) {
    setCache.set(key, set);
    while (setCache.size > SET_CACHE_MAX) setCache.delete(setCache.keys().next().value!);
  }
  return set;
}

function readRuleSetNow(src: ClaudeRuleSources, home: string): ClaudeRuleSet {
  const deny: ClaudeRule[] = [], ask: ClaudeRule[] = [];
  const add = (j: Record<string, unknown>, base: string): void => {
    const p = obj(j.permissions);
    for (const r of strs(p.deny)) deny.push({ rule: r, base });
    for (const r of strs(p.ask)) ask.push({ rule: r, base });
    for (const r of strs(obj(j.autoMode).soft_deny)) { const m = /^([A-Za-z]+\(.*?\))(\s|$)/.exec(r.trim()); if (m) ask.push({ rule: m[1]!, base }); }
  };
  for (const file of src.files) {
    let text: string;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') continue; return { ok: false, error: `${file} could not be read` }; }
    if (!text.trim()) continue;
    let j: unknown;
    try { j = JSON.parse(text); } catch { return { ok: false, error: `${file} is not valid JSON` }; }
    const dir = path.dirname(file);
    add(obj(j), path.basename(dir) === '.claude' ? path.dirname(dir) : path.dirname(file) === path.join(home, '.claude') ? home : dir);
  }
  if (src.inline) add(src.inline, src.cwd);
  return { ok: true, deny, ask };
}

/** The rule kinds a wrapper call meets: Bash and PowerShell meet Bash and PowerShell rules, Read/Grep/Glob meet Read rules, Write
 *  and Edit meet every file-editing tool's rules. */
const READS = new Set(['Read', 'Grep', 'Glob']), EDITS = new Set(['Write', 'Edit']);
const EDIT_RULES = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

const esc = (s: string): string => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
const ci = process.platform === 'win32' ? 'i' : '';

/** An absolute path in one comparable form: forward slashes, a drive as `c:` (Claude's `//c/x` is the same place). */
function canon(p: string): string {
  let s = p.replace(/\\/g, '/');
  const posixDrive = /^\/\/([A-Za-z])(\/|$)/.exec(s);
  if (posixDrive) s = `${posixDrive[1]!.toLowerCase()}:/${s.slice(4)}`;
  else if (s.startsWith('//')) s = s.slice(1);
  s = s.replace(/^([A-Za-z]):/, (_m, d: string) => `${d.toLowerCase()}:`);
  return s.replace(/\/+$/, '') || '/';
}

/** A gitignore-style glob (`**` any folders, `*` within a name, `?` one character) as a RegExp over a canon path;
 *  `x/**` also matches the folder x itself. */
function pathRe(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += esc(c);
  }
  return new RegExp(`^${re.replace(/\/\.\*$/, '(?:/.*)?')}$`, ci);
}

/** The places a Claude path pattern names, as canon globs: `~/x` home, `//x` or `C:/x` absolute, `/x` from the
 *  settings file's root, anything else from the chat's folder and (with no folder in it, gitignore's rule) anywhere. */
function pathGlobs(pattern: string, base: string, cwd: string, home: string): string[] {
  const p = pattern.replace(/\\/g, '/');
  if (p === '~' || p.startsWith('~/')) return [canon(path.join(home, p.slice(1)))];
  if (p.startsWith('//') || /^[A-Za-z]:\//.test(p)) return [canon(p)];
  if (p.startsWith('/')) return [canon(path.join(base, p))];
  const rel = p.replace(/^\.\//, '');
  return [canon(path.join(cwd, rel)), ...(rel.startsWith('**/') ? [] : [`**/${rel}`])];
}

/** The parts of a command line a rule can name: the whole, and each command of a compound one (`;`, `&&`, `||`, `|`, a
 *  new line, `$(…)`, backticks, a single `&`, a quoted `-c "…"`), with leading `VAR=value` assignments, `sudo` and
 *  PowerShell's call (`&`) and dot-source (`.`) operators taken off; the whole line without quotes too (`& 'git' push`). */
export function commandParts(command: string): string[] {
  const parts = command.split(/&&|\|\||[;|&\n`]|\$\(|\(|\)|\{|\}|["']/).map(s => s.trim()).filter(Boolean);
  const bare = (s: string): string => s.replace(/^(?:&|\.)\s+/, '').replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '').replace(/^(?:sudo|exec|command|nohup|env)\s+/, '');
  const unquoted = bare(command.replace(/["']/g, '').trim());
  return [...new Set([command.trim(), ...parts, ...parts.map(bare), unquoted].filter(Boolean))];
}

/** A Bash/PowerShell rule's pattern as a test over one command part: `prefix:*` (or a trailing ` *`) a part starting
 *  with it, `a * b` a wildcard over a part, else a part equal to it. */
function commandTest(pattern: string, flags: string): (part: string) => boolean {
  const prefix = /^(.*?)(?::\*| \*)$/s.exec(pattern);
  if (prefix) { const pre = new RegExp(`^${prefix[1]!.split('*').map(esc).join('.*')}`, flags); return p => pre.test(p); }
  if (pattern.includes('*')) { const re = new RegExp(`^${pattern.split('*').map(esc).join('.*')}$`, flags); return p => re.test(p); }
  if (!flags) return p => p === pattern;
  const low = pattern.toLowerCase();
  return p => p.toLowerCase() === low;
}

/** One rule parsed once (ruleMatches used to build its RegExps at every call: with thousands of rules a Bash call
 *  took hundreds of ms on Electron's main thread). */
type Compiled =
  | { kind: 'none' }
  | { kind: 'mcp'; server: string; name: string | undefined }
  | { kind: 'cmd'; every: boolean; test: ((part: string) => boolean) | null }
  | { kind: 'file'; tool: string; every: boolean; pat: string | undefined; globs: Map<string, RegExp[]> };
const compiled = new WeakMap<ClaudeRule, Compiled>();

function compile(r: ClaudeRule): Compiled {
  const had = compiled.get(r);
  if (had) return had;
  const rule = r.rule.trim();
  let c: Compiled;
  if (rule.startsWith('mcp__')) {
    const [, server, name] = /^mcp__(.+?)(?:__(.+))?$/s.exec(rule) ?? [];
    c = server ? { kind: 'mcp', server, name } : { kind: 'none' };
  } else {
    const m = /^([A-Za-z]+)(?:\((.*)\))?$/s.exec(rule);
    if (!m) c = { kind: 'none' };
    else {
      const kind = m[1]!, pat = m[2];
      const every = pat === undefined || pat === '' || pat === '*' || pat === '**';
      c = kind === 'Bash' || kind === 'PowerShell'
        ? { kind: 'cmd', every, test: every ? null : commandTest(pat!, kind === 'PowerShell' ? 'i' : ci) }
        : { kind: 'file', tool: kind, every, pat, globs: new Map() };
    }
  }
  compiled.set(r, c);
  return c;
}

/** One call as the matchers read it: its command's parts split once, its target path once. */
interface CallView { tool: string; args: Record<string, unknown>; cwd: string; home: string; parts?: string[]; target?: string | null }
const partsOf = (v: CallView): string[] => (v.parts ??= commandParts(typeof v.args.command === 'string' ? v.args.command : ''));

function matches(r: ClaudeRule, v: CallView): boolean {
  const c = compile(r);
  const tool = v.tool;
  switch (c.kind) {
    case 'none': return false;
    case 'mcp': return tool.startsWith(`mcp__${c.server}__`) && (!c.name || c.name === '*' || tool === `mcp__${c.server}__${c.name}`);
    case 'cmd': return (tool === 'Bash' || tool === 'PowerShell') && (c.every || partsOf(v).some(c.test!));
    case 'file': {
      const reads = c.tool === 'Read' && READS.has(tool), edits = EDIT_RULES.has(c.tool) && EDITS.has(tool);
      if (!reads && !edits && c.tool !== tool) return false;
      if (c.every) return true;
      if (!reads && !edits) return false;
      if (v.target === undefined) { const t = targetOf(tool, v.args, v.cwd); v.target = t ? canon(t) : null; }
      if (v.target === null) return true; // no path to check: the safe side
      const where = `${r.base}\n${v.cwd}\n${v.home}`;
      let res = c.globs.get(where);
      if (!res) { res = pathGlobs(c.pat!, r.base, v.cwd, v.home).map(pathRe); c.globs.set(where, res); }
      const t = v.target;
      return res.some(re => re.test(t));
    }
  }
}

/** The path a file or search wrapper call points at (a search without one: the chat's folder). */
const targetOf = (tool: string, input: Record<string, unknown>, cwd: string): string | null => {
  const p = tool === 'Grep' || tool === 'Glob' ? (typeof input.path === 'string' && input.path ? input.path : '.') : input.file_path;
  return typeof p === 'string' && p ? path.resolve(cwd, p) : null;
};

/** True when one Claude rule (`Tool`, `Tool(pattern)`, `mcp__server`, `mcp__server__tool`) covers this call. `tool`
 *  is the gate's name (the wrapper's bare name, or `mcp__<server>__<tool>`). */
export function ruleMatches(r: ClaudeRule, tool: string, input: unknown, cwd: string, home = os.homedir()): boolean {
  return matches(r, { tool, args: obj(input), cwd, home });
}

/** Claude's verdict on one wrapper call: deny wins over ask; null = no rule of the user's names it. */
export function claudeVerdict(set: Extract<ClaudeRuleSet, { ok: true }>, tool: string, input: unknown, cwd: string, home = os.homedir()): { kind: 'deny' | 'ask'; rule: string } | null {
  const v: CallView = { tool, args: obj(input), cwd, home };
  const d = set.deny.find(r => matches(r, v));
  if (d) return { kind: 'deny', rule: d.rule };
  const a = set.ask.find(r => matches(r, v));
  return a ? { kind: 'ask', rule: a.rule } : null;
}

/** The search wrappers' filter (Grep, Glob): false for a file a Read deny rule covers, so a search of a folder never
 *  returns what a Read of that file would be refused. */
export function readableBy(set: Extract<ClaudeRuleSet, { ok: true }>, cwd: string, home = os.homedir()): (abs: string) => boolean {
  const reads = set.deny.filter(r => /^Read\(/.test(r.rule.trim()));
  if (!reads.length) return () => true;
  return abs => { const v: CallView = { tool: 'Read', args: { file_path: abs }, cwd, home }; return !reads.some(r => matches(r, v)); };
}
