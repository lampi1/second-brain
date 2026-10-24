// Stable releases of the app (ADR 0007): the cockpit the user works in runs from a frozen copy outside the repo, so chats
// can develop, break and restart the dev build without touching it.
//   node scripts/release.mjs promote                 npm run check and test:stable must be green on clean main,
//                                                      then build → copy out/ (the guard's scanner included,
//                                                      out/guard/scan.mjs) + package.json to releases/<ver>-<sha>/,
//                                                      share the Electron runtime, switch current.json, write launch.cmd (launch.sh on macOS/Linux)
//   node scripts/release.mjs promote-now             the app's "Aggiorna": the same without check and test:stable (ADR 0075)
//   node scripts/release.mjs rollback                 current ⇄ previous
//   node scripts/release.mjs status [--json]           what is current/previous, where the launcher is
//   node scripts/release.mjs launch                    (used by launch.cmd/.sh) start current; if its window does not report
//                                                      ready within 30 s, mark it bad and start the previous release;
//                                                      a start refused because the app is already open (or still
//                                                      quitting) is never "bad": an open app is left in front, a
//                                                      quitting one (quitting.json) is waited for, then retried;
//                                                      the outcome of each start goes to <base>/launch-result.json
// Root: the app's shared folder, %LOCALAPPDATA%/second-brain on Windows, per OS elsewhere (src/main/platform.ts; SB_RELEASES_ROOT overrides, for tests). Runs with plain Node or Electron-as-Node.
// stage-test prepares only an isolated disposable copy; stage-update <payload> <manifest-sha256> verifies and stages
// immutable assets, apply-update <id> <manifest-sha256> <current-id> switches only the consented selection without restart.
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RELEASE_WRITER_PROTOCOL, acquireReleaseLock, assertReleaseLease, withReleaseLock, releaseLockInfo, stageInstall, prepareApply, safePayloadPath } from './update.mjs';

// This maintenance process verifies and copies runtime archives as physical files, never as virtual directories.
// Electron's ASAR shim otherwise makes lstat(default_app.asar).isFile() false even when its bytes match.
if (process.versions.electron) process.noAsar = true;

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// the app's shared folder and Electron's appData per OS: same rule as src/main/platform.ts (this file runs without the build)
const home = os.homedir();
const sharedDir = process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'second-brain')
  : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'second-brain-shared')
  : path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'second-brain');
const appData = process.platform === 'win32' ? process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
  : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : process.env.XDG_CONFIG_HOME || path.join(home, '.config');
