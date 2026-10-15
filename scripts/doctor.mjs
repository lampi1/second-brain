// doctor: is this machine ready to run second-brain? Checks the build, Electron, the Claude and Cursor CLIs (found,
// version, Claude login), whether their versions are covered by the CLI contract fixtures and whether a CLI format
// changed today (ADR 0055), the brain folder, the MCP port and recent errors in the logs. No model calls, no Cursor calls
// beyond `--version` (each harness spends only its own tokens; a Claude agent may run this). Readable by agents:
//   node scripts/doctor.mjs           human lines: ✓/✗/! name · detail · → next step
//   node scripts/doctor.mjs --json    [{ id, ok, level, detail, hint }]; exit 1 if any check failed
//   --dev                             check the dev instance (userData second-brain-dev, MCP 4329) instead of the stable one
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testedVersions } from './cli-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userData = process.env.SB_USER_DATA ?? path.join(process.env.APPDATA ?? path.join(os.homedir(), '.config'), process.argv.includes('--dev') ? 'second-brain-dev' : 'second-brain');
const checks = [];
const add = (id, ok, detail, hint = '', level = ok ? 'ok' : 'fail') => checks.push({ id, ok, level, detail, hint });
// .cmd/.bat shims (the Cursor CLI on Windows) need cmd.exe; our arguments are fixed flags, never user text
const run = (cmd, args, timeout = 20000) => /\.(cmd|bat)$/i.test(cmd)
  ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `""${cmd}" ${args.join(' ')}"`], { encoding: 'utf8', timeout, windowsHide: true, windowsVerbatimArguments: true })
  : spawnSync(cmd, args, { encoding: 'utf8', timeout, windowsHide: true });
const which = name => {
  const r = process.platform === 'win32' ? run('where.exe', [name]) : run('which', [name]);
  const all = (r.stdout ?? '').split(/\r?\n/).filter(Boolean);
  return all.find(p => /\.exe$/i.test(p)) ?? all[0] ?? null;
};

// 1. build and Electron
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
add('electron', fs.existsSync(electronExe), fs.existsSync(electronExe) ? electronExe : 'Electron binary missing', 'run: node node_modules/electron/install.js');
const built = ['out/main/index.js', 'out/preload/index.cjs', 'out/renderer/index.html'].every(f => fs.existsSync(path.join(root, f)));
add('build', built, built ? 'out/ complete' : 'out/ missing or partial', 'run: npm run build');

// 2. Claude CLI
const claude = process.env.SB_CLAUDE_PATH ?? which('claude');
if (!claude) add('claude-cli', false, 'claude not found on PATH', 'install Claude Code (https://code.claude.com) and open a new terminal');
else {
  const v = run(claude, ['--version']);
  add('claude-cli', v.status === 0, `${claude} · ${(v.stdout ?? '').trim() || v.stderr?.trim()}`, 'reinstall Claude Code');
  const a = run(claude, ['auth', 'status']);
  let s = null; try { s = JSON.parse(a.stdout); } catch { /* not JSON */ }
  const email = s?.email ? s.email.replace(/^(.{2}).*(@.*)$/, '$1…$2') : '';
  add('claude-login', !!s?.loggedIn, s ? `${s.loggedIn ? 'logged in' : 'not logged in'} · ${s.authMethod ?? '?'} ${email}` : 'auth status unreadable', 'the user runs in their terminal: claude auth login');
}

// 3. Cursor CLI (only presence and version: never a call that could reach Cursor's service from here)
const cursor = which('agent') ?? which('cursor-agent');
if (!cursor) add('cursor-cli', false, 'Cursor CLI (agent) not found', 'install it: https://cursor.com/docs/cli (then: agent login, run by the user)', 'warn');
else {
  const v = run(cursor, ['--version']);
  add('cursor-cli', v.status === 0, `${cursor} · ${(v.stdout ?? '').trim()}`, 'reinstall the Cursor CLI');
  add('cursor-login', true, 'not checked here (only the app or the user check it: Cursor tokens are spent only by Cursor)', '', 'info');
}

// 3b. CLI contracts (ADR 0055): the version the chats really run (Claude: the embedded engine; Cursor: its newest
// version folder, no process started) against the versions recorded in test/fixtures/cli; format drift seen today
const tested = testedVersions();
const contract = (id, cli, version) => {
  if (!version) return add(id, true, `${cli}: version unknown`, '', 'info');
  const ok = (tested[cli] ?? []).includes(version);
  add(id, ok, ok ? `${cli} ${version}: covered by the contract fixtures` : `${cli} ${version}: not tested (fixtures: ${(tested[cli] ?? []).join(', ') || 'none'})`,
    `use ${cli} chats in the dev instance (npm run dev), then node scripts/cli-fixtures.mjs and npx vitest run test/unit/chats/cli-contract.test.ts${cli === 'claude' ? '; or, only after the owner approves the real tokens: SB_LIVE=1 npx vitest run test/live/claude.live.test.ts' : ''}`, ok ? 'ok' : 'warn');
};
const embedded = path.join(root, 'node_modules', '@anthropic-ai', `claude-agent-sdk-${process.platform}-${process.arch}`, process.platform === 'win32' ? 'claude.exe' : 'claude');
const engine = process.env.SB_CLAUDE_PATH ?? (fs.existsSync(embedded) ? embedded : claude);
contract('claude-tested', 'claude', engine ? (run(engine, ['--version']).stdout ?? '').match(/\d+\.\d+\.\d+/)?.[0] : null);
const cursorVersions = path.join(process.env.LOCALAPPDATA ?? '', 'cursor-agent', 'versions');
// the same rule as src/main/chats/cli.ts newestCursorVersion: numeric date (month and day not zero-padded), complete folder
const VERSION_DIR = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-(\d{2})-(\d{2})-(\d{2}))?-[a-f0-9]+$/;
const versionKey = m => Number(`${m[1]}${m[2].padStart(2, '0')}${m[3].padStart(2, '0')}${m[4] ?? '00'}${m[5] ?? '00'}${m[6] ?? '00'}`);
const cursorNewest = fs.existsSync(cursorVersions) ? fs.readdirSync(cursorVersions).map(n => ({ n, m: n.match(VERSION_DIR) }))
  .filter(x => x.m && fs.existsSync(path.join(cursorVersions, x.n, 'node.exe')) && fs.existsSync(path.join(cursorVersions, x.n, 'index.js')))
  .sort((a, b) => versionKey(b.m) - versionKey(a.m))[0]?.n ?? null : null;
