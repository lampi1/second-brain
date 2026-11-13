// Each harness spends only its own tokens (harness/tools.md "Tokens", {{OWNER}} 2026-10-10: "non rischiare di usare cursor
// da claude e viceversa"). Wired (by {{OWNER}}, brain-rules.md 7) as PreToolUse Bash|PowerShell in ~/.claude/settings.json
// and as beforeShellExecution in harness/cursor/hooks.json (= ~/.cursor/hooks.json).
//   Claude Code → refuses the Cursor CLI (`cursor-agent`, `agent`, `cursor agent`, node/pwsh on its install folder) and
//                 the Cursor API (api.cursor.com, api2.cursor.sh).
//   Cursor      → refuses the Claude CLI (`claude`, npx @anthropic-ai/claude-code, the Agent SDK) and the Anthropic API.
// Only exception, by construction: harness/compare (judge.mjs → cursor-agent, run-claude.mjs → claude -p) spawns the
// other CLI from its own scripts; a hook sees only the agent's command line (`node .../harness/compare/report.mjs`),
// never those children, so nothing is whitelisted here. `--version`/`--help` pass (no model call); deeplinks
// (chat-prompt.mjs --open) run no model and are not touched.
// Harness: `cursor_version` in the input or event beforeShellExecution → Cursor (Cursor also runs the imported Claude
// hooks, with its own input). Output: Cursor beforeShellExecution → {permission:"deny",...} or nothing; otherwise exit 2
// + stderr. Any error → allow (a cost guard, not production safety). Test: node ops/tools/test.mjs ("vendor-guard").

const HARMLESS = /^(?:--version|-v|--help|-h)$/i;
const NET = new Set(['curl', 'wget', 'invoke-webrequest', 'invoke-restmethod', 'iwr', 'irm', 'http', 'node', 'python', 'python3', 'py', 'deno', 'bun']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'pwsh', 'powershell', 'cmd']);
const INLINE = new Set(['node', 'python', 'python3', 'py', 'deno', 'bun']);
const LEAD = /^(?:&\s*|\.\s+|(?:sudo|env|time|nohup|exec|start|call|npx|bunx|xargs|Start-Process)\s+(?:-[-\w]+\s+)*|(?:pnpm|yarn)\s+dlx\s+|npm\s+(?:exec|x)\s+(?:--\s+)?|wsl\s+(?:(?:-d|--distribution|-u|--user|--cd)\s+\S+\s+|-[-\w]+\s+)*|timeout\s+\S+\s+|-FilePath\s+|\$[A-Za-z_][\w:]*\s*=\s*|[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|\S*)\s+)/i;

