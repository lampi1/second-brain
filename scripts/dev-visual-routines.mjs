// Hidden native-app proof of CLI-only routines (ADR 0179), run by dev-visual-smoke on a PR. The separate terminal
// process runs the actual CLI with a token-free Claude stand-in and the real browser MCP. No app executor or mock IPC.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { once } from 'node:events';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await pause(50); }
  throw new Error(`Routine visual timeout: ${label}`);
}

/** Installs read/watch instrumentation in the main process; does not create routine reads or timers. */
export async function startRoutineTrace(app, roots) {
  await app.evaluate(async ({ app }, roots) => {
    const fs = process.getBuiltinModule('fs'), promises = fs.promises, path = process.getBuiltinModule('path');
    const events = [], watches = new Set(), restores = [];
    const match = value => typeof value === 'string' && roots.some(root => { const rel = path.relative(root, value); return rel === '' || !rel.startsWith('..') && !path.isAbsolute(rel); });
    for (const target of [fs, promises]) for (const method of ['readFileSync', 'readFile', 'readdirSync', 'readdir', 'open', 'openSync', 'stat', 'statSync', 'lstat', 'lstatSync', 'access', 'accessSync', 'existsSync', 'readlink', 'readlinkSync', 'realpath', 'realpathSync', 'watch']) {
      if (typeof target[method] !== 'function') continue;
      const original = target[method];
      target[method] = function (...args) {
        const routine = match(args[0]);
        if (routine) events.push({ at: Date.now(), method, path: args[0] });
        const result = Reflect.apply(original, this, args);
        if (routine && method === 'watch' && result?.close) {
          watches.add(result); result.once('close', () => watches.delete(result));
        }
        return result;
      };
      // localFile uses realpathSync.native. Preserve its API and include that route in the trace.
      Object.assign(target[method], original);
      if (typeof original.native === 'function') target[method].native = function (...args) {
        if (match(args[0])) events.push({ at: Date.now(), method: `${method}.native`, path: args[0] });
        return Reflect.apply(original.native, this, args);
      };
      restores.push(() => { target[method] = original; });
    }
    const sync = () => process.getBuiltinModule('module').syncBuiltinESMExports();
    sync(); // Main is ESM: named fs imports must observe the wrappers as well as the default object.
    globalThis.__routineTrace = { events, watches, reset: () => { events.length = 0; }, stop: () => { restores.forEach(fn => fn()); sync(); } };
    // Contents only for diagnostics: production code does not depend on this capture-only global.
    globalThis.__routineTrace.profile = app.getPath('userData');
  }, roots);
}
export async function idleRoutineTrace(app, label, seconds = 15) {
  await app.evaluate(() => globalThis.__routineTrace.reset());
  const at = Date.now(); await pause(seconds * 1000);
  const trace = await app.evaluate(() => ({ events: globalThis.__routineTrace.events, activeWatches: globalThis.__routineTrace.watches.size }));
  if (trace.events.length || trace.activeWatches) throw new Error(`${label}: routine IO continues with its page closed: ${JSON.stringify(trace)}`);
  return { label, durationMs: Date.now() - at, ...trace };
}