if (cursorNewest) contract('cursor-tested', 'cursor', cursorNewest);

// 4. brain folder
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8')); } catch { /* no config yet */ }
const brain = process.env.SB_BRAIN ?? cfg.brainRoot ?? null;
if (!brain) add('brain', false, 'no brain folder configured', 'start the app and pick one, or set SB_BRAIN', 'warn');
else {
  const has = f => fs.existsSync(path.join(brain, f));
  const parts = { 'AGENTS.md': has('AGENTS.md'), 'parse.mjs': has('ops/tools/brain-site/parse.mjs'), 'chats.mjs': has('harness/cursor/chats.mjs'), 'cost.mjs': has('ops/tools/cost.mjs') };
  const missing = Object.entries(parts).filter(([, v]) => !v).map(([k]) => k);
  add('brain', missing.length === 0, `${brain}${missing.length ? ` · missing: ${missing.join(', ')}` : ''}`, 'point the app to a brain folder with the standard structure', missing.length === Object.keys(parts).length ? 'fail' : missing.length ? 'warn' : 'ok');
}

// 5. MCP port and a running app
const port = Number(process.env.SB_MCP_PORT ?? cfg.mcpPort ?? (process.argv.includes('--dev') ? 4329 : 4319));
const ping = await new Promise(res => {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'doctor', version: '0' } } });
  const req = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { 'content-type': 'application/json', host: `127.0.0.1:${port}` }, timeout: 2000 }, r => {
    let d = ''; r.on('data', c => { d += c; }); r.on('end', () => { try { res({ up: true, name: JSON.parse(d).result?.serverInfo?.name ?? '?' }); } catch { res({ up: true, name: `HTTP ${r.statusCode}` }); } });
  });
  req.on('error', () => res({ up: false })); req.on('timeout', () => { req.destroy(); res({ up: false }); });
  req.end(body);
});
add('mcp', true, ping.up ? `port ${port}: ${ping.name} answering` : `port ${port}: nothing listening (app not running)`, ping.up ? '' : 'start the app: npm start', ping.up ? 'ok' : 'info');

// 6. recent errors in the logs
const logs = path.join(userData, 'logs');
if (!fs.existsSync(logs)) add('logs', true, `${logs} not created yet`, '', 'info');
else {
  const today = path.join(logs, `app-${new Date().toISOString().slice(0, 10)}.jsonl`);
  const errs = fs.existsSync(today) ? fs.readFileSync(today, 'utf8').split('\n').filter(l => l.includes('"lvl":"error"')) : [];
  const last = errs.at(-1) ? JSON.parse(errs.at(-1)) : null;
  add('logs', errs.length === 0, errs.length ? `${errs.length} errors today, last: ${last.scope} · ${last.msg} · cause: ${last.cause}` : `no errors today (${logs})`, last?.hint ?? 'node scripts/logs.mjs --level error', errs.length ? 'warn' : 'ok');
}

// 7. CLI format drift today (src/main/chats/drift.ts: one warn per CLI, version and unknown shape)
if (fs.existsSync(logs)) {
  const today = path.join(logs, `app-${new Date().toISOString().slice(0, 10)}.jsonl`);
  const drift = fs.existsSync(today) ? [...new Set(fs.readFileSync(today, 'utf8').split('\n').filter(l => l.includes('"scope":"drift"') && l.includes('"lvl":"warn"')).map(l => { try { return JSON.parse(l).cause; } catch { return null; } }).filter(Boolean))] : [];
  add('cli-drift', drift.length === 0, drift.length ? `${drift.length} CLI format changes today: ${drift.slice(0, 3).join(' · ')}` : 'no CLI format change today',
    'npm run logs -- --scope drift --since 24h; update chats/claude.ts or chats/acp.ts (or their known lists), then the contract test', drift.length ? 'warn' : 'ok');
}

if (process.argv.includes('--json')) console.log(JSON.stringify(checks, null, 1));
else for (const c of checks) console.log(`${{ ok: '✓', fail: '✗', warn: '!', info: '·' }[c.level]} ${c.id.padEnd(13)} ${c.detail}${c.hint && c.level !== 'ok' ? `  → ${c.hint}` : ''}`);
process.exit(checks.some(c => c.level === 'fail') ? 1 : 0);
