// doctor: is the selected stable/dev instance ready? Uses the app's filesystem discovery, without running candidates.
// --probe-claude explicitly checks Claude's version/login; other engines are never started. Reads version metadata,
// whether versions are covered by the CLI contract fixtures and whether a CLI format
// changed today (ADR 0055), the brain folder, the MCP port, recent errors in the logs and the repo's guard (ADR 0061: hooks
// active, deny list and e-mail config; the values are never printed). No model calls. Readable by agents:
//   node scripts/doctor.mjs           human lines: ✓/✗/! name · detail · → next step
//   node scripts/doctor.mjs --json    [{ id, ok, level, detail, hint }]; exit 1 if any check failed
//   --dev                             check the dev instance (userData second-brain-dev, MCP 4329) instead of the stable one
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testedVersions } from './cli-fixtures.mjs';
import { guardStatus, statusLines } from './guard-lib.mjs';
import { cursorInstall, discoverClaude, findCli } from '../src/main/chats/discovery.mjs';
import { claudeLogin, doctorContext, packageVersion } from './doctor-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const context = doctorContext({ root, dev: process.argv.includes('--dev') });
const { userData, brain, port } = context;
const probeClaude = process.argv.includes('--probe-claude');
const checks = [];
const add = (id, ok, detail, hint = '', level = ok ? 'ok' : 'fail') => checks.push({ id, ok, level, detail, hint });
// .cmd/.bat shims (the Cursor CLI on Windows) need cmd.exe; our arguments are fixed flags, never user text
const run = (cmd, args, timeout = 20000) => /\.(cmd|bat)$/i.test(cmd)
  ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `""${cmd}" ${args.join(' ')}"`], { encoding: 'utf8', timeout, windowsHide: true, windowsVerbatimArguments: true })
  : spawnSync(cmd, args, { encoding: 'utf8', timeout, windowsHide: true });
add('context', true, `${context.mode} · userData=${userData} (${context.userDataSource}) · config=${context.configPath} (${context.configState}) · brain=${context.brainSource} · MCP=${port} (${context.portSource})${context.savedPort !== null ? ` · saved MCP setting=${context.savedPort}` : ''} · app=${context.appRoot}${context.release ? ` · release=${context.release}` : context.mode === 'stable' ? ' (release metadata unavailable; checking repo build/engine)' : ''}`, '', 'info');

// 1. build and Electron
const electronExe = context.electron;
add('electron', fs.existsSync(electronExe), fs.existsSync(electronExe) ? electronExe : 'Electron binary missing', 'run: node node_modules/electron/install.js');
const built = ['out/main/index.js', 'out/preload/index.cjs', 'out/renderer/index.html'].every(f => fs.existsSync(path.join(context.appRoot, f)));
add('build', built, `${context.appRoot} · out/ ${built ? 'complete' : 'missing or partial'}`, 'run: npm run build');

// 2. Claude CLI
const selectedClaude = discoverClaude({ release: context.releaseEngine, starts: [context.appRoot] });
const claude = selectedClaude?.path;
let claudeVersion = null;
if (!claude || !fs.existsSync(claude)) add('claude-cli', false, claude ? `${claude} (override missing)` : 'Claude CLI not found in the selected app or user installs', 'check the selected instance and install Claude Code (https://code.claude.com)');
else {
  // The embedded SDK package (and the release folder named after it) has a different version from the CLI binary.
  // Only a CLI package's metadata or an explicit version probe can establish the CLI contract version.
  claudeVersion = packageVersion(claude, '@anthropic-ai/claude-code');
  add('claude-cli', true, `${claude} (${selectedClaude.source})${claudeVersion ? ` · ${claudeVersion}` : ' · version not verified'}`);
  if (probeClaude) {
    const v = run(claude, ['--version']);
    claudeVersion = v.status === 0 ? (v.stdout ?? '').match(/\d+\.\d+\.\d+[\w.+-]*/)?.[0] ?? null : null;
    add('claude-version', v.status === 0, claudeVersion ?? 'version not verified', 'check the selected Claude CLI', v.status === 0 ? 'ok' : 'warn');
    const a = run(claude, ['auth', 'status']);
    const login = claudeLogin(a.stdout ?? '');
    add('claude-login', login.ok, `${login.detail} · ${claude}`, login.hint, login.level);
  } else add('claude-login', true, `not verified (CLI not started) · ${claude}`, 'the user may run doctor --probe-claude to check this CLI without a model call', 'info');
}

// 3. Cursor CLI (only presence and version: never a call that could reach Cursor's service from here)
const cursorDir = process.env.SB_CURSOR_PATH ? null : cursorInstall();
const cursor = process.env.SB_CURSOR_PATH || cursorDir || findCli('agent') || (process.platform === 'win32' ? null : findCli('cursor-agent'));
if (!cursor) add('cursor-cli', false, 'Cursor CLI (agent) not found', 'install it: https://cursor.com/docs/cli (then: agent login, run by the user)', 'warn');
else {
  add('cursor-cli', true, `${cursor} (${process.env.SB_CURSOR_PATH ? 'override' : cursorDir ? 'installed version' : 'command'})`);
  add('cursor-login', true, 'not verified (CLI not started); an app report of Authentication required is a separate login result', '', 'info');
}

