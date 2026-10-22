// End-to-end: the live brain map in the real app (frozen demo + the synthetic brain of test/fixtures/brain-ui). The
// demo's chats work (two running, the Orchestrator waiting); a test hook (__sbDemo.tool) makes them read a brain file and
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
import { launch, setSize, shot, openNotesMap } from './helpers';

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
const openMap = async () => {
  await openNotesMap(page);
    await page.getByRole('button', { name: 'Esplora in 3D' }).click();
  await expect(page.getByTestId('brain-map')).toBeVisible();
  await page.getByTestId('bx-map-live').locator('summary').click();
};

test.beforeAll(async () => {
  ({ app, page } = await launch({ SB_DEMO: '1', SB_DEMO_FREEZE: '1', SB_BRAIN: fixtureBrain() }));
  await setSize(app, 1600, 1000);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.getByTestId('orchestrator-overlay')).toBeVisible();
  // the frames the map draws (a burst of WebGL draw calls = one frame)
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
  // what the chats do now: Fix reads the brain's now.md and calls the reviewer, the Orchestrator writes to App · Feedback
  await tool('fix', { id: 'live-read', name: 'Read', input: { file_path: 'C:\\brains\\demo\\now.md' }, summary: 'now.md' });
  await tool('fix', { id: 'live-agent', name: 'Agent', input: { subagent_type: 'reviewer' }, summary: 'reviewer' });
  await tool('orchestrator', { id: 'live-send', name: 'mcp__second-brain-app__app_send_to_chat', input: { chatId: 'feedback', text: 'vai' }, summary: 'a App · Feedback' });
  await tool('fix', { id: 'live-out', name: 'Read', input: { file_path: 'C:/progetti/alfa-shop/Order.cs' }, summary: 'Order.cs' });
});
test.afterAll(async () => { await app?.close(); });

test('changing reduced motion restarts observed activity without rebuilding the map',async()=>{
  if(await page.getByTestId('brain-map').count())await page.getByTestId('bx-map-close').click();
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{
    const state=window as unknown as {__mapDraws:number};state.__mapDraws=0;
    for(const name of ['drawElements','drawElementsInstanced'] as const){
      const original=WebGL2RenderingContext.prototype[name];
      Object.defineProperty(WebGL2RenderingContext.prototype,name,{configurable:true,writable:true,value:function(this:WebGL2RenderingContext,...args:unknown[]){state.__mapDraws++;return Reflect.apply(original,this,args);}});
    }
  });
  await openMap();await expect(page.getByTestId('bx-map-canvas').locator('canvas')).toHaveCount(1);
  const draws=()=>page.evaluate(()=>(window as unknown as {__mapDraws:number}).__mapDraws);
  let previous=-1,stable=0;
  await expect.poll(async()=>{const current=await draws();stable=current===previous?stable+1:0;previous=current;return stable;},{timeout:20000,intervals:[100]}).toBeGreaterThanOrEqual(3);
  const settled=await draws();await page.emulateMedia({reducedMotion:'no-preference'});
  await expect.poll(draws,{timeout:5000}).toBeGreaterThan(settled);
  await expect(page.getByTestId('bx-map-live')).toContainText('In corso');
  await page.waitForTimeout(800); // Beyond the transient wake(600); stable running activity must sustain drawing.
  const afterWake=await draws();await expect.poll(draws,{timeout:2000,intervals:[100]}).toBeGreaterThan(afterWake);
  await shot(page,'brain-map-observed-motion');await page.getByTestId('bx-map-close').click();
});
