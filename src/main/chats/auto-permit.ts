// The app answers a chat's permission requests itself (ADR 0103, owner's explicit OK 2026-10-21): normal work passes
// without a popup, destructive commands are refused with their reason, and only what leaves the machine, changes
// settings or hooks, or cannot be read with confidence still reaches the user. "Normal work" = reading inside the chat's
// folder, and, while the turn has a checkpoint («Annulla l'ultimo turno» can put the files back), editing files and
// running local commands inside it. A role the user narrowed to «Chiede conferma» or «Solo piano» is always asked (only
// the refusals apply); «Accetta modifiche» lets reads and edits through, commands only when they read.
// Pure (the file system only to resolve links); used by ChatManager's sink.pending after the role gate; pinned by
// test/unit/chats/auto-permit.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { PermissionCeiling } from '../../shared/agents';
import { COMMAND_TOOLS, readOnlyCommand, type ReadScripts } from '../agents/tool-policy';

export interface PermitRequest { type: string; tool: string; input?: unknown }
export interface PermitContext {
  /** the chat's folder: the only place it reads, writes and runs without asking */
  cwd: string;
  /** the role's limit set by the user on its card (null = none) */
  ceiling: PermissionCeiling | null;
  /** this turn has a checkpoint: its file changes can be undone */
  undoable: boolean;
  /** the brain's declared read-only node tools (agents/read-tools.ts) */
  readScripts?: ReadScripts;
}
export type PermitVerdict =
  | { kind: 'allow' }
  | { kind: 'ask' }
  /** reason: Italian, for the chat; message: English, what the model reads */
  | { kind: 'deny'; shown: string; reason: string; message: string };

const ASK: PermitVerdict = { kind: 'ask' };
const ALLOW: PermitVerdict = { kind: 'allow' };

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'Search', 'TodoWrite', 'Think', 'WebSearch']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Delete', 'Move']);
/** tools that list or search a folder: no path = the chat's folder */
const FOLDER_TOOLS = new Set(['Glob', 'Grep', 'LS', 'Search']);
/** tools with no path at all */
const PATHLESS = new Set(['TodoWrite', 'Think', 'WebSearch']);
/** files that hold settings, hooks, credentials or the repository itself: a change there is the user's call */
const PROTECTED_DIRS = new Set(['.git', '.claude', '.cursor', '.codex', '.githooks', '.husky', '.vscode', '.idea']);
const PROTECTED_FILE = /^(\.env(\..*)?|\.envrc|\.npmrc|\.yarnrc(\.yml)?|\.pypirc|\.netrc|\.gitconfig|\.mcp\.json|\.guardallow|\.gitmodules)$/i;

const lower = (s: string): string => s.toLowerCase();
const looksAbsolute = (p: string): boolean => path.isAbsolute(p) || /^[A-Za-z]:([\\/]|$)/.test(p) || p.startsWith('\\\\');
const samePath = (a: string, b: string): boolean => (process.platform === 'win32' ? lower(a) === lower(b) : a === b);

/** The real path of p, or of its deepest existing ancestor with the rest appended (a file about to be written). */
function realish(p: string): string {
  let cur = p;
  const rest: string[] = [];
  for (let i = 0; i < 64; i++) {
    try { return path.join(fs.realpathSync.native(cur), ...rest.reverse()); } catch { /* not there yet */ }
    const up = path.dirname(cur);
    if (up === cur) break;
    rest.push(path.basename(cur));
    cur = up;
  }
  return p;
}

/** The path relative to the chat's folder, links resolved; null = outside it (or not a plain path). */
function within(cwd: string, p: string): string | null {
  if (!p || p.includes('\0') || p.startsWith('~')) return null;
  if (!path.isAbsolute(cwd)) return null;
  if (looksAbsolute(p) && !path.isAbsolute(p)) return null; // a Windows path on another platform
  const root = realish(path.resolve(cwd));
  const target = realish(path.resolve(cwd, p));
  const rel = path.relative(root, target);
  if (rel === '') return '';
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return samePath(path.join(root, rel), target) ? rel : null;
}
const protectedRel = (rel: string): boolean => {
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  return parts.some(seg => PROTECTED_DIRS.has(lower(seg))) || PROTECTED_FILE.test(parts[parts.length - 1] ?? '');
};

