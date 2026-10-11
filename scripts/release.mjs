// Stable releases of the app (ADR 0007): the cockpit the user works in runs from a frozen copy outside the repo, so chats
// can develop, break and restart the dev build without touching it.
//   node scripts/release.mjs promote [--skip-check]   npm run check must be green (skip only for tests of this script),
//                                                      then build → copy out/ + package.json to releases/<ver>-<sha>/,
//                                                      share the Electron runtime, switch current.json, write launch.cmd
//   node scripts/release.mjs rollback                 current ⇄ previous
//   node scripts/release.mjs status [--json]           what is current/previous, where the launcher is
//   node scripts/release.mjs launch                    (used by launch.cmd) start current; if its window does not report
//                                                      ready within 30 s, mark it bad and start the previous release
// Root: %LOCALAPPDATA%/second-brain (SB_RELEASES_ROOT overrides, for tests). Runs with plain Node or Electron-as-Node.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.SB_RELEASES_ROOT ?? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), '.local', 'share'), 'second-brain');
const releases = path.join(base, 'releases');
const statePath = path.join(base, 'current.json');
const readState = () => { try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return { current: null, previous: null, bad: [], history: [] }; } };
const writeState = s => { fs.mkdirSync(base, { recursive: true }); fs.writeFileSync(statePath, JSON.stringify(s, null, 2)); };
const say = m => console.log(m);
const cmd = process.argv[2];

function electronFor(version) { return path.join(base, 'electron', version, process.platform === 'win32' ? 'electron.exe' : 'electron'); }

async function promote() {
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
  const sha = execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  if (dirty && !process.argv.includes('--allow-dirty')) throw new Error('the repo has uncommitted changes: commit them first (a release must match a commit)');
  if (!process.argv.includes('--skip-check')) {
    say('npm run check …');
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'check'], { cwd: repo, stdio: 'inherit', shell: process.platform === 'win32' });
  }
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
    fs.cpSync(path.join(repo, 'node_modules', 'electron', 'dist'), path.dirname(electronFor(ev)), { recursive: true });
  }
  // the embedded Claude engine (ADR 0010): copied once per version next to the shared Electron runtime
  let claudeEngine = null;
  const enginePkg = path.join(repo, 'node_modules', '@anthropic-ai', 'claude-agent-sdk-win32-x64');
  if (fs.existsSync(path.join(enginePkg, 'claude.exe'))) {
    const cv = JSON.parse(fs.readFileSync(path.join(enginePkg, 'package.json'), 'utf8')).version;
    claudeEngine = path.join(base, 'engines', 'claude', cv, 'claude.exe');
    if (!fs.existsSync(claudeEngine)) {
      say(`sharing Claude engine ${cv} …`);
      fs.mkdirSync(path.dirname(claudeEngine), { recursive: true });
      fs.copyFileSync(path.join(enginePkg, 'claude.exe'), claudeEngine);
    }
  }
  // cookies of the browser environments encrypted at rest (DPAPI-protected key), never plaintext on disk (ADR 0003)
  // loaded here, not at the top: the launcher copy of this script (next to launch.cmd) runs without fuses.mjs
  const { ensureCookieEncryption } = await import('./fuses.mjs');
  try { say(`cookie encryption: ${ensureCookieEncryption(electronFor(ev))}`); } catch (e) { say(`WARNING cookie encryption not enabled: ${e.message}`); }
  fs.writeFileSync(path.join(dest, 'release.json'), JSON.stringify({ id, version: pkg.version, sha, electron: ev, claudeEngine, at: new Date().toISOString() }, null, 2));
  const s = readState();
  if (s.current !== id) { s.previous = s.current; s.current = id; }
  s.bad = (s.bad ?? []).filter(b => b !== id);
  s.history = [...(s.history ?? []), { id, at: new Date().toISOString() }].slice(-20);
  writeState(s);
  writeLauncher();
  // keep the last 5 releases
  const keep = new Set([s.current, s.previous, ...s.history.slice(-5).map(h => h.id)]);
  for (const d of fs.readdirSync(releases)) if (!keep.has(d)) fs.rmSync(path.join(releases, d), { recursive: true, force: true });
  say(`promoted ${id} (previous: ${s.previous ?? 'none'}) · start it with ${path.join(base, 'launch.cmd')}`);
  startSync(id);
}

