// Cursor production guard (IDE and CLI `agent`): the same production limits Claude has, for Cursor chats and subagents.
// Wired in ~/.cursor/hooks.json (copy of harness/cursor/hooks.json, applied by Owner: brain-rules.md 7) on
//   beforeShellExecution (with a prefilter matcher) → deny / ask; "allow" only for one read-only az command (readOnlyAz:
//                                                    me.md lets agents run az show/list themselves);
//   beforeReadFile                                  → deny the secrets file, allow everything else.
// Single source: the deny/ask rules of ~/.claude/settings.json, read at every call (Bash(...) and PowerShell(...)
// patterns both apply: Cursor on Windows runs every command in PowerShell). EXTRA below = what me.md "Safety" forbids and
// Claude enforces with its auto-mode classifier, which Cursor does not have. Safety only tightens (brain-rules.md 9).
// Failure → no output → the hook is failClosed in hooks.json, so Cursor blocks the action.
// Test: node harness/cursor/test.mjs (fake commands only).
import fs from 'node:fs';
import os from 'node:os';
import { parseHookJson } from './hook-input.mjs';

const SETTINGS = process.env.PROD_GUARD_SETTINGS || `${os.homedir()}/.claude/settings.json`;
const WHY = 'Production rule (me.md "Safety"): the agent proposes, {{OWNER}} runs. Give him the exact command in a one-click bash block (PowerShell syntax) instead.';