const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const KNOWN_KEYS = new Set(['file_path', 'notebook_path', 'path', 'directory', 'source', 'destination', 'target', 'pattern', 'command', 'content', 'old_string', 'new_string', 'description', 'title']);
/** The paths a file tool names (Claude, Cursor ACP, Codex shapes); null = one is not a plain string. */
function pathsOf(input: unknown): string[] | null {
  const o = obj(input);
  const out: string[] = [];
  for (const k of ['file_path', 'notebook_path', 'path', 'directory', 'source', 'destination', 'target']) {
    if (o[k] === undefined) continue;
    if (typeof o[k] !== 'string') return null;
    out.push(o[k] as string);
  }
  // Cursor ACP: the tool call itself when it has no raw input, its places under locations
  if (o.locations !== undefined) {
    // trimInput keeps 200 entries: a longer list may hide a place outside the folder
    if (!Array.isArray(o.locations) || o.locations.length >= 200 || !o.locations.every(l => typeof obj(l).path === 'string')) return null;
    out.push(...o.locations.map(l => obj(l).path as string));
  }
  // any other value that names a place by itself (target_directory: /home/u) counts as a path too
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string' && !KNOWN_KEYS.has(k) && (looksAbsolute(v) || v.startsWith('~'))) out.push(v);
  }
  if (o.files !== undefined) {
    if (!Array.isArray(o.files) || o.files.length >= 200 || !o.files.every(f => typeof f === 'string')) return null;
    out.push(...o.files as string[]);
  }
  return out;
}

export function autoPermit(req: PermitRequest, ctx: PermitContext): PermitVerdict {
  if (req.type !== 'permission') return ASK;
  const asks = ctx.ceiling === 'plan' || ctx.ceiling === 'default';
  if (COMMAND_TOOLS.includes(req.tool)) {
    const verdict = command(req.input, ctx);
    if (verdict.kind === 'deny' || asks) return verdict.kind === 'deny' ? verdict : ASK;
    if (verdict.kind === 'allow' && ctx.ceiling === 'acceptEdits' && !verdict.reads) return ASK;
    return verdict.kind === 'allow' ? ALLOW : ASK;
  }
  if (asks) return ASK;
  const o = obj(req.input);
  if (READ_TOOLS.has(req.tool)) {
    if (PATHLESS.has(req.tool)) return ALLOW;
    const paths = pathsOf(o);
    if (!paths) return ASK;
    // a glob pattern can name another place by itself (/home/**/.ssh/*)
    if (req.tool === 'Glob' && typeof o.pattern === 'string' && (looksAbsolute(o.pattern) || o.pattern.startsWith('~') || /(^|[\\/])\.\.([\\/]|$)/.test(o.pattern))) return ASK;
    if (!paths.length) return FOLDER_TOOLS.has(req.tool) ? ALLOW : ASK;
    return paths.every(p => within(ctx.cwd, p) !== null) ? ALLOW : ASK;
  }
  if (EDIT_TOOLS.has(req.tool)) {
    // Codex's grantRoot is write access for the rest of the session, not one change
    if (!ctx.undoable || o.grantRoot !== undefined) return ASK;
    const paths = pathsOf(o);
    if (!paths?.length) return ASK;
    return paths.every(p => { const rel = within(ctx.cwd, p); return rel !== null && rel !== '' && !protectedRel(rel); }) ? ALLOW : ASK;
  }
  // ExitPlanMode (the plan is the user's to approve), MCP tools (other systems), WebFetch (leaves the machine), anything
  // unknown: the user decides
  return ASK;
}

// ---- commands ----

type Cmd = { kind: 'allow'; reads: boolean } | { kind: 'ask' } | Extract<PermitVerdict, { kind: 'deny' }>;
const CMD_ASK: Cmd = { kind: 'ask' };
const deny = (shown: string, reason: string, message: string): Cmd => ({ kind: 'deny', shown: shown.slice(0, 120), reason, message });