// 3c. Codex CLI (ADR 0060): only presence, and the version read from its npm package next to the shim. Never run here,
// not even `--version`: an agent may run doctor, and no agent ever starts the Codex CLI (repo rule 4)
const codex = process.env.SB_CODEX_PATH || findCli('codex');
if (!codex) add('codex-cli', true, 'Codex CLI (codex) not found: optional engine', 'to use it: npm i -g @openai/codex, then the user runs: codex login (or a key in Settings → Motori), and turns Codex on in Settings → Motori', 'info');
else {
  const version = packageVersion(codex, '@openai/codex');
  add('codex-cli', true, `${codex}${version ? ` · ${version}` : ' · version not read (not an npm install)'}`, '', 'ok');
  add('codex-login', true, 'not checked here (only the app or the user check it: Codex tokens are spent only by Codex)', '', 'info');
}

const kimi = process.env.SB_KIMI_PATH || findCli('kimi');
add('kimi-cli', true, kimi ?? 'Kimi CLI not found: optional engine', '', kimi ? 'ok' : 'info');
if (kimi) add('kimi-login', true, 'not verified (CLI not started)', '', 'info');

// 3b. CLI contracts (ADR 0055): the version the chats really run (Claude: the embedded engine; Cursor: its newest
// version folder, no process started) against the versions recorded in test/fixtures/cli; format drift seen today
const tested = testedVersions();
const contract = (id, cli, version) => {
  if (!version) return add(id, true, `${cli}: version unknown`, '', 'info');
  const ok = (tested[cli] ?? []).includes(version);
  add(id, ok, ok ? `${cli} ${version}: covered by the contract fixtures` : `${cli} ${version}: not tested (fixtures: ${(tested[cli] ?? []).join(', ') || 'none'})`,
    `use ${cli} chats in the dev instance (npm run dev), then node scripts/cli-fixtures.mjs and npx vitest run test/unit/chats/cli-contract.test.ts${cli === 'claude' ? '; or, only after the owner approves the real tokens: SB_LIVE=1 npx vitest run test/live/claude.live.test.ts' : ''}`, ok ? 'ok' : 'warn');
};
contract('claude-tested', 'claude', claudeVersion);
if (cursorDir) contract('cursor-tested', 'cursor', path.basename(cursorDir));

// 4. brain folder
if (!brain) add('brain', false, `no brain folder configured for ${context.mode} · ${context.configPath} (${context.configState})`, `select the intended instance (${context.mode === 'dev' ? 'omit --dev for stable' : '--dev for dev'}), or set SB_USER_DATA / SB_BRAIN`, 'warn');
else {
  const has = f => fs.existsSync(path.join(brain, f));
  const parts = { 'AGENTS.md': has('AGENTS.md'), 'parse.mjs': has('ops/tools/brain-site/parse.mjs'), 'chats.mjs': has('harness/cursor/chats.mjs'), 'cost.mjs': has('ops/tools/cost.mjs') };
  const missing = Object.entries(parts).filter(([, v]) => !v).map(([k]) => k);
  add('brain', missing.length === 0, `${brain} (${context.brainSource})${missing.length ? ` · missing: ${missing.join(', ')}` : ''}`, 'point the selected instance to a brain folder with the standard structure', missing.length === Object.keys(parts).length ? 'fail' : missing.length ? 'warn' : 'ok');
}

// 5. MCP port and a running app
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
    'npm run logs -- --scope drift --since 24h; update chats/claude.ts, chats/acp.ts or chats/codex.ts (or their known lists), then the contract test', drift.length ? 'warn' : 'ok');
}

// 8. the repo's guard (ADR 0061): hooks on, the deny list readable when set, user.email = guard.email when set
const gs = guardStatus(root);
if (gs.repo && !gs.error) {
  const [hooksLine, denyLine, emailLine] = statusLines(gs);
  add('guard-hooks', gs.hooks, hooksLine.replace(/^guard hooks: /, ''), 'run: npm run setup (sets core.hooksPath .githooks for this repo)', gs.hooks ? 'ok' : 'warn');
  add('guard-deny', gs.deny !== 'missing', denyLine.replace(/^guard deny list: /, ''), gs.deny === 'missing' ? 'restore the file, or point git config guard.denyList to it' : 'optional: git config guard.denyList "<path>"', gs.deny === 'missing' ? 'fail' : gs.deny === 'ok' ? 'ok' : 'info');
  add('guard-email', gs.email !== 'set' || gs.userEmailMatches, emailLine.replace(/^guard e-mail: /, ''), gs.email === 'set' ? 'git config user.email <the guard.email address>' : 'optional: git config guard.email "<you>@users.noreply.github.com"', gs.email === 'set' ? (gs.userEmailMatches ? 'ok' : 'fail') : 'info');
} else if (gs.error) add('guard', false, gs.error, 'check the repo git config', 'warn');

if (process.argv.includes('--json')) console.log(JSON.stringify(checks, null, 1));
else for (const c of checks) console.log(`${{ ok: '✓', fail: '✗', warn: '!', info: '·' }[c.level]} ${c.id.padEnd(13)} ${c.detail}${c.hint && c.level !== 'ok' ? `  → ${c.hint}` : ''}`);
process.exit(checks.some(c => c.level === 'fail') ? 1 : 0);
