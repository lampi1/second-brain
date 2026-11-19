// Ten minutes of idle in the hidden native app, run by dev-visual-smoke on a PR: the main process must start no child
// process and never stall its timers, the renderer must stay under 1% of long tasks. No input, no turns, no providers.
import fs from 'node:fs/promises';
import path from 'node:path';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

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
    const main = await app.evaluate(() => ({ stalls: globalThis.__idlePerformance.events.length, maxDelayMs: globalThis.__idlePerformance.maximum(), processStarts: globalThis.__idlePerformance.spawns.length }));
    const renderer = await page.evaluate(() => ({ longTaskMs: globalThis.__idlePerformance.entries.reduce((n, e) => n + e.durationMs, 0), visibility: globalThis.__idlePerformance.visibility }));
    const line = { at: new Date().toISOString(), minute, ...main, ...renderer }; minutes.push(line); console.log(`idle performance ${JSON.stringify(line)}`);
  }
  const main = await app.evaluate(() => { const p = globalThis.__idlePerformance; p.stop(); return { stalls: p.events, processStarts: p.spawns }; });
  const renderer = await page.evaluate(() => { const p = globalThis.__idlePerformance; p.observer.disconnect(); return p.entries; });
  const result = { environment: 'Hidden Electron on CI, synthetic product brain and usage ledger; wiring read-only pollers enabled; paid jobs, personal probes and engine sweeper disabled; no input or turns', samplingIntervalMs: 10, stallDelayThresholdMs: 90, processCoverage: 'Successful asynchronous Node child launches by main; excludes synchronous launches, Chromium/utility processes and grandchildren', startedAt, endedAt: new Date().toISOString(), minutes, ...main, rendererLongTasks: renderer };
  await fs.writeFile(path.join(output, 'idle-performance.json'), JSON.stringify(result, null, 2));
  if (main.processStarts.length) throw new Error(`Idle main launched ${main.processStarts.length} child processes; see idle-performance.json`);
  if (result.stalls.length) throw new Error('Main timer delay reached 90ms during the 10ms-cadence idle trace');
  if (renderer.reduce((sum, entry) => sum + entry.durationMs, 0) > 6000) throw new Error('Renderer long tasks exceeded 1% of the idle trace');
  return result;
}