interface Word { text: string; key: string }
interface Segment { words: Word[]; redirects: string[] }

/** Splits a command line into segments (; && || | & newlines, parentheses) of words, quotes removed. Each word keeps a
 *  key for matching names: lowercased, without the escapes bash (\), cmd (^) and quoting could hide a name behind.
 *  Null = it cannot be read (an open quote). */
function segments(raw: string): Segment[] | null {
  const segs: Segment[] = [];
  let words: Word[] = [], redirects: string[] = [];
  let cur = '', inWord = false, redirectNext = false;
  const endWord = (): void => {
    if (!inWord) return;
    if (redirectNext) { redirects.push(cur); redirectNext = false; } else words.push({ text: cur, key: lower(cur.replace(/[\\^]/g, '')) });
    cur = ''; inWord = false;
  };
  const endSeg = (): void => { endWord(); if (words.length || redirects.length) segs.push({ words, redirects }); words = []; redirects = []; };
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === "'" || ch === '"') {
      const close = raw.indexOf(ch, i + 1);
      if (close < 0) return null;
      cur += raw.slice(i + 1, close); inWord = true; i = close; continue;
    }
    if (ch === ' ' || ch === '\t') { endWord(); continue; }
    if (ch === ';' || ch === '\n' || ch === '\r' || ch === '|' || ch === '(' || ch === ')' || ch === '{' || ch === '}') { endSeg(); continue; }
    if (ch === '&') {
      if (redirectNext && !inWord) { const m = /^&\d*/.exec(raw.slice(i)); i += (m?.[0].length ?? 1) - 1; redirects.push('&'); redirectNext = false; continue; }
      endSeg(); continue;
    }
    if (ch === '>' || ch === '<') {
      if (inWord && /^\d$/.test(cur)) { cur = ''; inWord = false; } else endWord();
      if (raw[i + 1] === '>') i++;
      redirectNext = true; continue;
    }
    cur += ch; inWord = true;
  }
  if (redirectNext && !inWord) return null;
  endSeg();
  return segs;
}

/** The program's name: path, quotes and .exe/.cmd dropped, lowercase. */
const progName = (w: Word): string => w.key.split(/[\\/]/).pop()!.replace(/\.(exe|cmd|bat|ps1)$/, '');
/** Words after leading NAME=value assignments. */
const program = (words: Word[]): Word[] => { let i = 0; while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!.text)) i++; return words.slice(i); };

/** Programs that run the command after them: what that command does still counts (`sudo rm -rf /`). */
const WRAPPERS = new Set(['sudo', 'doas', 'env', 'nohup', 'nice', 'time', 'timeout', 'xargs', 'command', 'builtin', 'exec']);
function unwrapped(words: Word[]): Word[] {
  if (!words[0] || !WRAPPERS.has(progName(words[0]))) return words;
  let w = words;
  for (let n = 0; n < 8 && w[0] && WRAPPERS.has(progName(w[0])); n++) {
    let i = 1;
    while (i < w.length && (w[i]!.key.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i]!.text) || /^\d+[smhd]?$/.test(w[i]!.key))) i++;
    w = w.slice(i);
  }
  return w;
}
/** Programs that wipe disks or stop the machine. */
const SYSTEM_KILLERS = new Set(['mkfs', 'format', 'diskpart', 'fdisk', 'shutdown', 'reboot', 'halt', 'poweroff', 'stop-computer', 'restart-computer', 'clear-disk', 'format-volume']);
const DELETERS = new Set(['rm', 'rmdir', 'rd', 'del', 'erase', 'remove-item', 'ri', 'rimraf', 'trash']);
const PKG = new Set(['npm', 'pnpm', 'yarn', 'bun', 'cargo', 'dotnet', 'nuget', 'gem', 'poetry']);
const GIT_OPTS_WITH_VALUE = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);