/** Ten minutes of real idle UI/main activity, independent of whether any keys were typed. */
export async function captureIdlePerformance(app, page, output) {
  await app.evaluate(() => {
    const events = [], spawns = [], cp = process.getBuiltinModule('child_process');
    let previous = performance.now(), maximum = 0;
    const timer = setInterval(() => {
      const now = performance.now(), late = Math.max(0, now - previous - 10); previous = now;
      maximum = Math.max(maximum, late);
      if (late >= 90) events.push({ at: new Date().toISOString(), lateMs: late });
    }, 10); // A >100ms task implies >=90ms delay at this cadence, independent of its start phase.
    // Observe the underlying launch, including ESM imports and promisifiers captured before this trace.
    // Leave spawn/execFile APIs untouched (especially execFile's {stdout, stderr} and promise.child contract).
    const original = cp.ChildProcess.prototype.spawn;
    cp.ChildProcess.prototype.spawn = function (...args) {
      const result = Reflect.apply(original, this, args);
      if (this.pid) spawns.push({ at: new Date().toISOString(), pid: this.pid, executable: String(args[0]?.file), args: args[0]?.args?.slice(1) });
      return result;
    };
    globalThis.__idlePerformance = { events, spawns, maximum: () => maximum, stop: () => { clearInterval(timer); cp.ChildProcess.prototype.spawn = original; } };
    globalThis.__routineTrace.reset();
  });
  await page.evaluate(() => {
    const entries = [];
    const observer = new PerformanceObserver(list => entries.push(...list.getEntries().map(e => ({ at: performance.timeOrigin + e.startTime, durationMs: e.duration }))));
    observer.observe({ type: 'longtask', buffered: false });
    globalThis.__idlePerformance = { entries, visibility: document.visibilityState, observer };
  });
  const startedAt = new Date().toISOString(), minutes = [];
  for (let minute = 1; minute <= 10; minute++) {
    await pause(60_000);
    const main = await app.evaluate(() => ({ stalls: globalThis.__idlePerformance.events.length, maxDelayMs: globalThis.__idlePerformance.maximum(), processStarts: globalThis.__idlePerformance.spawns.length, routineReads: globalThis.__routineTrace.events.length, routineWatches: globalThis.__routineTrace.watches.size }));
    const renderer = await page.evaluate(() => ({ longTaskMs: globalThis.__idlePerformance.entries.reduce((n, e) => n + e.durationMs, 0), visibility: globalThis.__idlePerformance.visibility }));
    const line = { at: new Date().toISOString(), minute, ...main, ...renderer }; minutes.push(line); console.log(`idle performance ${JSON.stringify(line)}`);
  }
  const main = await app.evaluate(() => { const p = globalThis.__idlePerformance; p.stop(); return { stalls: p.events, processStarts: p.spawns }; });
  const renderer = await page.evaluate(() => { const p = globalThis.__idlePerformance; p.observer.disconnect(); return p.entries; });
  const result = { environment: 'Hidden Electron on CI, synthetic product brain and usage ledger; wiring read-only pollers enabled; paid jobs, personal probes and engine sweeper disabled; no input or turns', samplingIntervalMs: 10, stallDelayThresholdMs: 90, processCoverage: 'Successful asynchronous Node child launches by main; excludes synchronous launches, Chromium/utility processes and grandchildren', startedAt, endedAt: new Date().toISOString(), minutes, ...main, rendererLongTasks: renderer };
  await fs.writeFile(path.join(output, 'idle-performance.json'), JSON.stringify(result, null, 2));
  if (minutes.some(m => m.routineReads || m.routineWatches)) throw new Error('Routine background IO during idle trace');
  if (result.stalls.length) throw new Error('Main timer delay reached 90ms during the 10ms-cadence idle trace');
  if (renderer.reduce((sum, entry) => sum + entry.durationMs, 0) > 6000) throw new Error('Renderer long tasks exceeded 1% of the idle trace');
  return result;
}

