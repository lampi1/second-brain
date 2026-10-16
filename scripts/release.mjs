// Stable releases of the app (ADR 0007): the cockpit the user works in runs from a frozen copy outside the repo, so chats
// can develop, break and restart the dev build without touching it.
//   node scripts/release.mjs promote [--skip-check]   npm run check must be green (skip only for tests of this script),
//                                                      then build → copy out/ + package.json to releases/<ver>-<sha>/,
//                                                      share the Electron runtime, switch current.json, write launch.cmd (launch.sh on macOS/Linux)
//   node scripts/release.mjs rollback                 current ⇄ previous
//   node scripts/release.mjs status [--json]           what is current/previous, where the launcher is
//   node scripts/release.mjs launch                    (used by launch.cmd/.sh) start current; if its window does not report
//                                                      ready within 30 s, mark it bad and start the previous release;
//                                                      a start refused because the app is already open (or still
//                                                      quitting) is never "bad": an open app is left in front, a
//                                                      quitting one (quitting.json) is waited for, then retried;
//                                                      the outcome of each start goes to <base>/launch-result.json
// Root: the app's shared folder, %LOCALAPPDATA%/second-brain on Windows, per OS elsewhere (src/main/platform.ts; SB_RELEASES_ROOT overrides, for tests). Runs with plain Node or Electron-as-Node.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// the app's shared folder and Electron's appData per OS: same rule as src/main/platform.ts (this file runs without the build)
const home = os.homedir();
const sharedDir = process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'second-brain')
  : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'second-brain-shared')
  : path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'second-brain');
const appData = process.platform === 'win32' ? process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
  : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : process.env.XDG_CONFIG_HOME || path.join(home, '.config');
const base = process.env.SB_RELEASES_ROOT ?? sharedDir;
const releases = path.join(base, 'releases');
const statePath = path.join(base, 'current.json');
const readState = () => { try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return { current: null, previous: null, bad: [], history: [] }; } };
const writeState = s => { fs.mkdirSync(base, { recursive: true }); fs.writeFileSync(statePath, JSON.stringify(s, null, 2)); };
const say = m => console.log(m);
const cmd = process.argv[2];

// the shared runtime = a copy of node_modules/electron/dist; its executable: electron.exe, the macOS app bundle's
// binary, or electron on Linux
const electronDir = version => path.join(base, 'electron', version);
function electronFor(version) {
  const exe = process.platform === 'win32' ? ['electron.exe'] : process.platform === 'darwin' ? ['Electron.app', 'Contents', 'MacOS', 'Electron'] : ['electron'];
  return path.join(electronDir(version), ...exe);
}
const launcherFile = process.platform === 'win32' ? 'launch.cmd' : 'launch.sh'; // platform.ts launcherName