/** Local work that passes without asking (an allow list: any other program, a shell, a network tool, a package runner
 *  like npx, reaches the user). What a project script run this way does is not inspected: running the project's own
 *  code, tests and builds is the normal work the owner wants without popups. */
const LOCAL_PROGRAMS = new Set(['mkdir', 'md', 'touch', 'cp', 'copy', 'mv', 'move', 'rm', 'rmdir', 'rd', 'del', 'erase', 'rimraf', 'echo', 'printf', 'cd',
  'pushd', 'popd', 'true', 'false', 'sleep', 'date', 'basename', 'dirname', 'tsc', 'eslint', 'prettier', 'vitest', 'jest', 'mocha', 'make',
  'new-item', 'ni', 'copy-item', 'cpi', 'move-item', 'mi', 'remove-item', 'ri', 'rename-item', 'rni', 'set-content', 'add-content', 'out-file',
  'write-output', 'write-host', 'set-location', 'sl', 'start-sleep']);
const NPM_LOCAL = ['test', 't', 'run', 'run-script', 'install', 'i', 'ci', 'add', 'uninstall', 'remove', 'rm', 'un', 'ls', 'list', 'outdated', 'why',
  'explain', 'start', 'build', 'lint', 'prune', 'dedupe', 'rebuild', 'audit'];
