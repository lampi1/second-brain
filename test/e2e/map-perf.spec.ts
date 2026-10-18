// Performance of the 3D brain map, measured on the real app (frozen demo + the synthetic brain of
// test/fixtures/brain-ui): time to the first drawn frame, frames per second while the layout settles, while idle (no
// one touching it: it must draw nothing), while dragged (it must stay fluid), and the CPU of the app's processes
// (renderer + GPU) idle with the map open vs closed. Frames are counted by wrapping the WebGL draw calls (one frame =
// a burst of draw calls), so the numbers do not depend on the engine's own code. The numbers go to
// test-results/map-perf.json and the console (before/after in the commit and the report). At rest the map draws not
// one frame (engine.ts owns the loop and stops it, ADR 0039); reopened, it shows the remembered picture and rests again
// at once (no warm-up, no camera flight). Screenshot brain-map-rest.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, setSize, shot } from './helpers';

const FIX = path.resolve(import.meta.dirname, '..', 'fixtures', 'brain-ui');
function fixtureBrain(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-mapperf-'));
  fs.mkdirSync(path.join(d, 'ops', 'tools'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'brain-site.mjs'), path.join(d, 'ops', 'tools', 'brain-site.mjs'));
  fs.copyFileSync(path.join(FIX, 'data.mjs'), path.join(d, 'ops', 'tools', 'brain-ui-data.mjs'));
  return d;
}

let app: ElectronApplication, page: Page;
test.beforeAll(async () => {
  ({ app, page } = await launch({ SB_DEMO: '1', SB_DEMO_FREEZE: '1', SB_BRAIN: fixtureBrain() }));
  await setSize(app, 1600, 1000);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.getByTestId('regia-overlay')).toBeVisible();
});
test.afterAll(async () => { await app?.close(); });

type W = { __draws: number; __frames: number; __last: number };
const frames = () => page.evaluate(() => (window as unknown as W).__frames);
/** average CPU % of the app's processes since the previous call, by process type */
const cpu = () => app.evaluate(({ app: a }) => {
  const out: Record<string, number> = {};
  for (const m of a.getAppMetrics()) out[m.type] = Math.round(((out[m.type] ?? 0) + m.cpu.percentCPUUsage) * 10) / 10;
  return out;
});
const pause = (ms: number) => page.waitForTimeout(ms);
async function rate(ms: number): Promise<number> {
  const a = await frames();
  await pause(ms);
  return Math.round(((await frames()) - a) / (ms / 1000) * 10) / 10;
}

test('the 3D map: fast first frame, nothing drawn while idle, fluid while dragged', async () => {
  test.setTimeout(120_000);
  await page.evaluate(() => {
    const w = window as unknown as W;
    w.__draws = 0; w.__frames = 0; w.__last = 0;
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      const ctx = (orig as (...a: unknown[]) => unknown).call(this, type, ...rest) as Record<string, unknown> | null;
      if (ctx && /webgl/.test(type) && !ctx.__counted) {
        ctx.__counted = true;
        for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
          const o = ctx[f] as ((...a: unknown[]) => unknown) | undefined;
          if (!o) continue;
          ctx[f] = (...a: unknown[]) => { const t = performance.now(); if (t - w.__last > 5) w.__frames++; w.__last = t; w.__draws++; return o.apply(ctx, a); };
        }
      }
      return ctx;
    } as typeof orig;
  });
  // the structure alone: the demo's chats at work would light the live map (its cost: map-live.spec.ts)
  await page.evaluate(() => localStorage.setItem('sb.map.live', '0'));
  await cpu();
  await pause(4000);
  const closedCpu = await cpu(); // the app with the map closed, as a baseline

  const t0 = Date.now();
  await page.getByTestId('nav-dashboard').click();
    await page.getByRole('tab', { name: 'Mappa brain' }).click();
    await page.getByRole('button', { name: 'Esplora in 3D' }).click();
  await expect(page.getByTestId('bx-map-canvas').locator('canvas')).toHaveCount(1, { timeout: 30_000 });
  await expect.poll(frames, { timeout: 30_000, intervals: [16] }).toBeGreaterThan(0);
  const firstFrameMs = Date.now() - t0;
  const startFps = await rate(3000);

  await pause(9000); // the layout settles and the camera lands
  await cpu();
  const idleFps = await rate(5000);
  const idleCpu = await cpu();
  await shot(page, 'brain-map-rest');

  const box = (await page.getByTestId('bx-map-canvas').boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const f0 = await frames();
  const d0 = Date.now();
  for (let i = 0; i < 40; i++) { await page.mouse.move(cx + Math.sin(i / 6) * 160, cy + Math.cos(i / 6) * 60); await pause(25); }
  const dragFps = Math.round(((await frames()) - f0) / ((Date.now() - d0) / 1000) * 10) / 10;
  await page.mouse.up();
  await pause(3000); // the orbit's damping ends
  await cpu();
  const afterDragIdleFps = await rate(3000);

  // the window minimized: nothing drawn
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.minimize());
  await pause(800);
  const minimizedFps = await rate(3000);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w?.restore(); w?.showInactive(); });
  await pause(1500);

  // closed and opened again: the settled layout is remembered, no warm-up
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('brain-map')).toHaveCount(0);
  await pause(1000);
  const before = await frames();
  const t1 = Date.now();
  await page.getByTestId('nav-dashboard').click();
    await page.getByRole('tab', { name: 'Mappa brain' }).click();
    await page.getByRole('button', { name: 'Esplora in 3D' }).click();
  await expect.poll(async () => (await frames()) > before, { timeout: 30_000, intervals: [16] }).toBe(true);
  const reopenFirstFrameMs = Date.now() - t1;
  await pause(2500);
  const reopenIdleFps = await rate(2000); // the remembered picture: nothing left to settle or to fly to

  const res = { firstFrameMs, reopenFirstFrameMs, startFps, idleFps, dragFps, afterDragIdleFps, minimizedFps, reopenIdleFps, cpu: { closed: closedCpu, idleOpen: idleCpu } };
  fs.mkdirSync(path.resolve('test-results'), { recursive: true });
  fs.writeFileSync(path.resolve('test-results', 'map-perf.json'), JSON.stringify(res, null, 2));
  console.log(`map-perf ${JSON.stringify(res)}`);

  expect(firstFrameMs).toBeLessThan(5000);
  expect(dragFps).toBeGreaterThan(20);
  expect(idleFps).toBe(0);
  expect(afterDragIdleFps).toBe(0);
  expect(reopenIdleFps).toBe(0);
  expect(minimizedFps).toBeLessThan(1);
  expect(reopenFirstFrameMs).toBeLessThan(firstFrameMs + 500);
});