const base = path.resolve(process.env.SB_RELEASES_ROOT ?? sharedDir);
const releases = path.join(base, 'releases');
const statePath = path.join(base, 'current.json');
const readState = () => {
  let s;
  try { s = JSON.parse(fs.readFileSync(safePayloadPath(base, 'current.json'), 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return { current: null, previous: null, bad: [], history: [] };
    throw new Error('current.json could not be read; preserve it and repair it before installing');
  }
  if (!s || typeof s !== 'object' || !Array.isArray(s.bad ?? []) || !Array.isArray(s.history ?? []) || (s.writerProtocol !== undefined && s.writerProtocol !== RELEASE_WRITER_PROTOCOL)) throw new Error('invalid release state or incompatible writer protocol');
  for (const id of [s.current, s.previous, ...(s.bad ?? []), ...(s.history ?? []).map(h => h.id)]) if (id != null) assertReleaseId(id);
  return { ...s, current: s.current ?? null, previous: s.previous ?? null, bad: s.bad ?? [], history: s.history ?? [] };
};
const writeState = (s, lease) => {
  assertReleaseLease(base, lease); lease.begin();
  const tmp = `${statePath}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, 'wx');
  try { fs.writeFileSync(fd, JSON.stringify({ ...s, writerProtocol: RELEASE_WRITER_PROTOCOL }, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, statePath);
};
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

export function assertReleaseId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id)) throw new Error('invalid release identifier');
  return id;
}

const inside = (parent, child) => { const rel = path.relative(parent, child); return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel); };
/** Staging is never a promotion bypass: only new disposable directories, with no junction escaping their root. */
export function assertStagingRoot(dir) {
  const resolved = path.resolve(dir);
  let ancestor = resolved;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const actual = path.resolve(fs.realpathSync.native(ancestor), path.relative(ancestor, resolved));
  const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (!same(actual, resolved)) throw new Error('staging through a symlink or junction is not allowed');
  if (!(inside(fs.realpathSync.native(os.tmpdir()), actual) || inside(path.join(repo, 'test-results'), actual)) ||
      same(actual, sharedDir) || inside(actual, sharedDir) || inside(sharedDir, actual)) throw new Error('stage-test requires a disposable directory under the OS temp folder or this checkout/test-results');
  if (fs.existsSync(resolved) && fs.readdirSync(resolved).length) throw new Error('stage-test destination must be empty');
}

export function releaseEnginePath(rel, root = base) {
  if (!rel.claudeEngine) return null;
  if (path.isAbsolute(rel.claudeEngine)) return rel.claudeEngine; // existing local promotions
  const engine = path.resolve(root, rel.claudeEngine);
  if (!inside(root, engine)) throw new Error('engine escapes the installation');
  return engine;
}

// quick = "promote-now", the app's "Aggiorna" click (owner, 2026-10-19: "che si passi subito alla nuova versione senza
// lanciare tutti i test"): the same clean main, build, copy and switch, without `npm run check` and test:stable; the
// launcher still falls back to the previous release if the new one does not start (ADR 0075)
async function promote(staging = false, quick = false) {
  if (process.argv.includes('--skip-check') || process.argv.includes('--allow-dirty')) throw new Error('promotion bypass flags are not supported; use stage-test in a disposable directory');
  if (staging) {
    if (!process.env.SB_RELEASES_ROOT || process.env.SB_NO_SYNC !== '1') throw new Error('stage-test requires SB_RELEASES_ROOT and SB_NO_SYNC=1');
    assertStagingRoot(base);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
  const sha = execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  if (!staging && dirty) throw new Error('the repo has uncommitted changes: commit them first (a release must match a commit)');
  if (!staging) {
    const branch = execFileSync('git', ['-C', repo, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
    if (branch !== 'main') throw new Error('promotion is only allowed from main');
  }
  if (!staging && !quick) {
    say('npm run check …');
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'check'], { cwd: repo, stdio: 'inherit', shell: process.platform === 'win32' });
    // and the packaged copy itself, as the user opens it, with the real brain (2026-10-11: dev green, stable broken)
    say('npm run test:stable …');
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'test:stable'], { cwd: repo, stdio: 'inherit', shell: process.platform === 'win32' });
  }
  // the check took minutes and agents may work in this folder: build only what was checked
  const shaNow = execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirtyNow = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  if (shaNow !== sha || (!staging && dirtyNow)) throw new Error(`the repo changed during the check (${sha} -> ${shaNow}${dirtyNow ? ', uncommitted changes' : ''}): nothing promoted, run it again`);
  execFileSync(process.execPath, [path.join(repo, 'scripts', 'build.mjs')], { cwd: repo, stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  const lease = acquireReleaseLock(base, staging ? 'stage-test' : 'promote');
  try {
  const draft = dirty ? `-draft-${createHash('sha256').update(fs.readFileSync(path.join(repo, 'out', 'main', 'index.js'))).update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex').slice(0, 10)}` : '';
  const id = assertReleaseId(`${pkg.version}-${sha}${draft}`);
  const dest = path.join(releases, id);
  if (fs.existsSync(dest)) throw new Error(`release ${id} already exists; frozen releases are never overwritten`);
  lease.begin();
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(path.join(repo, 'out'), path.join(dest, 'out'), { recursive: true });
  fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, type: pkg.type, main: pkg.main, repository: pkg.repository, bugs: pkg.bugs }, null, 2));
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
    assertReleaseId(cv);
    claudeEngine = path.join('engines', 'claude', cv, engineBin);
    const engineTarget = path.join(base, claudeEngine);
    if (!fs.existsSync(engineTarget)) {
      say(`sharing Claude engine ${cv} …`);
      fs.mkdirSync(path.dirname(engineTarget), { recursive: true });
      fs.copyFileSync(path.join(enginePkg, engineBin), engineTarget);
      if (process.platform !== 'win32') fs.chmodSync(engineTarget, 0o755);
    }
  }
  // cookies of the browser environments encrypted at rest (DPAPI-protected key), never plaintext on disk (ADR 0003)
  // loaded here, not at the top: the launcher copy of this script (next to launch.cmd) runs without fuses.mjs
  const { ensureCookieEncryption } = await import('./fuses.mjs');
  say(`cookie encryption: ${ensureCookieEncryption(electronFor(ev))}`);
  // repo: where it was built from, the default code folder that "Aggiorna" updates (ADR 0075)
  // Ship the empty public template, never the builder's brain or machine configuration.
  fs.cpSync(path.join(repo, 'brain-template'), path.join(dest, 'brain-template'), { recursive: true });
  const { templateManifest } = await import('./template-manifest.mjs');
  const templateData = JSON.stringify(templateManifest(path.join(dest, 'brain-template')), null, 2);
  fs.writeFileSync(path.join(dest, 'brain-template.manifest.json'), templateData);
  const templateManifestSha256 = createHash('sha256').update(templateData).digest('hex');
  fs.writeFileSync(path.join(dest, 'release.json'), JSON.stringify({ id, version: pkg.version, sha, writerProtocol: RELEASE_WRITER_PROTOCOL, electron: ev, claudeEngine, templateManifestSha256, ...(staging ? {} : { repo }), at: new Date().toISOString() }, null, 2));
  activate(id, lease);
  const s = readState();
  if (staging) { lease.commit(); say(`staged ${id} in ${base}`); return; }
  // keep the last 5 releases
  const keep = new Set([s.current, s.previous, ...s.history.slice(-5).map(h => h.id)]);
  for (const d of fs.readdirSync(releases)) if (!keep.has(d)) fs.rmSync(path.join(releases, d), { recursive: true, force: true });
  lease.commit();
  say(`promoted ${id} (previous: ${s.previous ?? 'none'}) · start it with ${path.join(base, launcherFile)}`);
  startSync(id);
  } finally { lease.release(); }
}