const SUBCOMMANDS: Record<string, ReadonlySet<string>> = {
  npm: new Set(NPM_LOCAL), pnpm: new Set(NPM_LOCAL), yarn: new Set(NPM_LOCAL), bun: new Set(NPM_LOCAL),
  git: new Set(['add', 'commit', 'checkout', 'switch', 'restore', 'stash', 'merge', 'rebase', 'cherry-pick', 'revert', 'fetch', 'pull', 'tag', 'branch',
    'mv', 'rm', 'init', 'reset', 'status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'blame', 'describe', 'shortlog', 'grep', 'worktree', 'apply']),
  cargo: new Set(['build', 'test', 'check', 'fmt', 'clippy', 'run', 'doc', 'clean']),
  go: new Set(['build', 'test', 'vet', 'fmt', 'run']),
  dotnet: new Set(['build', 'test', 'restore', 'format', 'run', 'clean']),
};
/** git options that run a program or change git's config for one call (`-c alias.x=!cmd`, `--upload-pack`, rebase `-x`). */
const GIT_RUNS = /^(-c|--config-env|--exec-path|--upload-pack|--receive-pack|--exec|--git-dir|--work-tree)/;
/** short options that take a program, also joined to it (`-xtouch x`): rebase -x, fetch/pull/clone -u */
const GIT_RUNS_SHORT: Record<string, RegExp> = { rebase: /^-[a-z]*x/i, fetch: /^-[a-z]*u/i, pull: /^-[a-z]*u/i, clone: /^-[a-z]*u/i };

function localWork(name: string, args: Word[], keys: string[], cwd: string): boolean {
  if (LOCAL_PROGRAMS.has(name)) return true;
  // npx of a tool the project already installed (node_modules/.bin): nothing is downloaded; any option (-p, -c, --yes) asks
  if (name === 'npx') {
    const bin = keys[0] ?? '';
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(bin)) return false;
    try { return fs.existsSync(path.join(cwd, 'node_modules', '.bin', bin)) || fs.existsSync(path.join(cwd, 'node_modules', '.bin', `${bin}.cmd`)); } catch { return false; }
  }
  const subs = SUBCOMMANDS[name];
  if (name === 'git') {
    let i = 0;
    while (i < keys.length && keys[i]!.startsWith('-')) { if (args[i]!.text !== '-C' && keys[i] !== '--no-pager') return false; i += args[i]!.text === '-C' ? 2 : 1; }
    const sub = keys[i] ?? '', short = GIT_RUNS_SHORT[sub];
    if (!subs!.has(sub) || keys.some(k => GIT_RUNS.test(k) || k.includes('ext::') || (short && !k.startsWith('--') && short.test(k)))) return false;
    // fetch/pull only from a named remote: a host:path or a URL is another source
    if ((sub === 'fetch' || sub === 'pull') && keys.slice(i + 1).some(k => !k.startsWith('-') && /[:@]/.test(k))) return false;
    // a stash or a branch that is only listed, created or switched to; `git remote`, `git config`, `git push` are not here
    return true;
  }
  if (subs && PKG.has(name) && ['npm', 'pnpm', 'yarn', 'bun'].includes(name)) {
    const verb = keys.find(k => !k.startsWith('-')) ?? '';
    if (!subs.has(verb) || keys.some(k => k === 'exec' || k === 'dlx' || k === 'x' || k === '-g' || k === '--global' || k.startsWith('--location')
      || k.startsWith('--prefix') || k.startsWith('--script-shell') || k.startsWith('--node-options') || k.startsWith('--userconfig') || k.startsWith('--registry'))) return false;
    // an install from the registry only: a file:, link:, git or host:path source brings code from elsewhere
    const installs = ['install', 'i', 'add', 'ci'].includes(verb);
    return !installs || keys.every(k => k.startsWith('-') || k === verb || !/[:/\\]|^\./.test(k.replace(/^@[a-z0-9._-]+\//, '')));
  }
  if (subs) return subs.has(keys.find(k => !k.startsWith('-')) ?? '');
  // node / tsx / python: a script file of the project, no option before it (-e, -p, --require, --import run other code)
  if (['node', 'tsx', 'python', 'python3', 'py'].includes(name)) {
    const first = keys[0] ?? '';
    if (name.startsWith('py') && first === '-m') return ['pytest', 'unittest'].includes(keys[1] ?? '');
    return !!first && !first.startsWith('-') && /\.(m?js|cjs|ts|mts|py)$/.test(first);
  }
  return false;
}

/** Every word and redirection target names a place inside the chat's folder (links resolved), never a variable, a URL,
 *  a settings or hooks file (unless the command only reads): `-C/`, `-t/x` and `--opt=/x` count by their value too. */
function plainWords(seg: Segment, cwd: string, readsOnly: boolean): boolean {
  const ok = (v: string, writes: boolean): boolean => {
    if (!v) return true;
    if (/^(\/dev\/null|nul|\$null)$/i.test(v)) return true;
    if (/^\/[A-Za-z?]{1,3}(:.*)?$/.test(v) && !fs.existsSync(v)) return true; // a Windows switch
    // a quoted value with spaces (a commit message, `--node-options='-r /x'`): every part counts on its own
    if (/\s/.test(v)) return v.split(/\s+/).every(part => values(part).every(x => ok(x, writes)));
    if (v.includes('%') || v.includes('$') || v.includes('://') || v.includes('ext::')) return false;
    // a glob can name a protected place by pattern (.gi?/hooks): only a reading command may use one
    if (writes && /[*?[]/.test(v)) return false;
    if (v.includes('..') && within(cwd, v.replace(/^[a-z+]+:/i, '')) === null) return false;
    if (outside(v, cwd)) return false;
    let exists = false;
    try { exists = /[\\/]/.test(v) || fs.existsSync(path.resolve(cwd, v)); } catch { /* not a path */ }
    if (!exists) return true;
    const rel = within(cwd, v);
    return rel !== null && !(writes && rel !== '' && protectedRel(rel));
  };
  const values = (w: string): string[] => {
    if (w.startsWith('--')) return w.includes('=') ? [w.slice(w.indexOf('=') + 1)] : [];
    // PowerShell -Param:value, then a short option joined to its value (-C/, -t/x)
    if (/^-[A-Za-z][A-Za-z]*:/.test(w)) return [w.slice(w.indexOf(':') + 1)];
    if (/^-[A-Za-z]./.test(w)) return [w.slice(2)];
    return w.startsWith('-') ? [] : [w];
  };
  return seg.words.every(w => values(w.text).every(v => ok(v, !readsOnly))) && seg.redirects.every(t => t === '&' || ok(t, true));
}

const recursive = (args: Word[]): boolean => args.some(w => /^-[a-z]*r/i.test(w.key) && !w.key.startsWith('--') || w.key === '--recursive' || /^\/s$/i.test(w.key)
  || /^-rec(u(r(s(e)?)?)?)?(:\$true)?$/i.test(w.key));
/** A deletion target that would wipe the folder, its parents, the home, a drive or the repository. */
function wipes(target: string, cwd: string): boolean {
  const t = target.replace(/^(\.[\\/])+(?=.)/, '').replace(/[\\/]+$/, '') || target;
  if (/^(\/|~|\.|\.\.|\*|\.\*|\/\*|[A-Za-z]:|[A-Za-z]:[\\/]\*?)$/.test(t) || /^~[\\/]?\*?$/.test(t)) return true;
  if (/\$(home|env:userprofile|env:homepath|userprofile|env:systemroot)/i.test(t) || /%userprofile%|%homepath%|%systemroot%/i.test(t)) return true;
  if (t.split(/[\\/]+/).some(seg => seg === '.git')) return true;
  const rel = within(cwd, t);
  return rel === '' || (rel === null && !t.includes('$') && !t.includes('%'));
}
/** A word that names a place outside the chat's folder (absolute elsewhere, the home, a parent): `--out=/x` counts. */
function outside(w: string, cwd: string): boolean {
  const v = w.startsWith('-') && w.includes('=') ? w.slice(w.indexOf('=') + 1) : w;
  if (!v || v.includes('://') || /^(\/dev\/null|nul|\$null)$/i.test(v)) return false;
  if (v.startsWith('~') || /(^|[\\/])\.\.([\\/]|$)/.test(v)) return within(cwd, v) === null;
  if (/^\/[A-Za-z?]{1,3}(:.*)?$/.test(v) && !fs.existsSync(v)) return false; // a Windows switch (dir /b, robocopy /E)
  if (looksAbsolute(v) || /^\/\w/.test(v)) return within(cwd, v) === null;
  return false;
}

function command(input: unknown, ctx: PermitContext): Cmd {
  const o = obj(input);
  const raw = o.command;
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2000 || /… \(\+\d+\)$/.test(raw)) return CMD_ASK;
  // Codex runs a command in its own folder: it must be the chat's or inside it
  const codexRel = typeof o.cwd === 'string' && o.cwd ? within(ctx.cwd, o.cwd) : '';
  const cwd = codexRel === null || (codexRel && protectedRel(codexRel)) ? null : codexRel ? path.resolve(ctx.cwd, o.cwd as string) : ctx.cwd;
  // an escaped quote (bash \", cmd ^") is read differently by each shell: the words checked here may not be the ones run
  if (/\\["']|\^["']/.test(raw)) return CMD_ASK;
  const segs = segments(raw);
  if (!segs || !cwd) return CMD_ASK;
  const shown = raw.trim();
  // a download piped into a shell runs code nobody has read
  if (/\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh|iex|invoke-expression|powershell|pwsh|python3?|node)\b/i.test(raw)) {
    return deny(shown, 'esegue codice scaricato da internet senza leggerlo', 'Refused by the app: piping a download into a shell runs unread code. Download the file, read it, then run it.');
  }
  if (/\b(drop\s+(database|schema|table)|truncate\s+table)\b/i.test(raw)) {
    return deny(shown, 'cancella dati di un database', 'Refused by the app: dropping or truncating database objects cannot be undone. Ask the user to do it.');
  }
  let unknown = /\$\(|\$\{|`|<\(|>\(/.test(raw);
  const readsOnly = readOnlyCommand(raw, ctx.readScripts);
  for (const seg of segs) {
    const all = program(seg.words);
    if (!all[0]) continue;
    // NAME=value before a program (LD_PRELOAD, GIT_SSH_COMMAND, NODE_OPTIONS) can make it run anything
    if (all !== seg.words && all.length !== seg.words.length) unknown = true;
    const words = unwrapped(all);
    const first = words[0];
    if (!first) continue;
    const name = progName(first), args = words.slice(1), keys = args.map(w => w.key);
    if (SYSTEM_KILLERS.has(name) || /^mkfs\./.test(name)) return deny(shown, 'formatta dischi o spegne il computer', 'Refused by the app: commands that format disks or shut the machine down are never run by an agent.');
    if (name === 'dd' && keys.some(k => k.startsWith('of='))) return deny(shown, 'scrive direttamente su un disco o un file con dd', 'Refused by the app: dd writing to a device or file cannot be undone.');
    if (DELETERS.has(name)) {
      const targets = args.filter(w => !w.key.startsWith('-') && !/^\/[a-z]$/i.test(w.key));
      if ((recursive(args) || name === 'rimraf' || name === 'rd' || name === 'rmdir') && targets.some(t => wipes(t.text, cwd))) {
        return deny(shown, 'cancella in modo ricorsivo una cartella intera, la home, un disco o il repository', 'Refused by the app: a recursive delete of the whole folder, a parent, the home, a drive or .git cannot be undone. Delete only the specific files or subfolders you created.');
      }
    }
    if (name === 'git') {
      let i = 0;
      while (i < keys.length && keys[i]!.startsWith('-')) i += GIT_OPTS_WITH_VALUE.has(args[i]!.text) ? 2 : 1;
      const sub = keys[i] ?? '', rest = keys.slice(i + 1);
      const has = (...f: string[]): boolean => rest.some(k => f.includes(k));
      if (sub === 'push' && (has('-f', '--force', '--force-with-lease', '--mirror', '--delete', '-d', '--prune') || rest.some(k => k.startsWith('--force') || /^\+|^:/.test(k)))) {
        return deny(shown, 'riscrive o cancella la storia sul server (push forzato o cancellazione)', 'Refused by the app: a force push or a remote delete rewrites shared history. Push normally, or ask the user.');
      }
      if (sub === 'reset' && has('--hard', '--merge', '--keep')) return deny(shown, 'butta via le modifiche non salvate (git reset --hard)', 'Refused by the app: git reset --hard discards uncommitted changes. Use git stash, or commit first.');
      if (sub === 'clean' && rest.some(k => /^-[a-z]*f/i.test(k) || k === '--force')) return deny(shown, 'cancella i file non tracciati (git clean)', 'Refused by the app: git clean -f deletes untracked files for good. Delete the specific files instead.');
      if (sub === 'branch' && (args.slice(i + 1).some(w => /^-[a-zA-Z]*D/.test(w.text.replace(/[\\^]/g, ''))) || (has('-d', '--delete') && has('-f', '--force')))) return deny(shown, 'cancella un branch con commit non uniti', 'Refused by the app: deleting a branch with -D loses unmerged commits. Merge it first, or ask the user.');
      if (sub === 'stash' && has('drop', 'clear')) return deny(shown, 'cancella modifiche salvate nello stash', 'Refused by the app: dropping a stash loses the changes in it. Ask the user.');
      if ((sub === 'reflog' && has('expire', 'delete')) || sub === 'filter-branch' || sub === 'filter-repo' || (sub === 'update-ref' && has('-d')) || (sub === 'gc' && rest.some(k => k.startsWith('--prune')))) {
        return deny(shown, 'cancella la storia locale del repository', 'Refused by the app: this deletes history git keeps for recovery. Ask the user.');
      }
    }
    if (PKG.has(name) && keys.includes('unpublish')) return deny(shown, 'ritira un pacchetto pubblicato', 'Refused by the app: unpublishing a package cannot be undone. Ask the user.');
    // a wrapper (sudo, xargs, env …) runs what follows in a way not read here
    if (words !== all) unknown = true;
    if (!plainWords(seg, cwd, readsOnly)) unknown = true;
    else if (!readsOnly && !localWork(name, args, keys, cwd) && !readOnlyCommand(words.map(w => w.text).join(' '), ctx.readScripts)) unknown = true;
  }
  if (unknown) return CMD_ASK;
  if (readsOnly) return { kind: 'allow', reads: true };
  return ctx.undoable ? { kind: 'allow', reads: false } : CMD_ASK;
}
