// End-to-end: the live brain map in the real app (frozen demo + the synthetic brain of test/fixtures/brain-ui). The
// demo's chats work (two running, the Regia waiting); a test hook (__sbDemo.tool) makes them read a brain file and
// send a message: the legend lists the chats at work and opens one, the lit pieces carry "Adesso" with the chats to
// open, a live chat's neuron opens its chat, the switch turns the live map off. Also measures what the live map costs
// (engine.ts, ADR 0039): with chats at work it animates on requestAnimationFrame (about 30 frames a second while the
// window has no focus, the display rate with focus; both set by stubbing document.hasFocus, the hidden test window's
// own answer is not reliable), with
// the p50/p95 of the time between frames and of the main-thread work per frame; minimized or with the live map off it
// draws nothing. Numbers in test-results/map-live-perf.json. Screenshot brain-map-live.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, setSize, shot } from './helpers';

const FIX = path.resolve(import.meta.dirname, '..', 'fixtures', 'brain-ui');
function fixtureBrain(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-maplive-'));
  fs.mkdirSync(path.join(d, 'ops', 'tools'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'brain-site.mjs'), path.join(d, 'ops', 'tools', 'brain-site.mjs'));
  fs.copyFileSync(path.join(FIX, 'data.mjs'), path.join(d, 'ops', 'tools', 'brain-ui-data.mjs'));
  return d;
}

type Tool = { id: string; name: string; input: unknown; summary?: string; status?: 'running' | 'ok' | 'error' };
type W = { __frames: number; __last: number; __at: number[]; __work: Map<number, number> };
let app: ElectronApplication, page: Page;
const tool = (chatId: string, t: Tool) => app.evaluate((_e, [c, x]) => (globalThis as unknown as { __sbDemo: { tool(c: string, t: Tool): void } }).__sbDemo.tool(c, x), [chatId, t] as const);
const frames = () => page.evaluate(() => (window as unknown as W).__frames);
const cpu = () => app.evaluate(({ app: a }) => {
  const out: Record<string, number> = {};
  for (const m of a.getAppMetrics()) out[m.type] = Math.round(((out[m.type] ?? 0) + m.cpu.percentCPUUsage) * 10) / 10;
  return out;
});
/** p50/p95 of the time between drawn frames and of the main-thread work per frame, over the next `ms` */
async function frameTimes(ms: number) {
  await page.evaluate(() => { const w = window as unknown as W; w.__at = []; w.__work = new Map(); });
  await page.waitForTimeout(ms);
  return page.evaluate(() => {
    const w = window as unknown as W;
    const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]! * 100) / 100 : 0; };
    const gaps = w.__at.slice(1).map((t, i) => t - w.__at[i]!), work = [...w.__work.values()];
    return { frames: w.__at.length, intervalP50: q(gaps, 0.5), intervalP95: q(gaps, 0.95), workP50: q(work, 0.5), workP95: q(work, 0.95) };
  });
}
async function rate(ms: number): Promise<number> {
  const a = await frames();
  await page.waitForTimeout(ms);
  return Math.round(((await frames()) - a) / (ms / 1000) * 10) / 10;
}
const openMap = async () => {
  await page.getByTestId('nav-map').click();
  await expect(page.getByTestId('brain-map')).toBeVisible();
};

test.beforeAll(async () => {
  ({ app, page } = await launch({ SB_DEMO: '1', SB_DEMO_FREEZE: '1', SB_BRAIN: fixtureBrain() }));
  await setSize(app, 1600, 1000);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.getByTestId('regia-pill')).toBeVisible();
  // the frames the map draws (a burst of WebGL draw calls = one frame), as in map-perf.spec.ts
  await page.evaluate(() => {
    const w = window as unknown as W;
    w.__frames = 0; w.__last = 0; w.__at = []; w.__work = new Map();
    // the main-thread work of each display frame: every requestAnimationFrame callback, summed by frame
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => raf(ts => { const a = performance.now(); try { cb(ts); } finally { w.__work.set(ts, (w.__work.get(ts) ?? 0) + performance.now() - a); } });
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      const ctx = (orig as (...a: unknown[]) => unknown).call(this, type, ...rest) as Record<string, unknown> | null;
      if (ctx && /webgl/.test(type) && !ctx.__counted) {
        ctx.__counted = true;
        for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
          const o = ctx[f] as ((...a: unknown[]) => unknown) | undefined;
          if (o) ctx[f] = (...a: unknown[]) => { const t = performance.now(); if (t - w.__last > 5) { w.__frames++; w.__at.push(t); } w.__last = t; return o.apply(ctx, a); };
        }
      }
      return ctx;
    } as typeof orig;
  });
  // what the chats do now: Fix reads the brain's now.md and calls the reviewer, the Regia writes to App · Feedback
  await tool('fix', { id: 'live-read', name: 'Read', input: { file_path: 'C:\\brains\\demo\\now.md' }, summary: 'now.md' });
  await tool('fix', { id: 'live-agent', name: 'Agent', input: { subagent_type: 'reviewer' }, summary: 'reviewer' });
  await tool('regia', { id: 'live-send', name: 'mcp__second-brain-app__app_send_to_chat', input: { chatId: 'feedback', text: 'vai' }, summary: 'a App · Feedback' });
  await tool('fix', { id: 'live-out', name: 'Read', input: { file_path: 'C:/progetti/alfa-shop/Order.cs' }, summary: 'Order.cs' });
});
test.afterAll(async () => { await app?.close(); });

