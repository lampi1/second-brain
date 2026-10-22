// What a command or a tool call does, in two words (the owner, 2026-10-22: «quando c'è un comando mi deve dire in 2
// parole cosa fa»): «Esegue test», «Installa pacchetti», «Pubblica branch», «Cancella file». A known program and its
// subcommand map to one gist; a chain (`cd x && npm test`) is read past its set-up steps (cd, set, export); a request
// whose command maps to nothing but carries the agent's own description gets a gist only when that description names
// a known action (never a made-up summary); everything else falls back to a plain generic one («Esegue comando»,
// «Usa strumento»). Pure, no I/O: returns an id, the words are UI texts (i18n `genui.gist.<id>`). Used by RequestPanel.tsx
// and CommandRequest.tsx (the questions window); pinned by test/unit/gist.test.ts.

export type Gist =
  | 'tests' | 'install' | 'build' | 'lint' | 'format' | 'push' | 'publish' | 'commit' | 'pull' | 'branch' | 'merge' | 'rebase' | 'gitUndo'
  | 'stash' | 'stage' | 'clone' | 'diff' | 'history' | 'tag' | 'pr' | 'issue' | 'ci' | 'delete' | 'move' | 'copy' | 'mkdir'
  | 'newFile' | 'list' | 'read' | 'search' | 'web' | 'container' | 'image' | 'kill' | 'start' | 'script' | 'db' | 'azure'
  | 'perms' | 'print' | 'wait' | 'extract' | 'archive' | 'cd' | 'write' | 'edit' | 'notebook' | 'findFiles' | 'webSearch'
  | 'openPage' | 'delegate' | 'report' | 'askParent' | 'answerChild' | 'todo' | 'skill' | 'plan' | 'browser' | 'click'
  | 'typeText' | 'screenshot' | 'readData' | 'changeData' | 'deleteData' | 'send' | 'connector' | 'command' | 'tool';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** A program's name as typed: lower case, without its folder and a Windows extension ("C:\x\npm.cmd" → "npm"). */