export async function captureTerminalRoutine({ app, page, capture, root, profile, runs, output, manifest }) {
  const control = path.join(profile, 'visual-control'), pkg = path.join(profile, 'visual-package');
  await fs.mkdir(control, { recursive: true }); await fs.mkdir(pkg, { recursive: true });
  const web = http.createServer((req, res) => {
    const after = req.url?.startsWith('/after'), revised = req.url === '/after-revised';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="it"><style>body{font:24px system-ui;padding:70px;background:#edf2fa;color:#18324d;min-height:5000px}article{background:white;padding:45px;border-radius:16px;max-width:900px}h1{font-size:42px}.state{padding:25px;border-radius:10px;background:${after ? '#d6f2df' : '#ffe0db'}}</style><article><p>VERIFICA SINTETICA · CLI REALE</p><h1>Vista live delle routine</h1><div class="state">${revised ? 'Dopo · seconda acquisizione nello stesso file' : after ? 'Dopo · modifica verificata' : 'Prima · problema riprodotto'}</div><p>Screenshot acquisito dal browser del runtime, senza servizi esterni.</p></article></html>`);
  });
  web.listen(0, '127.0.0.1'); await once(web, 'listening');
  const origin = `http://127.0.0.1:${web.address().port}`;
  await fs.writeFile(path.join(pkg, 'routine.json'), JSON.stringify({ format: 'second-brain-routine', schemaVersion: 1,
    routine: { id: 'live-observer', title: 'Verifica CLI · vista live', description: 'Run sintetica del CLI reale', inputs: [],
      browser: { origins: [origin] }, steps: [
        { id: 'capture', title: 'Confronta prima e dopo', prompt: 'Acquisisci le schermate della verifica sintetica.', browser: true, allowedTools: ['mcp__routine-browser__*'] },
        { id: 'report', title: 'Scrivi il rapporto', prompt: 'Concludi la verifica sintetica.' },
      ] } }));
  const entry = path.join(root, 'test-results/visual-routine-cli.mjs');
  await build({ stdin: { contents: `import { main } from './packages/routine-runtime/src/cli'; import { createClaudeEngine } from './packages/routine-runtime/src/claude';
process.exitCode = await main(process.argv.slice(2), { engine: () => createClaudeEngine({ command: (args, env) => ({command: process.execPath, args: [${JSON.stringify(path.join(root, 'test/fixtures/routine-observer-engine.mjs'))}, ...args], env}) }), mcp: kind => ({command: process.execPath, args: [${JSON.stringify(path.join(root, 'packages/routine-runtime/dist/routine-mcp.mjs'))}, kind]}) });`, resolveDir: root, sourcefile: 'visual-cli.ts' },
    outfile: entry, bundle: true, platform: 'node', target: 'node22', format: 'esm', external: ['playwright-core'],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
  const child = spawn(process.execPath, [entry, 'run', pkg, '--runs-dir', runs], { cwd: root,
    env: { ...process.env, ROUTINE_VISUAL_CONTROL: control, ROUTINE_VISUAL_ORIGIN: origin }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
  const ended = once(child, 'exit');
  try {
    const runId = await until(async () => (await fs.readdir(path.join(runs, 'live-observer')).catch(() => [])).find(name => !name.startsWith('.')), 'CLI run created');
    const dir = path.join(runs, 'live-observer', runId);
    await until(async () => fs.stat(path.join(dir, 'run.json')).then(() => true, () => false), 'run.json');
    await page.getByTestId('nav-flussi').click();
    await page.getByTestId(`routine-run-${runId}`).click();
    await page.getByTestId('routine-run-view').waitFor();
    const stage = async (gate, file) => {
      const shot = page.getByRole('img', { name: file, exact: true }).first();
      const previous = await shot.count() ? await shot.getAttribute('src') : null;
      const sentAt = Date.now();
      await fs.writeFile(path.join(control, gate), 'go');
      const screenshot = await until(async () => {
        const events = (await fs.readFile(path.join(dir, 'events.jsonl'), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
        return events.findLast(e => e.type === 'screenshot' && path.basename(e.path) === file && (!previous || e.at >= sentAt));
      }, `${file} emitted`, 30_000);
      await page.getByRole('img', { name: file, exact: true }).first().waitFor();
      await page.waitForFunction(({ name, previous }) => [...document.querySelectorAll('.rs-gallery img')].some(img => img.alt === name && img.naturalHeight > 4096 && img.src !== previous), { name: file, previous });
      const latencyMs = Date.now() - screenshot.at;
      if (latencyMs > 5000) throw new Error(`Screenshot took ${latencyMs}ms to appear`);
      return { screenshot: file, emittedAt: screenshot.at, visibleLatencyMs: latencyMs };
    };
    manifest.routineLive = { cli: 'real main(run), real browser MCP, synthetic token-free Claude stand-in', shots: [] };
    manifest.routineLive.shots.push(await stage('start', 'before.png'));
    await capture('routine-cli-live-before');
    manifest.routineLive.shots.push(await stage('after', 'after.png'));
    const pair = page.getByTestId('run-shot-pair'); await pair.waitFor(); await pair.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="run-shot-pair"] img')].filter(img => img.naturalWidth > 0).length === 2);
    await capture('routine-cli-live-pair');
    await pair.locator('button[title="after.png"]').click();
    await page.getByTestId('cited-file-viewer').locator('img').waitFor();
    await page.waitForFunction(() => { const img = document.querySelector('.viewer-image-open.is-wide img'); return img?.naturalWidth > 0 && img.getBoundingClientRect().width > 600; });
    await capture('routine-cli-enlarged');
    await page.getByTestId('viewer-close').click();
    manifest.routineLive.shots.push(await stage('overwrite', 'after.png'));
    await capture('routine-cli-overwritten-shot');
    await fs.writeFile(path.join(control, 'next'), 'go');
    await page.getByTestId('run-current-step').filter({ hasText: 'Scrivi il rapporto' }).waitFor();
    await page.getByTestId('run-last-action').filter({ hasText: 'Secondo passo dal terminale' }).waitFor();
    await page.locator('.rs-run-head').scrollIntoViewIfNeeded();
    await capture('routine-cli-live-step-two');
    await fs.writeFile(path.join(control, 'finish'), 'go');
    const [code] = await ended; if (code !== 0) throw new Error(`CLI failed (${code}): ${log}`);
    await page.locator('[data-testid="routine-run-view"][data-status="done"]').waitFor();
    await page.getByTestId('run-report').waitFor(); await page.locator('.rs-run-head').scrollIntoViewIfNeeded(); await capture('routine-cli-complete');
    await page.getByTestId('run-report').click();
    await page.getByTestId('viewer-markdown').getByRole('heading', { name: '1. Confronta prima e dopo (done)', exact: true }).waitFor();
    await capture('routine-cli-report'); await page.getByTestId('viewer-close').click();
    await page.getByTestId('nav-home').click();
    manifest.routineClosed = await idleRoutineTrace(app, 'after closing live view');
    await page.getByTestId('nav-flussi').click(); await page.getByTestId(`routine-run-${runId}`).click();
    await page.getByTestId('run-shot-pair').waitFor();
    await page.getByTestId('run-shot-pair').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="run-shot-pair"] img')].filter(img => img.naturalWidth > 0).length === 2);
    await capture('routine-cli-reopened-history');
    manifest.routineLive.historyScreenshots = 2;
    const recorded = path.join(output, 'recorded-cli-run');
    await fs.mkdir(recorded, { recursive: true });
    for (const file of ['run.json', 'events.jsonl', 'report.md', 'steps']) await fs.cp(path.join(dir, file), path.join(recorded, file), { recursive: true });
    await page.getByTestId('nav-home').click();
  } finally {
    child.kill(); await fs.writeFile(path.join(output, 'routine-cli.log'), log); web.close(); await fs.rm(entry, { force: true });
  }
}