async function promote() {
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
  const sha = execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  if (dirty && !process.argv.includes('--allow-dirty')) throw new Error('the repo has uncommitted changes: commit them first (a release must match a commit)');
  if (!process.argv.includes('--skip-check')) {
    say('npm run check …');
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'check'], { cwd: repo, stdio: 'inherit', shell: process.platform === 'win32' });
    // and the packaged copy itself, as the user opens it, with the real brain (2026-10-11: dev green, stable broken)
    say('npm run test:stable …');
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'test:stable'], { cwd: repo, stdio: 'inherit', shell: process.platform === 'win32' });
  }
  // the check took minutes and agents work in this folder ("Migliora l'app", ADR 0020): build only what was checked
  const shaNow = execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirtyNow = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  if (shaNow !== sha || (dirtyNow && !process.argv.includes('--allow-dirty'))) throw new Error(`the repo changed during the check (${sha} -> ${shaNow}${dirtyNow ? ', uncommitted changes' : ''}): nothing promoted, run it again`);
  execFileSync(process.execPath, [path.join(repo, 'scripts', 'build.mjs')], { cwd: repo, stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  const id = `${pkg.version}-${sha}`;
  const dest = path.join(releases, id);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(path.join(repo, 'out'), path.join(dest, 'out'), { recursive: true });
  fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, type: pkg.type, main: pkg.main }, null, 2));
  const ev = JSON.parse(fs.readFileSync(path.join(repo, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  if (!fs.existsSync(electronFor(ev))) {
    say(`sharing Electron ${ev} runtime …`);
    // verbatimSymlinks: the macOS bundle's frameworks are relative symlinks; rewritten they would point into the repo
    fs.cpSync(path.join(repo, 'node_modules', 'electron', 'dist'), electronDir(ev), { recursive: true, verbatimSymlinks: true });
  }
  // the embedded Claude engine (ADR 0010): copied once per version next to the shared Electron runtime
  let claudeEngine = null;
  // the package for this OS and CPU (optionalDependencies; platform.ts claudeEnginePackage)
  const enginePkg = path.join(repo, 'node_modules', '@anthropic-ai', `claude-agent-sdk-${process.platform}-${process.arch}`);
  const engineBin = process.platform === 'win32' ? 'claude.exe' : 'claude';
  if (fs.existsSync(path.join(enginePkg, engineBin))) {
    const cv = JSON.parse(fs.readFileSync(path.join(enginePkg, 'package.json'), 'utf8')).version;
    claudeEngine = path.join(base, 'engines', 'claude', cv, engineBin);
    if (!fs.existsSync(claudeEngine)) {
      say(`sharing Claude engine ${cv} …`);
      fs.mkdirSync(path.dirname(claudeEngine), { recursive: true });
      fs.copyFileSync(path.join(enginePkg, engineBin), claudeEngine);
      if (process.platform !== 'win32') fs.chmodSync(claudeEngine, 0o755);
    }
  }
  // cookies of the browser environments encrypted at rest (DPAPI-protected key), never plaintext on disk (ADR 0003)
  // loaded here, not at the top: the launcher copy of this script (next to launch.cmd) runs without fuses.mjs
  const { ensureCookieEncryption } = await import('./fuses.mjs');
  try { say(`cookie encryption: ${ensureCookieEncryption(electronFor(ev))}`); } catch (e) { say(`WARNING cookie encryption not enabled: ${e.message}`); }
  // repo: where it was built from, the default code folder of "Migliora l'app" (ADR 0020)
  fs.writeFileSync(path.join(dest, 'release.json'), JSON.stringify({ id, version: pkg.version, sha, electron: ev, claudeEngine, repo, at: new Date().toISOString() }, null, 2));
  const s = readState();
  // a current release the launcher discarded is no fallback: the previous one (the one that runs) stays previous
  if (s.current !== id) { if (!(s.bad ?? []).includes(s.current)) s.previous = s.current; s.current = id; }
  s.bad = (s.bad ?? []).filter(b => b !== id);
  s.history = [...(s.history ?? []), { id, at: new Date().toISOString() }].slice(-20);
  writeState(s);
  writeLauncher();
  // keep the last 5 releases
  const keep = new Set([s.current, s.previous, ...s.history.slice(-5).map(h => h.id)]);
  for (const d of fs.readdirSync(releases)) if (!keep.has(d)) fs.rmSync(path.join(releases, d), { recursive: true, force: true });
  say(`promoted ${id} (previous: ${s.previous ?? 'none'}) · start it with ${path.join(base, launcherFile)}`);
  startSync(id);
}

// After a successful promotion: the GitHub sync of the product (built by a brain-side chat:
// export + data/secret check + push) runs in the background and never blocks the promotion. Configured in
// <base>/sync.json {"command": "<exe>", "args": ["…"], "cwd": "…"}; its outcome lands in <base>/sync/<release>.json
// {release, startedAt, endedAt, exitCode, ok, blocked, summary} and the stable app shows it as a notification.
function startSync(id) {
  if (process.env.SB_NO_SYNC === '1') return; // tests promote into temp folders: never publish from them
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(path.join(base, 'sync.json'), 'utf8')); } catch { return; }
  if (!cfg?.command) return;
  const dir = path.join(base, 'sync');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${id}.json`);
  const startedAt = new Date().toISOString();
  fs.writeFileSync(out, JSON.stringify({ release: id, startedAt, running: true }));
  // a detached Node-ish runner keeps going after this script exits and records the outcome; its summary = the last 6
  // lines plus the first error line above them (a crash ends with the error object; same as src/main/sync.ts summarize)
  const runner = `const {spawn}=require('node:child_process');const fs=require('node:fs');const c=JSON.parse(process.argv[1]);let log='';` +
    `const p=spawn(c.command,c.args||[],{cwd:c.cwd||undefined,windowsHide:true,env:{...process.env,SB_RELEASE_ID:c.id}});` +
    `p.stdout.on('data',d=>{log+=d});p.stderr.on('data',d=>{log+=d});` +
    `p.on('close',code=>{const ls=log.trim().split(/\\r?\\n/),cause=ls.slice(0,-6).find(l=>/^\\s*(?:\\w*Error\\b|fatal: |error: )/.test(l));` +
    `const tail=(cause?[cause.trim(),'…',...ls.slice(-6)]:ls.slice(-6)).join('\\n');fs.writeFileSync(c.out,JSON.stringify({release:c.id,startedAt:c.startedAt,endedAt:new Date().toISOString(),exitCode:code,ok:code===0,blocked:code===2,summary:tail}))});` +
    `p.on('error',e=>fs.writeFileSync(c.out,JSON.stringify({release:c.id,startedAt:c.startedAt,endedAt:new Date().toISOString(),exitCode:-1,ok:false,blocked:false,summary:String(e.message)})));`;
  const child = spawn(process.execPath, ['-e', runner, JSON.stringify({ ...cfg, id, out, startedAt })], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  child.unref();
  say(`sync started in the background → ${out}`);
}

function writeLauncher() {
  // launch.cmd runs this script with the shared Electron as Node (no Node install needed); a copy lives next to it
  fs.copyFileSync(fileURLToPath(import.meta.url), path.join(base, 'release.mjs'));
  const s = readState();
  const rel = JSON.parse(fs.readFileSync(path.join(releases, s.current, 'release.json'), 'utf8'));
  if (process.platform !== 'win32') return writeShLauncher(rel);
  fs.writeFileSync(path.join(base, 'launch.cmd'), `@echo off\r\nrem second-brain stable launcher (scripts/release.mjs). Starts the current release, falls back to the previous one.\r\nset ELECTRON_RUN_AS_NODE=1\r\nstart "" /b "${electronFor(rel.electron)}" "%~dp0release.mjs" launch\r\n`);
  // launch.vbs runs launch.cmd without a console window: the Start-menu and desktop shortcuts point here (the stable
  // app writes them itself, with its AppUserModelId, so Windows shows its notifications)
  fs.writeFileSync(path.join(base, 'launch.vbs'), `' second-brain: starts launch.cmd hidden\r\nCreateObject("WScript.Shell").Run """" & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\\launch.cmd""", 0, False\r\n`);
}