// [regex, reason] - Cursor-only additions; keep in sync with me.md "Safety".
const EXTRA_DENY = [
  // anchored at the start of a simple command (after wrappers/paths are stripped), like the Claude rules
  [/^(?:(?:bash|sh|zsh|pwsh|powershell)(?:\.exe)?\s+(?:-\w+\s+)*)?["']?[^\s"']*ops[\\/]+runner[\\/]/i, 'ops/runner scripts are production: {{OWNER}} runs them'],
  [/^sqlcmd\b(?![\s\S]*-S\s*["']?(localhost|127\.0\.0\.1|\.|\(local\))\b)/i, 'sqlcmd only towards the local dev DB (-S localhost); production queries only via ro-query.sh from the Orchestrator'],
  [/^Invoke-Sqlcmd\b/i, 'Invoke-Sqlcmd: production queries only via ro-query.sh from the Orchestrator'],
  [/^kubectl\b(?=[\s\S]*\b(prd|prod|production)\b)(?=[\s\S]*\b(delete|apply|patch|scale|rollout|edit|replace|set|exec|cordon|drain|annotate|label|create|run|cp|taint)\b)/i, 'kubectl write on a production namespace'],
  [/^git(?:\s+-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+))*\s+push\b[\s\S]*[\s:/+](master|release)(?![\w-])/i, 'push to master/release'],
];
const EXTRA_ASK = [
  [/ro-query\.sh/i, 'production DB query: only from the Orchestrator, after {{OWNER}} saw the full query text'],
  [/ops[\\/]+runner[\\/]/i, 'mentions an ops/runner production script'],
];

const globToRegex = g => new RegExp(`^${g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[\\s\\S]*')}$`, 'i');
function rules() {
  const p = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).permissions || {};
  const pick = (list, re) => (list || []).map(r => r.match(re)?.[1]).filter(Boolean).map(globToRegex);
  return {
    deny: pick(p.deny, /^(?:Bash|PowerShell)\(([\s\S]*)\)$/),
    ask: pick(p.ask, /^(?:Bash|PowerShell)\(([\s\S]*)\)$/),
    read: (p.deny || []).map(r => r.match(/^Read\(([\s\S]*)\)$/)?.[1]).filter(Boolean),
  };
}

// Every simple command inside a command line: join line continuations, split on ; & && || | ( ) { } newlines, strip
// call operators, env/variable assignments and wrappers (cmd /c, powershell -Command, bash -lc ...), recurse into the
// quoted script of a wrapper; then also start a candidate at every known command word (az, az.cmd with its path, git,
// sqlcmd, kubectl, ops, *-Az* cmdlets) wherever it appears, so `$s = az ...` or `foreach (...) { az ... }` still match.
// A deny comes only from a real simple command; a hit found only by that word search (e.g. "az webapp restart" inside
// a commit message or an rg pattern) becomes "ask": {{OWNER}} decides, the agent is not stopped by a false block.
const LEADPATH = /^(?:"[^"]*[\\/]|'[^']*[\\/]|[^\s"']*[\\/])?(az|git|sqlcmd|kubectl)(?:\.cmd|\.exe)?["']?(?=\s|$)/i;
const WRAPPER = /^(?:&\s*|\.\s+|sudo\s+|env\s+|time\s+|start\s+|(?:if|elseif|foreach|for|while|do|else|try|return)\b\s*|\$?[A-Za-z_][\w:]*\s*=\s*|(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+))/i;
const SHELL = /^(?:["']?[^\s"']*[\\/])?(?:cmd(?:\.exe)?(?:\s+\/\w)*?\s+\/[ck]|(?:powershell|pwsh)(?:\.exe)?(?:\s+-\w+(?:\s+(?!-)[^\s"']+)?)*?\s+-(?:c|command)\b|(?:bash|sh|zsh)(?:\.exe)?(?:\s+-\w+)*?\s+-\w*c)\s+/i;
const WORD = /(?:^|[\s=(){}"'&;|])(?:(?:[A-Za-z]:)?[^\s"'=(){}&;|]*[\\/])?(az|git|sqlcmd|kubectl|ops|[A-Za-z]+-Az[A-Za-z]\w*|Invoke-Sqlcmd)(?:\.cmd|\.exe|\.ps1)?(?=[\s"')}]|$)/gi;
function segments(cmd, depth = 0) {
  const out = [];
  for (let s of cmd.replace(/[`\\]\r?\n\s*/g, ' ').split(/\r?\n|;|&&|\|\||\||&(?!\d)|[(){}]/)) {
    s = s.trim();
    let prev;
    do { prev = s; s = s.replace(WRAPPER, '').trim(); } while (s !== prev);
    s = s.replace(LEADPATH, '$1');
    if (!s) continue;
    const w = s.match(SHELL);
    if (w && depth < 3) {
      const inner = s.slice(w[0].length).trim().replace(/^(["'])([\s\S]*)\1$/, '$2');
      out.push(...segments(inner, depth + 1));
    }
    out.push(s, s.replace(/["']/g, ''));
  }
  return out;
}
function loose(command) {
  const segs = [];
  const flat = command.replace(/[`\\]\r?\n\s*/g, ' ');
  for (const m of flat.matchAll(WORD)) {
    const rest = flat.slice(m.index + m[0].length);
    segs.push(`${m[1]}${rest}`.replace(/["']/g, '').trim());
    segs.push(...segments(`${m[1]}${rest}`));
  }
  return segs;
}

// me.md "Safety": `az` show/list (logs, App Insights, Azure state) the agent runs itself, without asking. "allow" only
// for ONE command of the explicit list below (none returns secrets: no app settings, keys, auth, connection strings),
// written as plain words, flags and quoted values. Anything else → the normal ask/deny path. PowerShell rules
// (Cursor's shell on Windows): $ @ ` ( ) { } evaluate code outside quotes, `$`/backtick also inside "…", typographic
// quotes close strings, \" is not an escape → all refused. Runs after every deny check, so a deny rule always wins.
// Reviewer 09/10 (round 3): pipes, `az rest`, `log download`, output files and generic show/list verbs were bypasses.
// Round 4: az is az.cmd, so cmd.exe re-reads the arguments: & | < > ^ % ! are refused even inside quotes; `resource
// show` is out (any --ids, e.g. an App Insights component with its key).
const AZ_READ = new Set(['version', 'account list', 'account show', 'group list', 'group show', 'resource list',
  'webapp list', 'webapp show', 'webapp log tail', 'functionapp list', 'functionapp show', 'appservice plan list', 'appservice plan show',
  'sql server list', 'sql server show', 'sql db list', 'sql db show', 'sql elastic-pool list', 'storage account list',
  'monitor activity-log list', 'monitor app-insights query', 'monitor log-analytics query',
  'servicebus namespace list', 'servicebus queue list', 'servicebus queue show', 'containerapp list', 'containerapp show', 'aks list', 'aks show']);
const AZ_FLAG_NO = ['output-file', 'log-file', 'file', 'resource', 'headers', 'url', 'body', 'skip-authorization-header'];
function readOnlyAz(command) {
  const c = command.trim().replace(/\s+2>&1$/, '');
  if (/[‘-‟`$@\\\r\n&|<>^%!]/.test(c)) return false;
  if (/'[^']*"[^']*'/.test(c)) return false; // a " inside '…' reaches cmd.exe as a quote
  const masked = c.replace(/"[^"]*"|'[^']*'/g, 'Q'); // quoted values: inert (nothing that evaluates left inside)
  if (!/^[A-Za-z0-9 \t._:/=,-]+$/.test(masked)) return false; // no ( ) { } [ ] ; & | < > * " ' left outside quotes
  const tokens = masked.trim().split(/\s+/);
  if (!/^az(?:\.cmd)?$/i.test(tokens[0])) return false;
  let i = 1;
  const words = [];
  while (i < tokens.length && /^[a-z][a-z0-9-]*$/.test(tokens[i])) words.push(tokens[i++]);
  if (!AZ_READ.has(words.join(' ')) || (i < tokens.length && !tokens[i].startsWith('-'))) return false;
  return !tokens.slice(i).some(t => {
    if (!t.startsWith('-')) return false; // a value
    const name = t.replace(/^-+/, '').replace(/=[\s\S]*$/, '').toLowerCase();
    if (name === 'output' || name === 'o') return false; // -o/--output table|json: a full flag, not an abbreviation of output-file
    return name === 'f' || name === 'b' || AZ_FLAG_NO.some(f => f === name || (t.startsWith('--') && f.startsWith(name))); // also abbreviations
  });
}

function checkShell(command) {
  let r;
  try { r = rules(); } catch { return { permission: 'deny', why: `cannot read the deny rules in ${SETTINGS}` }; }
  if (/\s-(?:e|ec|enc\w*)\s/i.test(command) && /\b(powershell|pwsh)\b/i.test(command)) return { permission: 'ask', why: 'encoded PowerShell command: cannot be checked' };
  const strict = [command, ...segments(command)];
  for (const [re, why] of EXTRA_DENY) if (strict.some(s => re.test(s))) return { permission: 'deny', why };
  for (const re of r.deny) {
    const hit = strict.find(s => re.test(s));
    if (hit) return { permission: 'deny', why: `matches the Claude deny rule ${re.source.slice(1, 60)}` };
  }
  const near = loose(command);
  if ([...EXTRA_DENY.map(([re]) => re), ...r.deny].some(re => near.some(s => re.test(s))))
    return { permission: 'ask', why: 'a production command appears inside this line (maybe only as text): confirm it' };
  if (readOnlyAz(command)) return { permission: 'allow' };
  const segs = [...strict, ...near];
  for (const [re, why] of EXTRA_ASK) if (segs.some(s => re.test(s))) return { permission: 'ask', why };
  for (const re of r.ask) if (segs.some(s => re.test(s))) return { permission: 'ask', why: 'Claude asks before this command' };
  return { permission: 'ask', why: 'command touches Azure, git push, SQL or kubectl: confirm it' };
}

function checkRead(file) {
  const norm = p => p.replace(/\\/g, '/').replace(/^~(?=\/)/, os.homedir().replace(/\\/g, '/')).toLowerCase();
  const f = norm(file);
  let fromSettings = [];
  try { fromSettings = rules().read; } catch { /* settings unreadable: the built-in secrets path still applies */ }
  const denied = [...fromSettings, '~/.{{BRAIN_NAME}}.env'].map(norm);
  return denied.some(d => f === d) || f === '.{{BRAIN_NAME}}.env' || f.endsWith('/.{{BRAIN_NAME}}.env') ? { permission: 'deny', why: 'secrets file: agents never read it' } : { permission: 'allow' };
}

let raw = '';
process.stdin.on('data', d => (raw += d)).on('end', () => {
  const input = parseHookJson(raw); // a parse error = no output = blocked (failClosed); BOM dropped
  const ev = input.hook_event_name;
  let res;
  if (ev === 'beforeReadFile' || (ev === undefined && 'file_path' in input && !('command' in input))) res = checkRead(String(input.file_path || ''));
  else res = checkShell(String(input.command ?? input.tool_input?.command ?? ''));
  const out = { permission: res.permission };
  if (res.permission !== 'allow') {
    const deny = res.permission === 'deny';
    out.user_message = `{{BRAIN_NAME}} prod-guard ${deny ? 'blocked' : 'asks you to confirm'}: ${res.why}.`;
    out.agent_message = deny ? `BLOCKED: ${res.why}. ${WHY}` : `Needs {{OWNER}}'s approval: ${res.why}.`;
  }
  process.stdout.write(JSON.stringify(out));
});