const prog = (w: string): string => w.replace(/^["']|["']$/g, '').replace(/\\/g, '/').split('/').pop()!.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '');

const PKG = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const TEST_TOOLS = new Set(['vitest', 'jest', 'pytest', 'mocha', 'ava', 'tap', 'karma', 'phpunit', 'rspec']);
const BUILD_TOOLS = new Set(['tsc', 'make', 'cmake', 'msbuild', 'webpack', 'esbuild', 'rollup', 'gradle', 'mvn', 'ninja', 'electron-builder']);
const LINT_TOOLS = new Set(['eslint', 'ruff', 'flake8', 'pylint', 'stylelint', 'biome', 'oxlint', 'mypy', 'golangci-lint']);
const FORMAT_TOOLS = new Set(['prettier', 'black', 'gofmt', 'rustfmt', 'dprint']);
/** wrappers in front of the real program ("npx vitest", "sudo apt install") */
const WRAPPERS = new Set(['sudo', 'env', 'call', 'time', 'npx', 'pnpx', 'bunx', 'cross-env', 'dotenv', '&', '--']);
/** steps that only move to a folder or set a variable: a chain is read past them */
const NAV = new Set(['cd', 'set-location', 'sl', 'pushd', 'popd', 'chdir']);
const SETVAR = new Set(['set', 'export', 'setx']);

/** The gist of a script name (`npm run test:unit`, `npm run build`). */
function scriptGist(name: string): Gist {
  const n = name.toLowerCase();
  if (/^(test|e2e|spec|check)(\b|[:_-])/.test(n) || /(^|[:_-])tests?$/.test(n)) return 'tests';
  if (/^(build|compile|bundle|dist|package|pack)(\b|[:_-])/.test(n)) return 'build';
  if (/^(lint|typecheck|type-check|tsc)(\b|[:_-])/.test(n)) return 'lint';
  if (/^(format|fmt|prettier)(\b|[:_-])/.test(n)) return 'format';
  if (/^(start|dev|serve|preview|watch)(\b|[:_-])/.test(n)) return 'start';
  return 'script';
}

/** One simple command (program and its arguments, already split on spaces) → its gist, or null if unknown. */
function simpleGist(words: string[]): Gist | null {
  const p = prog(words[0] ?? '');
  const args = words.slice(1);
  const sub = (args.find(a => !a.startsWith('-')) ?? '').toLowerCase();
  const has = (re: RegExp) => args.some(a => re.test(a));
  if (PKG.has(p)) {
    if (sub === 'test' || sub === 't') return 'tests';
    if (['install', 'i', 'ci', 'add', 'update', 'upgrade'].includes(sub) || (p === 'yarn' && !sub)) return 'install';
    if (['uninstall', 'remove', 'rm'].includes(sub)) return 'install';
    if (sub === 'run' || sub === 'run-script') return scriptGist(args.filter(a => !a.startsWith('-'))[1] ?? '');
    if (sub === 'start' || sub === 'dev') return 'start';
    if (sub === 'publish') return 'publish';
    if (sub) return scriptGist(sub);
    return null;
  }
  if (TEST_TOOLS.has(p)) return 'tests';
  if (p === 'playwright') return sub === 'install' ? 'install' : 'tests';
  if (BUILD_TOOLS.has(p)) return p === 'tsc' && has(/^--noEmit$/i) ? 'lint' : 'build';
  if (LINT_TOOLS.has(p)) return 'lint';
  if (FORMAT_TOOLS.has(p)) return has(/^--check$/) ? 'lint' : 'format';
  if (p === 'vite') return sub === 'build' ? 'build' : 'start';
  if (p === 'pip' || p === 'pip3' || p === 'poetry' || p === 'uv' || p === 'pipx' || p === 'conda') return ['install', 'add', 'sync', 'lock'].includes(sub) ? 'install' : p === 'uv' && sub === 'run' ? 'script' : null;
  if (['apt', 'apt-get', 'brew', 'winget', 'choco', 'scoop', 'dnf', 'yum', 'pacman'].includes(p)) return 'install';
  if (p === 'cargo') return sub === 'test' ? 'tests' : sub === 'build' ? 'build' : sub === 'add' || sub === 'install' ? 'install' : sub === 'clippy' ? 'lint' : sub === 'fmt' ? 'format' : sub === 'run' ? 'start' : null;
  if (p === 'go') return sub === 'test' ? 'tests' : sub === 'build' ? 'build' : sub === 'get' || sub === 'install' ? 'install' : sub === 'vet' ? 'lint' : sub === 'run' ? 'start' : null;
  if (p === 'dotnet') return sub === 'test' ? 'tests' : sub === 'build' || sub === 'publish' ? 'build' : sub === 'restore' || sub === 'add' ? 'install' : sub === 'run' ? 'start' : null;
  if (p === 'git') {
    const g = sub;
    if (g === 'push') return 'push';
    if (g === 'commit') return 'commit';
    if (g === 'pull' || g === 'fetch') return 'pull';
    if (g === 'checkout' || g === 'switch') return 'branch';
    if (g === 'branch') return has(/^-(d|D)$|^--delete$/) ? 'delete' : 'branch';
    if (g === 'merge' || g === 'cherry-pick') return 'merge';
    if (g === 'rebase') return 'rebase';
    if (g === 'reset' || g === 'restore' || g === 'revert' || g === 'clean') return 'gitUndo';
    if (g === 'stash') return 'stash';
    if (g === 'add' || g === 'rm' || g === 'mv') return g === 'add' ? 'stage' : g === 'rm' ? 'delete' : 'move';
    if (g === 'clone') return 'clone';
    if (g === 'status' || g === 'diff' || g === 'show') return 'diff';
    if (g === 'log' || g === 'blame' || g === 'reflog') return 'history';
    if (g === 'tag') return 'tag';
    if (g === 'worktree') return 'branch';
    return null;
  }
  if (p === 'gh') return sub === 'pr' ? 'pr' : sub === 'issue' ? 'issue' : sub === 'run' || sub === 'workflow' ? 'ci' : sub === 'repo' && args.includes('clone') ? 'clone' : null;
  if (['rm', 'del', 'erase', 'rmdir', 'rd', 'unlink', 'remove-item', 'ri', 'shred'].includes(p)) return 'delete';
  if (['mv', 'move', 'move-item', 'ren', 'rename', 'rename-item'].includes(p)) return 'move';
  if (['cp', 'copy', 'copy-item', 'xcopy', 'robocopy', 'rsync', 'scp'].includes(p)) return 'copy';
  if (['mkdir', 'md'].includes(p)) return 'mkdir';
  if (p === 'new-item' || p === 'ni') return has(/^directory$/i) ? 'mkdir' : 'newFile';
  if (p === 'touch') return 'newFile';
  if (['ls', 'dir', 'get-childitem', 'gci', 'tree', 'find', 'fd', 'du', 'stat', 'test-path', 'get-item'].includes(p)) return 'list';
  if (['cat', 'type', 'get-content', 'gc', 'head', 'tail', 'less', 'more', 'bat', 'wc', 'jq'].includes(p)) return 'read';
  if (['grep', 'rg', 'ag', 'select-string', 'sls', 'findstr', 'ack'].includes(p)) return 'search';
  if (['curl', 'wget', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm', 'http', 'xh'].includes(p)) return 'web';
  if (p === 'docker' || p === 'podman' || p === 'docker-compose') return sub === 'build' ? 'image' : 'container';
  if (['kill', 'pkill', 'killall', 'taskkill', 'stop-process', 'spps'].includes(p)) return 'kill';
  if (['start-process', 'start', 'open', 'xdg-open', 'invoke-item', 'ii', 'electron'].includes(p)) return 'start';
  if (['node', 'python', 'python3', 'py', 'deno', 'ts-node', 'tsx', 'ruby', 'perl', 'pwsh', 'powershell', 'bash', 'sh', 'zsh', 'cmd'].includes(p)) {
    if (p === 'python' || p === 'python3' || p === 'py') {
      if (args[0] === '-m' && args[1] === 'pytest') return 'tests';
      if (args[0] === '-m' && args[1] === 'pip') return simpleGist(args.slice(1));
    }
    return 'script';
  }
  if (['psql', 'sqlcmd', 'mysql', 'sqlite3', 'mongosh', 'invoke-sqlcmd'].includes(p)) return 'db';
  if (p === 'az' || p === 'azd') return 'azure';
  if (['chmod', 'chown', 'icacls', 'takeown', 'set-acl'].includes(p)) return 'perms';
  if (['echo', 'write-output', 'write-host', 'printf'].includes(p)) return 'print';
  if (['sleep', 'start-sleep', 'timeout'].includes(p)) return 'wait';
  if (['unzip', 'expand-archive', '7z', 'gunzip'].includes(p) || (p === 'tar' && has(/^-?\w*x/))) return 'extract';
  if (['zip', 'compress-archive', 'gzip'].includes(p) || p === 'tar') return 'archive';
  if (['tee', 'out-file', 'set-content', 'sc', 'add-content', 'ac'].includes(p)) return 'write';
  return null;
}

/** The gist of a shell command: the first step of a chain that is not set-up, else a set-up step itself. */
export function commandGist(command: string): Gist | null {
  const text = command.replace(/\r/g, '').replace(/\\\n/g, ' ');
  // the steps of the chain, in order: lines, &&, ||, ;, | (a pipe's right side only filters what the left side does)
  const steps = text.split(/\n|&&|\|\||;/).map(s => s.split('|')[0]!.trim()).filter(s => s && !s.startsWith('#'));
  let moved = false;
  for (const step of steps) {
    // "FOO=1 npm test": leading variable assignments are set-up too
    const words = step.split(/\s+/);
    while (words.length > 1 && (/^\w+=/.test(words[0]!) || WRAPPERS.has(prog(words[0]!)))) words.shift();
    const head = prog(words[0]!);
    if (NAV.has(head)) { moved = true; continue; }
    if (SETVAR.has(head) || /^\$env:/i.test(words[0]!) || /^\w+=/.test(words[0]!)) continue;
    // the first real step says what the chain does: unknown → no gist (never the next step's)
    return simpleGist(words);
  }
  return moved ? 'cd' : null;
}

/** Known actions in the agent's own description (Italian or English): a gist only when one is named, never a guess. */
const DESCRIBED: [RegExp, Gist][] = [
  [/\b(run|runs|running|esegu\w*|lancia\w*|launch\w*)\b[^.]*\b(tests?|test suite|specs?)\b|\b(tests?|specs?)\b[^.]*\b(run|esegu\w*)\b/i, 'tests'],
  [/\b(install\w*|installa\w*)\b/i, 'install'],
  [/\b(build\w*|compil\w*)\b/i, 'build'],
  [/\b(lint\w*|type-?check\w*)\b/i, 'lint'],
  [/\b(push\w*|pubblica\w*)\b/i, 'push'],
  [/\bcommit\w*\b/i, 'commit'],
  [/\b(delete\w*|remove\w*|elimin\w*|cancell\w*|rimuov\w*)\b/i, 'delete'],
  [/\b(clone\w*|clona\w*)\b/i, 'clone'],
];

export function describedGist(description: string): Gist | null {
  for (const [re, g] of DESCRIBED) if (re.test(description)) return g;
  return null;
}

const BROWSER: Record<string, Gist> = {
  navigate: 'openPage', tabs_create: 'openPage', click: 'click', type: 'typeText', fill_form: 'typeText', key: 'typeText',
  screenshot: 'screenshot', read_page: 'read', get_page_text: 'read', find: 'search',
};
const DELEGATION: Record<string, Gist> = { agent_delegate: 'delegate', agent_report: 'report', agent_ask_parent: 'askParent', agent_answer_child: 'answerChild', agent_children: 'delegate' };

/** A connector's action from its tool name: read, change, delete, send, else the connector itself. */
function mcpGist(server: string, tool: string): Gist {
  if (server === 'second-brain' && Object.hasOwn(DELEGATION, tool)) return DELEGATION[tool]!;
  const t = tool.replace(/^browser_/, '');
  if (/browser|chrome|second-brain|^Claude_Browser$/i.test(server)) return Object.hasOwn(BROWSER, t) ? BROWSER[t]! : 'browser';
  const words = tool.toLowerCase().split(/[_-]+/);
  if (words.some(w => ['delete', 'remove', 'trash'].includes(w))) return 'deleteData';
  if (words.some(w => ['send', 'reply', 'forward'].includes(w))) return 'send';
  if (words.some(w => ['create', 'add', 'new', 'update', 'set', 'edit', 'write', 'link', 'assign', 'upload', 'vote', 'apply', 'mark', 'label'].includes(w))) return 'changeData';
  if (words.some(w => ['get', 'read', 'list', 'show', 'search', 'query', 'find', 'discover', 'download', 'my'].includes(w))) return 'readData';
  return 'connector';
}

/** The two-word gist of a request: a permission's tool call (name + input, Claude's or Cursor's), or a command card's code. */
export function gistOf(tool: string, input: unknown, command?: string): Gist {
  const i = obj(input);
  const m = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (m) return mcpGist(m[1]!, m[2]!);
  const desc = str(i.description) || str(i.explanation);
  switch (tool) {
    case 'Bash': case 'PowerShell': case 'Shell': case 'command': case '': {
      const cmd = command ?? (str(i.command) || str(i.cmd));
      return commandGist(cmd) ?? (desc ? describedGist(desc) : null) ?? 'command';
    }
    case 'Read': return 'read';
    case 'Write': return 'write';
    case 'Edit': case 'MultiEdit': return 'edit';
    case 'NotebookEdit': return 'notebook';
    case 'Delete': return 'delete';
    case 'Move': return 'move';
    case 'Grep': case 'Search': return 'search';
    case 'Glob': return 'findFiles';
    case 'WebFetch': case 'Fetch': return 'openPage';
    case 'WebSearch': return 'webSearch';
    case 'Task': case 'Agent': return 'delegate';
    case 'TodoWrite': return 'todo';
    case 'Skill': return 'skill';
    case 'ExitPlanMode': case 'CreatePlan': return 'plan';
    default: return 'tool';
  }
}