/** macOS/Linux (ADR 0054): launch.sh does what launch.cmd does, in the background. It first takes the login shell's
 *  PATH: an app started from the Finder, the Dock or a desktop menu gets a minimal one, and the CLIs the chats run
 *  (claude, agent, git, node in ~/.local/bin or Homebrew) would not be found. macOS also gets second-brain.command
 *  (double-click in the Finder, or drag it to the Dock); Linux gets its menu entry from the app (shortcuts.ts). */
function writeShLauncher(rel) {
  const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const sh = [
    '#!/bin/sh',
    '# second-brain stable launcher (scripts/release.mjs). Starts the current release, falls back to the previous one.',
    'P=$("${SHELL:-/bin/sh}" -lc \'printf %s "$PATH"\' 2>/dev/null) && [ -n "$P" ] && PATH=$P && export PATH',
    'cd "$(dirname "$0")" || exit 1',
    `ELECTRON_RUN_AS_NODE=1 nohup ${q(electronFor(rel.electron))} ./release.mjs launch >/dev/null 2>&1 &`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(base, 'launch.sh'), sh, { mode: 0o755 });
  fs.chmodSync(path.join(base, 'launch.sh'), 0o755);
  if (process.platform === 'darwin') {
    fs.writeFileSync(path.join(base, 'second-brain.command'), '#!/bin/sh\n# second-brain: starts launch.sh (scripts/release.mjs)\nexec "$(dirname "$0")/launch.sh"\n', { mode: 0o755 });
    fs.chmodSync(path.join(base, 'second-brain.command'), 0o755);
  }
}

function rollback() {
  const s = readState();
  if (!s.previous) throw new Error('no previous release to go back to');
  [s.current, s.previous] = [s.previous, s.current];
  writeState(s);
  writeLauncher();
  say(`current is now ${s.current} (previous: ${s.previous})`);
}