// Bash heredoc bodies and PowerShell here-strings are text, not commands: drop them, unless the heredoc feeds a shell
// (`bash <<EOF`, `cat <<EOF | bash`): then its body runs (review 10/10).
// checked on the pipeline that holds the `<<` only (a `bash x.sh && cat <<EOF > notes.md` body stays text)
const FEEDS_SHELL = /(?:^|\|\s*)(?:bash|sh|zsh|pwsh|powershell|node|python3?|py|deno|bun)(?:\.exe)?(?:\s|$)/i;
const heredocPipeline = line => line.split(/;|&&|\|\|/).find(p => /(?<!<)<<(?!<)/.test(p)) ?? '';
function dropHeredocs(cmd) {
  const out = [];
  let end = null, code = null; // code: a heredoc fed to node/python, its lines checked as `<prog> -e "<line>"`
  for (const line of cmd.split(/\r?\n/)) {
    if (code) { if (code.end.test(line)) code = null; else out.push(`${code.prog} -e "${line.replace(/"/g, "'")}"`); continue; }
    if (end) { if (end.test(line)) end = null; continue; }
    out.push(line);
    const m = line.match(/(?<!<)<<(?!<)-?\s*(['"]?)([A-Za-z_]\w*)\1/);
    const feeds = m && heredocPipeline(line).trim().match(FEEDS_SHELL);
    if (feeds && /node|python|py|deno|bun/i.test(feeds[0]) && !/bash|sh|pwsh|powershell/i.test(feeds[0])) { code = { prog: 'node', end: new RegExp(`^\\s*${m[2]}\\s*$`) }; continue; }
    if (feeds) continue;
    if (m) end = new RegExp(`^\\s*${m[2]}\\s*$`);
    else if (/@['"]\s*$/.test(line)) end = /^['"]@/;
  }
  return out.join('\n');
}

// Simple commands of a line: split on ; & | newline ( ) { } ` $( outside quotes; plus the text after every $( or `
// inside double quotes (command substitution). Single quotes are literal: '`agent`' in a grep is text (review 10/10).
function split(cmd) {
  const segs = [], subs = [];
  let cur = '', q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) {
      cur += c;
      if (q === '"' && (c === '`' || (c === '$' && cmd[i + 1] === '('))) subs.push(i + (c === '$' ? 2 : 1));
      if (c === '\\' && q === '"' && i + 1 < cmd.length) cur += cmd[++i];
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (/[;&|\n(){}`]/.test(c) || (c === '$' && cmd[i + 1] === '(')) { segs.push(cur); cur = ''; if (c === '$') i++; continue; }
    cur += c;
  }
  segs.push(cur);
  for (const at of subs) segs.push(cmd.slice(at).split(/[)`;|&\n"]/)[0]);
  return segs.map(s => s.trim()).filter(Boolean);
}

const unquote = s => s.replace(/^(["'])([\s\S]*)\1$/, '$2');
function parse(seg) {
  let s = seg, prev;
  do { prev = s; s = s.replace(LEAD, '').trim(); } while (s !== prev);
  const tokens = s.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  if (!tokens.length) return null;
  const name = unquote(tokens[0]).split(/[\\/]/).pop().toLowerCase().replace(/@.*$/, '').replace(/\.(exe|cmd|ps1|bat|sh)$/, '');
  return { s, name, args: tokens.slice(1).map(unquote) };
}

const RULES = {
  claude: { // a Claude Code chat must not spend Cursor tokens
    cli: c => ((c.name === 'cursor-agent' || c.name === 'agent') && !(c.args.length === 1 && HARMLESS.test(c.args[0])))
      || (c.name === 'cursor' && c.args[0]?.toLowerCase() === 'agent' && !(c.args.length === 2 && HARMLESS.test(c.args[1])))
      || ((c.name === 'node' || SHELLS.has(c.name)) && /cursor-agent[\\/][^\s"']*\.(?:m?js|ps1)\b/i.test(c.s)),
    net: /\bapi2?\.cursor\.(?:com|sh)\b/i,
    why: 'a Claude Code chat never runs the Cursor CLI or the Cursor API (Cursor tokens)',
  },
  cursor: { // a Cursor chat must not spend Claude tokens
    cli: c => ((c.name === 'claude' || c.name === 'claude-code') && !(c.args.length === 1 && HARMLESS.test(c.args[0]))),
    net: /\bapi\.anthropic\.com\b|@anthropic-ai[\\/]|\b(?:import|from)\s+anthropic\b|claude[_-]agent[_-]sdk/i,
    why: 'a Cursor chat never runs the Claude CLI or the Anthropic API (Claude tokens)',
  },
};

export function check(command, harness, depth = 0) {
  const rule = RULES[harness];
  for (const seg of split(dropHeredocs(String(command || '')))) {
    const c = parse(seg);
    if (!c) continue;
    if (rule.cli(c) || (NET.has(c.name) && rule.net.test(c.s))) return rule.why;
    // node -e / python -c code that starts a process: check the strings it passes (execSync('cursor-agent -p x'))
    if (INLINE.has(c.name) && depth < 3) {
      const code = c.args[c.args.findIndex(a => /^(?:-e|--eval|-c|-p|--print)$/.test(a)) + 1];
      // only the program a call starts: its first string, or the first item of an argument array (review 10/10: a
      // 'agent' searched by git/rg, or compared with ===, is data)
      if (code && c.args.some(a => /^(?:-e|--eval|-c|-p|--print)$/.test(a)))
        for (const m of code.matchAll(/\b(?:execSync|execFileSync|exec|execFile|spawnSync|spawn|system|Popen|run|call|check_output)\s*\(\s*\[?\s*(['"`])(.*?)\1/g)) {
          const why = check(m[2], harness, depth + 1); if (why) return why;
        }
    }
    if (SHELLS.has(c.name) && depth < 3) { // bash -c '...', powershell -Command "...", cmd /c "..."
      const i = c.args.findIndex(a => /^(?:-\w*c|-command|\/c|\/k)$/i.test(a));
      if (i >= 0) {
        // a quoted script is the whole command (a redirect or 2>&1 may follow it); else the rest of the line
        const toks = c.s.match(/"[^"]*"|'[^']*'|\S+/g), t = toks[i + 2] ?? '';
        const inner = /^["']/.test(t) ? unquote(t) : unquote(toks.slice(i + 2).join(' '));
        const why = check(inner, harness, depth + 1);
        if (why) return why;
      }
    }
  }
  return null;
}