test('the live map: legend of the chats at work, lit pieces with "Adesso", a click opens the chat, off switch; pulse cost', async () => {
  test.setTimeout(120_000);
  await openMap();
  const m = page.getByTestId('brain-map');
  const legend = m.getByTestId('bx-map-live');
  await expect(legend).toContainText('Al lavoro adesso');
  await expect(legend).toContainText('Fix totale ordine');
  await expect(legend).toContainText('Bug notifiche SMS');
  await expect(legend).toContainText('Regia');
  await expect(legend).toContainText(/\d+ chat · 1 file · \d+ strument/); // now.md only: the code repo's file is not a neuron
  await expect(m.getByTestId('bx-map-canvas').locator('canvas')).toHaveCount(1, { timeout: 30_000 });
  await page.waitForTimeout(4000); // the layout settles, the live neurons find their place
  await shot(page, 'brain-map-live');

  // what the live map costs: chats at work → animated at ~30 fps without focus, at display rate with focus; the live
  // map off → nothing drawn
  await page.waitForTimeout(3000);
  await page.evaluate(() => { (document as unknown as { hasFocus: () => boolean }).hasFocus = () => false; });
  await cpu();
  const liveFps = await rate(4000);
  const liveCpu = await cpu();
  const liveFrames = await frameTimes(4000);
  await page.evaluate(() => { (document as unknown as { hasFocus: () => boolean }).hasFocus = () => true; });
  await cpu();
  const focusedFps = await rate(3000);
  const focusedCpu = await cpu();
  const focusedFrames = await frameTimes(4000);
  await page.evaluate(() => { delete (document as unknown as { hasFocus?: unknown }).hasFocus; });
  // the window minimized: no display frames, so no pulse
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.minimize());
  await page.waitForTimeout(800);
  const minimizedFps = await rate(3000);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w?.restore(); w?.showInactive(); });
  await page.waitForTimeout(1000);
  await m.getByTestId('bx-map-live-toggle').click();
  await expect(legend).toContainText('Spenta');
  await page.waitForTimeout(4500); // the live neurons leave: the map settles again (about 2.5 s), then rests
  await cpu();
  const offFps = await rate(4000);
  const offCpu = await cpu();
  const res = { liveFps, liveFrames, focusedFps, focusedFrames, minimizedFps, offFps, cpu: { live: liveCpu, focused: focusedCpu, off: offCpu } };
  fs.mkdirSync(path.resolve('test-results'), { recursive: true });
  fs.writeFileSync(path.resolve('test-results', 'map-live-perf.json'), JSON.stringify(res, null, 2));
  console.log(`map-live-perf ${JSON.stringify(res)}`);
  expect(liveFps).toBeGreaterThan(20); // fluid
  expect(liveFps).toBeLessThan(36); // without focus: every other display frame at most
  expect(focusedFps).toBeGreaterThan(liveFps); // with focus: the display rate
  expect(liveFrames.workP95).toBeLessThan(8); // the main thread stays mostly free (ms of work per frame)
  expect(focusedFrames.workP95).toBeLessThan(8);
  expect(minimizedFps).toBeLessThan(2); // Chromium still gives a minimized window about one frame a second
  expect(offFps).toBe(0); // at rest: not one frame
  await m.getByTestId('bx-map-live-toggle').click();
  await expect(legend).toContainText('Fix totale ordine');

  // the same map as a list: the lit pieces are marked; now.md shows what is happening and the chat to open
  await m.getByRole('button', { name: 'Elenco' }).click();
  const flat = m.getByTestId('bx-map-flat');
  await expect(flat.locator('button.live').filter({ hasText: 'now.md' })).toHaveCount(1);
  await expect(flat.locator('button.live').filter({ hasText: 'reviewer' })).toHaveCount(1);
  await flat.locator('button.live').filter({ hasText: 'now.md' }).click();
  const now = m.getByTestId('bx-map-now');
  await expect(now).toContainText('legge Fix totale ordine');
  await shot(page, 'brain-map-live-piece');
  await now.getByRole('button', { name: 'Apri «Fix totale ordine»' }).click();
  await expect(page.getByTestId('brain-map')).toHaveCount(0);
  await expect(page.getByTestId('tile-chat-fix')).toBeVisible();

  // a live chat's neuron opens its chat; the legend opens a chat too
  await openMap();
  await page.getByTestId('brain-map').getByRole('button', { name: 'Elenco' }).click();
  await page.getByTestId('bx-map-flat').locator('button.live').filter({ hasText: 'App · Feedback' }).click(); // the Regia wrote to it
  await expect(page.getByTestId('brain-map')).toHaveCount(0);
  await openMap();
  await page.getByTestId('bx-map-live').getByTestId('bx-map-live-chat').filter({ hasText: 'Bug notifiche SMS' }).click();
  await expect(page.getByTestId('brain-map')).toHaveCount(0);

  // a finished call fades: with the frozen clock it stays at full light, no longer running
  await tool('fix', { id: 'live-read', name: 'Read', input: { file_path: 'C:\\brains\\demo\\now.md' }, summary: 'now.md', status: 'ok' });
  await openMap();
  await expect(page.getByTestId('bx-map-live')).toContainText('1 file');
});