/** An installer activates only the frozen payload already copied by Setup; it never builds, syncs or runs npm. */
function activate(id, lease, copyBootstrap = true) {
  assertReleaseLease(base, lease);
  assertReleaseId(id);
  const rel = JSON.parse(fs.readFileSync(path.join(releases, id, 'release.json'), 'utf8'));
  if (rel.id !== id || rel.writerProtocol !== RELEASE_WRITER_PROTOCOL || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(rel.electron)) throw new Error('invalid release metadata or incompatible writer protocol');
  if (!fs.existsSync(electronFor(rel.electron)) || !fs.existsSync(path.join(releases, id, 'out', 'main', 'index.js'))) throw new Error('incomplete release payload');
  const engine = releaseEnginePath(rel);
  if (engine && !fs.existsSync(engine)) throw new Error('release engine missing');
  const s = readState();
  // a current release the launcher discarded is no fallback: the previous one (the one that runs) stays previous
  if (s.current !== id) { if (!(s.bad ?? []).includes(s.current)) s.previous = s.current; s.current = id; }
  s.bad = (s.bad ?? []).filter(b => b !== id);
  s.history = [...(s.history ?? []), { id, at: new Date().toISOString() }].slice(-20);
  lease.begin();
  writeLauncher(rel, copyBootstrap);
  writeState(s, lease);
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

function writeLauncher(release, copyBootstrap = true) {
  // launch.cmd runs this script with the shared Electron as Node (no Node install needed); a copy lives next to it
  if (copyBootstrap && path.resolve(fileURLToPath(import.meta.url)) !== path.resolve(base, 'release.mjs')) fs.copyFileSync(fileURLToPath(import.meta.url), path.join(base, 'release.mjs'));
  const updater = path.join(path.dirname(fileURLToPath(import.meta.url)), 'update.mjs');
  if (copyBootstrap && fs.existsSync(updater) && path.resolve(updater) !== path.resolve(base, 'update.mjs')) fs.copyFileSync(updater, path.join(base, 'update.mjs'));
  const s = readState();
  const rel = release ?? JSON.parse(fs.readFileSync(path.join(releases, assertReleaseId(s.current), 'release.json'), 'utf8'));
  fs.copyFileSync(path.join(releases, rel.id ?? s.current, 'out', 'icon.ico'), path.join(base, 'icon.ico'));
  if (process.platform !== 'win32') return writeShLauncher(rel);
  // A missing current runtime must not prevent release.mjs itself from starting and selecting the previous release.
  // Record only validated runtime versions from retained releases; never discover arbitrary executables from PATH.
  const versions = [rel.electron];
  for (const id of [s.current, s.previous]) {
    if (!id) continue;
    try { const retained = JSON.parse(fs.readFileSync(path.join(releases, assertReleaseId(id), 'release.json'), 'utf8')); if (/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(retained.electron)) versions.push(retained.electron); } catch { /* unusable metadata cannot supply a bootstrap */ }
  }
  const candidates = [...new Set(versions)];
  fs.writeFileSync(path.join(base, 'launch.cmd'), ['@echo off', 'rem second-brain stable launcher: bundled runtimes, no system Node or PATH.', 'setlocal DisableDelayedExpansion', 'set "ELECTRON_RUN_AS_NODE=1"', 'set "SB_RELEASES_ROOT=%~dp0"', 'set "R="', ...candidates.map(version => `if not defined R if exist "%~dp0electron\\${version}\\electron.exe" set "R=%~dp0electron\\${version}\\electron.exe"`), 'if not defined R exit /b 1', '"%R%" "%~dp0release.mjs" launch', ''].join('\r\n'));
  // Start-menu/desktop links use VBS directly so neither a console nor cmd quoting is part of ordinary startup.
  fs.writeFileSync(path.join(base, 'launch.vbs'), ["' second-brain stable launcher, hidden and independent of cmd/PATH", 'Dim s, f, b, r', 'Set s = CreateObject("WScript.Shell")', 'Set f = CreateObject("Scripting.FileSystemObject")', 'b = f.GetParentFolderName(WScript.ScriptFullName)', 'r = ""', ...candidates.map(version => `If r = "" And f.FileExists(b & "\\electron\\${version}\\electron.exe") Then r = b & "\\electron\\${version}\\electron.exe"`), 'If r = "" Then WScript.Quit 1', 's.Environment("PROCESS")("ELECTRON_RUN_AS_NODE") = "1"', 's.Environment("PROCESS")("SB_RELEASES_ROOT") = b', 's.Run Chr(34) & r & Chr(34) & " " & Chr(34) & b & "\\release.mjs" & Chr(34) & " launch", 0, False', ''].join('\r\n'));
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

function rollback(expectedCurrent, expectedPrevious, lease, copyBootstrap = true) {
  assertReleaseLease(base, lease);
  const s = readState();
  if ((expectedCurrent !== undefined || expectedPrevious !== undefined) && (s.current !== assertReleaseId(expectedCurrent) || s.previous !== assertReleaseId(expectedPrevious))) throw new Error('release selection changed; conditional rollback refused');
  if (!s.previous) throw new Error('no previous release to go back to');
  [s.current, s.previous] = [s.previous, s.current];
  writeState(s, lease);
  writeLauncher(undefined, copyBootstrap);
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
  const engine = releaseEnginePath(rel);
  const env = { ...process.env, SB_RELEASE: id, ...(engine ? { SB_ENGINE_CLAUDE: engine } : {}) };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronFor(rel.electron), [path.join(releases, id)], { env, detached: true, stdio: 'ignore' });
  let spawnError = null;
  child.on('error', e => { spawnError = e; });
  child.unref();
  const secs = () => Math.round((Date.now() - startedAt) / 1000);
  for (let waited = 0; waited < WAIT_MS; waited += 500) {
    await sleep(500);
    if (spawnError) return { r: 'failed', reason: `runtime could not start (${spawnError.code ?? 'spawn error'})` };
    try { const r = JSON.parse(fs.readFileSync(ready, 'utf8')); if (r.release === id && Date.parse(r.at) >= startedAt - 1000) return { r: 'ready', reason: `window ready after ${secs()} s` }; } catch { /* not yet */ }
    if (child.exitCode !== null) return child.exitCode === ALREADY_RUNNING ? { r: 'busy', reason: 'another instance holds the app' } : { r: 'failed', reason: `exited with code ${child.exitCode} after ${secs()} s` };
  }
  try { process.kill(child.pid); } catch { /* gone */ }
  return { r: 'failed', reason: `window not ready within ${Math.round(WAIT_MS / 1000)} s` };
}

function startSelected(id, rel, ready, snapshot) {
  return withReleaseLock(base, 'launch-start', () => {
    if (JSON.stringify(readState()) !== JSON.stringify(snapshot)) throw new Error('release selection changed during launch');
    // startOnce executes spawn synchronously before its first await; release the mutex before waiting for readiness.
    return { pending: startOnce(id, rel, ready) };
  }).pending;
}

// <base>/launch-result.json: how the last start went, read by the app after it starts (the restart banner:
// the new release started, or the previous one and why). Atomic, never an error if it cannot be written.
function writeResult(result) {
  const f = path.join(base, 'launch-result.json');
  try { fs.writeFileSync(`${f}.tmp`, JSON.stringify(result, null, 2)); } catch { return; /* best effort */ }
  // Windows refuses to replace a file while anyone has it open (EPERM/EBUSY): the starting app reading this file, an
  // antivirus scan. A single try silently lost the 'started' record under load, so retry for a bounded 5 s (a real
  // ACL denial, EACCES, just gives up after it: still best effort). Duplicated from update.mjs renameRetry on purpose:
  // a new named import would break this launcher next to an older installed update.mjs.
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (const until = Date.now() + 5000; ;) {
    try { fs.renameSync(`${f}.tmp`, f); return; } catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code) || Date.now() > until) break;
      Atomics.wait(pause, 0, 0, 20);
    }
  }
  try { fs.unlinkSync(`${f}.tmp`); } catch { /* best effort */ }
}