// After a successful promotion: the GitHub sync of the product (built by a brain-side chat:
// export + data/secret check + push) runs in the background and never blocks the promotion. Configured in
// <base>/sync.json {"command": "<exe>", "args": ["…"], "cwd": "…"}; its outcome lands in <base>/sync/<release>.json
// {release, startedAt, endedAt, exitCode, ok, blocked, summary} and the stable app shows it as a notification.
function startSync(id) {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(path.join(base, 'sync.json'), 'utf8')); } catch { return; }
  if (!cfg?.command) return;
  const dir = path.join(base, 'sync');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${id}.json`);
  const startedAt = new Date().toISOString();
  fs.writeFileSync(out, JSON.stringify({ release: id, startedAt, running: true }));
  // a detached Node-ish runner keeps going after this script exits and records the outcome
  const runner = `const {spawn}=require('node:child_process');const fs=require('node:fs');const c=JSON.parse(process.argv[1]);let log='';` +
    `const p=spawn(c.command,c.args||[],{cwd:c.cwd||undefined,windowsHide:true,env:{...process.env,SB_RELEASE_ID:c.id}});` +
    `p.stdout.on('data',d=>{log+=d});p.stderr.on('data',d=>{log+=d});` +
    `p.on('close',code=>{const tail=log.trim().split(/\\r?\\n/).slice(-6).join('\\n');fs.writeFileSync(c.out,JSON.stringify({release:c.id,startedAt:c.startedAt,endedAt:new Date().toISOString(),exitCode:code,ok:code===0,blocked:code===2,summary:tail}))});` +
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
  fs.writeFileSync(path.join(base, 'launch.cmd'), `@echo off\r\nrem second-brain stable launcher (scripts/release.mjs). Starts the current release, falls back to the previous one.\r\nset ELECTRON_RUN_AS_NODE=1\r\nstart "" /b "${electronFor(rel.electron)}" "%~dp0release.mjs" launch\r\n`);
  // launch.vbs runs launch.cmd without a console window: the Start-menu and desktop shortcuts point here (the stable
  // app writes them itself, with its AppUserModelId, so Windows shows its notifications)
  fs.writeFileSync(path.join(base, 'launch.vbs'), `' second-brain: starts launch.cmd hidden\r\nCreateObject("WScript.Shell").Run """" & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\\launch.cmd""", 0, False\r\n`);
}

function rollback() {
  const s = readState();
  if (!s.previous) throw new Error('no previous release to go back to');
  [s.current, s.previous] = [s.previous, s.current];
  writeState(s);
  writeLauncher();
  say(`current is now ${s.current} (previous: ${s.previous})`);
}

async function launch() {
  const s = readState();
  const order = [s.current, s.previous].filter(id => id && !(s.bad ?? []).includes(id));
  for (const id of order) {
    const rel = JSON.parse(fs.readFileSync(path.join(releases, id, 'release.json'), 'utf8'));
    const userData = process.env.SB_USER_DATA ?? path.join(process.env.APPDATA ?? path.join(os.homedir(), '.config'), 'second-brain');
    const ready = path.join(userData, 'ready.json');
    const startedAt = Date.now();
    const env = { ...process.env, SB_RELEASE: id, ...(rel.claudeEngine ? { SB_ENGINE_CLAUDE: rel.claudeEngine } : {}) };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electronFor(rel.electron), [path.join(releases, id)], { env, detached: true, stdio: 'ignore' });
    child.unref();
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 500));
      try { const r = JSON.parse(fs.readFileSync(ready, 'utf8')); if (r.release === id && Date.parse(r.at) >= startedAt - 1000) { say(`started ${id}`); return; } } catch { /* not yet */ }
      if (child.exitCode !== null) break;
    }
    say(`release ${id} did not start: marking it bad`);
    try { process.kill(child.pid); } catch { /* gone */ }
    s.bad = [...new Set([...(s.bad ?? []), id])];
    writeState(s);
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