// src/main/index.ts exits with this code when another instance holds the app's single-instance lock: the app is already
// open (it got the focus) or still quitting. Never a broken release (2026-10-12: 91967ec marked bad that way, the icon
// clicked while the old instance was still closing).
const ALREADY_RUNNING = 75;
const WAIT_MS = Number(process.env.SB_LAUNCH_WAIT_MS) || 30_000; // tests shorten the waits
const sleep = ms => new Promise(r => setTimeout(r, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/** One start: 'ready' (its window wrote ready.json), 'busy' (another instance holds the lock) or 'failed', with why. */
async function startOnce(id, rel, ready) {
  const startedAt = Date.now();
  const env = { ...process.env, SB_RELEASE: id, ...(rel.claudeEngine ? { SB_ENGINE_CLAUDE: rel.claudeEngine } : {}) };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronFor(rel.electron), [path.join(releases, id)], { env, detached: true, stdio: 'ignore' });
  child.unref();
  const secs = () => Math.round((Date.now() - startedAt) / 1000);
  for (let waited = 0; waited < WAIT_MS; waited += 500) {
    await sleep(500);
    try { const r = JSON.parse(fs.readFileSync(ready, 'utf8')); if (r.release === id && Date.parse(r.at) >= startedAt - 1000) return { r: 'ready', reason: `window ready after ${secs()} s` }; } catch { /* not yet */ }
    if (child.exitCode !== null) return child.exitCode === ALREADY_RUNNING ? { r: 'busy', reason: 'another instance holds the app' } : { r: 'failed', reason: `exited with code ${child.exitCode} after ${secs()} s` };
  }
  try { process.kill(child.pid); } catch { /* gone */ }
  return { r: 'failed', reason: `window not ready within ${Math.round(WAIT_MS / 1000)} s` };
}

// <base>/launch-result.json: how the last start went, read by the app after it starts (the "Migliora l'app" banner:
// the new release started, or the previous one and why). Atomic, never an error if it cannot be written.
function writeResult(result) {
  const f = path.join(base, 'launch-result.json');
  try { fs.writeFileSync(`${f}.tmp`, JSON.stringify(result, null, 2)); fs.renameSync(`${f}.tmp`, f); } catch { /* best effort */ }
}

async function launch() {
  const s = readState();
  const result = { at: new Date().toISOString(), wanted: s.current, started: null, attempts: [] };
  const note = (id, outcome, reason) => { result.attempts.push({ id, outcome, reason }); writeResult(result); };
  // before any start: the app reads the file while it starts, before 'started' lands, and must never find an earlier
  // start's record there (another release wanted → a false "it did not start")
  writeResult(result);
  for (const id of [s.current, s.previous]) if (id && (s.bad ?? []).includes(id)) note(id, 'skipped-bad', 'marked bad by an earlier start');
  const order = [s.current, s.previous].filter(id => id && !(s.bad ?? []).includes(id));
  const userData = process.env.SB_USER_DATA ?? path.join(appData, 'second-brain');
  const ready = path.join(userData, 'ready.json');
  for (const id of order) {
    const rel = JSON.parse(fs.readFileSync(path.join(releases, id, 'release.json'), 'utf8'));
    let o = await startOnce(id, rel, ready);
    let waited = '';
    // busy: if the instance that holds the lock (the last one that wrote ready.json) is quitting (it wrote quitting.json
    // in before-quit), wait for it to go and start again; if it is open, the second start brought it to the front: done
    for (let tries = 0; o.r === 'busy' && tries < 3; tries++) {
      const pidIn = f => { try { return JSON.parse(fs.readFileSync(path.join(userData, f), 'utf8')).pid ?? null; } catch { return null; } };
      const holder = pidIn('ready.json');
      if (holder && alive(holder)) {
        if (pidIn('quitting.json') !== holder) { say(`already running (pid ${holder}): brought to the front`); note(id, 'already-running', `pid ${holder} is open`); return; }
        const until = Date.now() + WAIT_MS;
        while (alive(holder) && Date.now() < until) await sleep(250);
        if (alive(holder)) { say(`pid ${holder} still quitting after ${WAIT_MS} ms: ${id} not started, not marked bad`); note(id, 'still-quitting', `pid ${holder} still quitting after ${Math.round(WAIT_MS / 1000)} s`); return; }
        waited = ` (after pid ${holder} finished quitting)`;
      } else { await sleep(1000); waited = ' (after a busy start)'; }
      o = await startOnce(id, rel, ready);
    }
    if (o.r === 'ready') { say(`started ${id}`); result.started = id; note(id, 'started', o.reason + waited); return; }
    if (o.r === 'busy') { say(`another instance still holds the app: ${id} not started, not marked bad`); note(id, 'still-quitting', o.reason); return; }
    say(`release ${id} did not start (${o.reason}): marking it bad`);
    s.bad = [...new Set([...(s.bad ?? []), id])];
    writeState(s);
    note(id, 'bad', o.reason);
  }
  throw new Error('no release could start: run `npm run dev` in the repo and check `npm run logs -- --level error`');
}

try {
  if (cmd === 'promote') await promote();
  else if (cmd === 'rollback') rollback();
  else if (cmd === 'launch') await launch();
  else if (cmd === 'status') { const s = readState(); console.log(process.argv.includes('--json') ? JSON.stringify({ base, ...s }) : `base ${base}\ncurrent ${s.current ?? '-'}\nprevious ${s.previous ?? '-'}\nbad ${(s.bad ?? []).join(', ') || '-'}`); }
  else { console.error('usage: release.mjs promote|rollback|launch|status'); process.exit(3); }
} catch (e) { console.error(`release: ${e.message}`); process.exit(1); }