async function launch() {
  const s = withReleaseLock(base, 'launch-snapshot', () => readState());
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
    // Do not launch a snapshot which another supported writer superseded during a previous await.
    withReleaseLock(base, 'launch-check', () => { if (JSON.stringify(readState()) !== JSON.stringify(s)) throw new Error('release selection changed during launch'); });
    let rel;
    let o;
    try {
      rel = JSON.parse(fs.readFileSync(path.join(releases, id, 'release.json'), 'utf8'));
      if (rel.id !== id || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(rel.electron)) throw new Error('invalid release metadata');
      o = await startSelected(id, rel, ready, s);
    } catch {
      o = { r: 'failed', reason: 'release metadata is missing, invalid or references an invalid engine' };
    }
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
      o = await startSelected(id, rel, ready, s);
    }
    if (o.r === 'ready') { say(`started ${id}`); result.started = id; note(id, 'started', o.reason + waited); return; }
    if (o.r === 'busy') { say(`another instance still holds the app: ${id} not started, not marked bad`); note(id, 'still-quitting', o.reason); return; }
    say(`release ${id} did not start (${o.reason}): marking it bad`);
    withReleaseLock(base, 'launch-mark-bad', lease => {
      const current = readState();
      if (JSON.stringify(current) !== JSON.stringify(s)) throw new Error('release selection changed; stale launcher cannot mark it bad');
      s.bad = [...new Set([...(s.bad ?? []), id])];
      writeState(s, lease);
      s.writerProtocol = RELEASE_WRITER_PROTOCOL;
    });
    note(id, 'bad', o.reason);
  }
  throw new Error('no release could start: run `npm run dev` in the repo and check `npm run logs -- --level error`');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) try {
  if (cmd === 'promote') await promote();
  else if (cmd === 'promote-now') await promote(false, true);
  else if (cmd === 'stage-test') await promote(true);
  else if (cmd === 'install') {
    if (path.resolve(fileURLToPath(import.meta.url)) !== path.resolve(base, 'release.mjs')) throw new Error('install must run from the installed payload, never a checkout');
    withReleaseLock(base, 'install', lease => activate(process.argv[3], lease));
  }
  else if (cmd === 'install-payload') {
    const id = assertReleaseId(process.argv[3]);
    const payload = path.dirname(fileURLToPath(import.meta.url));
    if (path.resolve(path.dirname(payload)) !== path.resolve(base, '.installer') || !/^[a-f0-9]{32}$/.test(path.basename(payload))) throw new Error('installer payload must run from its private staging directory');
    withReleaseLock(base, 'install-payload', lease => {
      const marker = stageInstall(base, payload, process.argv[4], lease);
      if (marker.id !== id) throw new Error('installer release identifier mismatch');
      activate(prepareApply(base, id, process.argv[4], lease), lease);
    });
  }
  else if (cmd === 'stage-update') { const { stageUpdate } = await import('./update.mjs'); say(JSON.stringify(stageUpdate(base, process.argv[3], process.argv[4]))); }
  else if (cmd === 'apply-update') withReleaseLock(base, 'apply-update', lease => {
    const expectedCurrent = assertReleaseId(process.argv[5]);
    const state = readState();
    if (state.writerProtocol !== RELEASE_WRITER_PROTOCOL || state.current !== expectedCurrent) throw new Error('release selection/protocol changed since consent');
    activate(prepareApply(base, process.argv[3], process.argv[4], lease), lease, false);
  });
  else if (cmd === 'rollback') withReleaseLock(base, 'rollback', lease => rollback(undefined, undefined, lease));
  else if (cmd === 'rollback-if') withReleaseLock(base, 'rollback-if', lease => rollback(assertReleaseId(process.argv[3]), assertReleaseId(process.argv[4]), lease, false));
  else if (cmd === 'uninstall-check') {
    const owner = releaseLockInfo(base);
    if (owner?.operation !== 'uninstall' || owner.token !== process.argv[3] || owner.pid !== process.ppid) throw new Error('uninstaller does not own the release writer lock');
    if (readState().writerProtocol !== RELEASE_WRITER_PROTOCOL) throw new Error('legacy installation requires offline migration before managed uninstall');
    const ready = path.join(appData, 'second-brain', 'ready.json');
    let holder;
    try { holder = JSON.parse(fs.readFileSync(ready, 'utf8')).pid; } catch (e) { if (e.code !== 'ENOENT') throw new Error('cannot verify whether the application is closed'); }
    if (holder !== undefined && (!Number.isSafeInteger(holder) || holder <= 0)) throw new Error('invalid application readiness marker; uninstall refused');
    if (holder && alive(holder)) throw new Error('close second-brain before uninstalling; no running instance was stopped');
    // Readiness may not yet exist for a just-spawned app. Probe only Electron image paths; never read command lines.
    const probe = "$ErrorActionPreference='Stop'; $root=[IO.Path]::GetFullPath($env:SB_UNINSTALL_ROOT).TrimEnd([char]92)+[char]92; foreach($p in [Diagnostics.Process]::GetProcessesByName('electron')) { try { if($p.Id -ne [int]$env:SB_UNINSTALL_SELF) { $image=$p.MainModule.FileName; if(!$image) { throw 'Electron image unavailable' }; if($image.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)) { exit 2 } } } finally { $p.Dispose() } }";
    try {
      execFileSync(path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', probe], { windowsHide: true, stdio: 'pipe', timeout: 5000, env: { ...process.env, SB_UNINSTALL_ROOT: path.join(base, 'electron'), SB_UNINSTALL_SELF: String(process.pid) } });
    } catch { throw new Error('cannot establish an idle, complete Electron process census; uninstall refused'); }
  }
  else if (cmd === 'launch') await launch();
  else if (cmd === 'status') { const s = readState(); const { stagedUpdates } = await import('./update.mjs'); console.log(process.argv.includes('--json') ? JSON.stringify({ base, ...s, writerProtocol: RELEASE_WRITER_PROTOCOL, stateProtocol: s.writerProtocol ?? 0, lock: releaseLockInfo(base), staged: stagedUpdates(base) }) : `base ${base}\ncurrent ${s.current ?? '-'}\nprevious ${s.previous ?? '-'}\nbad ${(s.bad ?? []).join(', ') || '-'}`); }
  else { console.error('usage: release.mjs promote|promote-now|rollback|rollback-if <current> <previous>|launch|status|stage-test|install <id>|install-payload <id> <manifest-sha256>|stage-update <payload> <manifest-sha256>|apply-update <id> <manifest-sha256> <current>'); process.exit(3); }
} catch (e) { console.error(`release: ${e.message}`); process.exit(1); }
