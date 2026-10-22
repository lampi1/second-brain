// The README screenshots, generated from the frozen demo (SB_DEMO=1 SB_DEMO_FREEZE=1, the synthetic brain of
// scripts/demo-brain.mjs) so they always show the current UI with fictional data only: English UI (SB_LANG=en), dark
// theme, 1600x1000, saved as WebP (< 300 KB each) in docs/screenshots/: the whole window, one part of it, or two parts
// side by side. The showcase (memory, agent-levels, brain-map, orchestrator-flash, reactions, plan) and the rest. Not part
// of `npm run check`: run by `npm run shots` (its own Playwright config, playwright.shots.config.ts). The app runs hidden
// (SB_HIDDEN, set by launch()). The 3D map needs WebGL: on a machine without a GPU set
// SB_E2E_ELECTRON_ARGS="--use-angle=swiftshader --enable-unsafe-swiftshader" (and xvfb-run on Linux).
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StrategyPlan } from '../../src/shared/strategy';
import { launch, openOrchestrator, openNotesMap, setSize, waitThumbs, goPage } from '../e2e/helpers';
// @ts-expect-error plain ESM helper without types
import { demoBrain } from '../../scripts/demo-brain.mjs';

const OUT = path.resolve(import.meta.dirname, '..', '..', 'docs', 'screenshots');
const MAX = 300 * 1024;
const W = 1600, H = 1000;

let app: ElectronApplication, page: Page;
test.beforeAll(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const brain = (demoBrain as (p: string) => string)('sb-shots-brain-');
  // each chat asks in its own tile (questions as panels), as most users start; the UI in English
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-shots-'));
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ orchestratorDriven: false, language: 'en', theme: 'dark' }));
  ({ app, page } = await launch({ SB_DEMO: '1', SB_DEMO_FREEZE: '1', SB_BRAIN: brain, SB_LANG: 'en' }, userData));
  await setSize(app, W, H);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expect(page.locator('html[data-clock="frozen"]')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByTestId('orchestrator-overlay')).toBeVisible();
});
test.afterAll(async () => { await app?.close(); });

type Clip = { x: number; y: number; width: number; height: number };
type Part = Locator | Clip;

/** The window, one part of it (an element or a rectangle) as PNG. */
async function png(part?: Part): Promise<Buffer> {
  if (part && 'screenshot' in part) return part.screenshot({ animations: 'disabled', caret: 'hide' });
  return page.screenshot({ animations: 'disabled', caret: 'hide', ...(part ? { clip: part } : {}) });
}

/** Screenshot (of the whole window, one part of it, or several parts side by side on the app's background) → WebP in
 *  the page (Chromium's encoder: no image dependency), lowering the quality until < 300 KB. `still`: the mouse stays
 *  where it is (a card held mid-drag). */
async function save(name: string, part?: Part | Part[], opts: { still?: boolean } = {}): Promise<void> {
  // transient toasts ("Tasks updated") would cover the page
  for (const x of await page.getByTestId('toast-close').all()) await x.click();
  await expect(page.getByTestId('toast')).toHaveCount(0);
  if (!opts.still) await page.mouse.move(2, 2);
  await page.waitForTimeout(300);
  const parts = Array.isArray(part) ? part : [part];
  const pngs: Buffer[] = [];
  for (const p of parts) pngs.push(await png(p));
  await saveBuffers(name, pngs);
}

/** PNGs side by side on the app's background → docs/screenshots/<name>.webp. */
async function saveBuffers(name: string, buffers: Buffer[]): Promise<void> {
  const pngs = buffers.map(b => b.toString('base64'));
  for (const q of [0.9, 0.82, 0.74, 0.66]) {
    const b64 = await page.evaluate(async ([data, quality]) => {
      const bmps = await Promise.all((data as string[]).map(d => createImageBitmap(new Blob([Uint8Array.from(atob(d), c => c.charCodeAt(0))], { type: 'image/png' }))));
      const gap = bmps.length > 1 ? 24 : 0;
      const c = new OffscreenCanvas(bmps.reduce((w, b) => w + b.width, 0) + gap * (bmps.length - 1), Math.max(...bmps.map(b => b.height)));
      const g = c.getContext('2d')!;
      g.fillStyle = getComputedStyle(document.body).backgroundColor || '#0b0b10';
      g.fillRect(0, 0, c.width, c.height);
      let x = 0;
      for (const b of bmps) { g.drawImage(b, x, 0); x += b.width + gap; }
      const blob = await c.convertToBlob({ type: 'image/webp', quality: quality as number });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    }, [pngs, q] as const);
    const webp = Buffer.from(b64, 'base64');
    if (webp.length <= MAX || q === 0.66) {
      fs.writeFileSync(path.join(OUT, `${name}.webp`), webp);
      // the publish guard lets an image through only pinned by hash, after a human looked at it: the line to add
      console.log(`${name}.webp ${Math.round(webp.length / 1024)} KB (quality ${q}) · .guardallow line, once you have looked at it:\n` +
        `docs/screenshots/${name}.webp binary-media sha256:${createHash('sha256').update(webp).digest('hex')}`);
      expect(webp.length, `${name}.webp too large`).toBeLessThanOrEqual(MAX);
      return;
    }
  }
}

const demo = <T,>(fn: string, ...args: unknown[]): Promise<T> =>
  app.evaluate((_e, [f, a]) => ((globalThis as unknown as { __sbDemo: Record<string, (...x: unknown[]) => unknown> }).__sbDemo[f as string]!)(...(a as unknown[])), [fn, args] as const) as Promise<T>;
const tool = (chatId: string, t: { id: string; name: string; input: unknown; summary?: string }) =>
  app.evaluate((_e, [c, x]) => (globalThis as unknown as { __sbDemo: { tool(c: string, t: unknown): void } }).__sbDemo.tool(c, x), [chatId, t] as const);

test('README screenshots', async () => {
  test.setTimeout(180_000);

  // 1. The Grindhouse: the work chats as strips, a Strategist's delegation tree as thread cards under it
  await app.evaluate(() => (globalThis as unknown as { __sbDemo: { tree(): void } }).__sbDemo.tree());
  await expect(page.getByTestId('view-agents')).toBeVisible();
  const lead = page.getByTestId('tile-chat-tree-plan');
  await expect(lead).toBeVisible({ timeout: 15_000 });
  await lead.evaluate(el => {
    el.scrollIntoView({ block: 'start' });
    let box = el.parentElement; // its scrolling column: a little room above the Strategist's strip
    while (box && box.scrollHeight <= box.clientHeight) box = box.parentElement;
    box?.scrollBy(0, -44);
  });
  await waitThumbs(page);
  await save('grindhouse');

  // 1b. Agenti: the agent catalog as cards, with the changes waiting for the user's approval
  await page.getByTestId('nav-agenti').click();
  await expect(page.getByTestId('agent-overview')).toBeVisible({ timeout: 30_000 });
  await waitThumbs(page);
  await save('agents');
  await goPage(page, 'home');
  await expect(page.getByTestId('view-agents')).toBeVisible();

  // 2. The Orchestrator: the coordinating chat in its column, cut out of the page: its sub-agents, its plan with the
  // estimates, the mail between chats and the decision waiting for the user
  await openOrchestrator(page);
  await waitThumbs(page);
  await save('orchestrator', page.getByTestId('orchestrator-overlay'));

  // 3. A browser driven by an agent, big next to its chat (focus mode on the chat)
  await page.getByTestId('tile-chat-qa').locator('.tile-head').click();
  await page.keyboard.press('Control+Shift+F');
  await expect(page.getByTestId('focus-view')).toBeVisible();
  await waitThumbs(page);
  await save('browser');
  await page.getByTestId('focus-exit').click();

  // 4. The 3D brain map, lit where the chats are working right now
  await tool('fix', { id: 'shot-read', name: 'Read', input: { file_path: 'C:\\brains\\demo\\now.md' }, summary: 'now.md' });
  await tool('fix', { id: 'shot-agent', name: 'Agent', input: { subagent_type: 'reviewer' }, summary: 'reviewer' });
  await tool('orchestrator', { id: 'shot-send', name: 'mcp__second-brain-app__app_send_to_chat', input: { chatId: 'feedback', text: 'go' }, summary: 'App · Feedback' });
  await openNotesMap(page);
  await page.getByRole('button', { name: 'Explore in 3D' }).click();
  await expect(page.getByTestId('brain-map').getByTestId('bx-map-canvas').locator('canvas')).toHaveCount(1, { timeout: 30_000 });
  await page.waitForTimeout(5000); // the layout settles
  await save('brain-map', page.getByTestId('brain-map'));
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('brain-map')).toHaveCount(0);

  // 5. Task: pull requests, work items and the QA status of each PR, read on demand
  await page.getByTestId('nav-task').click();
  const dv = page.getByTestId('brain-page-task');
  await dv.getByTestId('task-refresh').click();
  await expect(dv.getByTestId('task-qa')).toBeVisible({ timeout: 30_000 });
  await dv.evaluate(el => { el.scrollTop = 0; });
  await save('task');

  // 6. Qualità: four measured metrics about how the agents work, each with its source
  await goPage(page, 'qualita');
  await expect(page.getByTestId('page-qualita').getByTestId('bx-q-trovati')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('bx-loading')).toHaveCount(0, { timeout: 30_000 });
  await save('quality');

  // 7. Script: the brain's tested, reusable scripts as cards (ADR 0076)
  await goPage(page, 'script'); // a tab of Memoria now (ADR 0122)
  await expect(page.getByTestId('bs-script-card')).toHaveCount(4, { timeout: 30_000 });
  await save('brain-scripts');
});

/** The visible part of the scrolling frame around this element (the page's own column, without the rail and the
 *  Orchestrator's column). */
const frameOf = (el: Locator): Promise<Clip> => el.evaluate(e => {
  let f: HTMLElement | null = e as HTMLElement;
  while (f && !(f.scrollHeight > f.clientHeight && /(auto|scroll)/.test(getComputedStyle(f).overflowY))) f = f.parentElement;
  const r = (f ?? (e as HTMLElement)).getBoundingClientRect();
  const y = Math.max(0, r.top), b = Math.min(innerHeight, r.bottom);
  return { x: Math.round(r.left), y: Math.round(y), width: Math.round(r.width), height: Math.round(b - y) };
});

test('README showcase: Memoria, agent levels, Orchestrator and Flash, reactions', async () => {
  test.setTimeout(180_000);
  await goPage(page, 'home');

  // Memoria: the live head with its counters, the tabs, the Proposals deck with its top card held mid-swipe
  await setSize(app, W, 1240);
  await page.getByTestId('nav-memoria').click();
  const mem = page.getByTestId('bm-memory-page');
  await expect(mem).toHaveAttribute('data-tab', 'proposte');
  const top = page.getByTestId('pd-card-top');
  await expect(top).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('bx-loading')).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(600);
  const box = (await top.locator('.pd-title').boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (120 * i) / 8, y + i * 1.5);
  await expect(page.getByTestId('pd-stamp-yes')).toHaveCSS('opacity', /^(0\.[5-9]|1)/);
  await save('memory', await frameOf(mem), { still: true });
  await page.mouse.move(x, y); // back below the threshold: the card springs back, nothing decided
  await page.mouse.up();
  await expect(page.getByTestId('pd-stamp-yes')).toHaveCSS('opacity', '0');

  // Agents: every role's card with its level from verified outcomes and its performance %, the level's "?" open on the
  // Sentinel (who judges the judge)
  await goPage(page, 'agenti');
  const overview = page.getByTestId('agent-overview');
  await expect(overview.getByTestId('catalog-card-sentinel')).toBeVisible({ timeout: 30_000 });
  const cards: Buffer[] = [];
  for (const id of ['orchestrator', 'artisan', 'sentinel']) {
    const card = overview.getByTestId(`catalog-card-${id}`);
    await card.scrollIntoViewIfNeeded();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(300);
    cards.push(await png(card));
  }
  await saveBuffers('agent-levels', cards);
  await setSize(app, W, H);

  // the Orchestrator's column, then Flash beside it, side by side
  await goPage(page, 'home');
  await openOrchestrator(page);
  await waitThumbs(page);
  const column = page.getByTestId('orchestrator-overlay');
  await page.mouse.move(2, 2);
  const cb0 = (await column.boundingBox())!;
  const topPart = { x: Math.round(cb0.x), y: Math.round(cb0.y), width: Math.round(cb0.width), height: 745 };
  const orch = await png(topPart);
  // Flash beside it: a side question about the work in progress, answered read-only from the Orchestrator's chat
  await page.getByTestId('lane-lampo').click();
  await expect(page.getByTestId('tile-lampo')).toBeVisible();
  await page.getByTestId('lampo-open').click();
  await page.getByTestId('lampo-input').click();
  await page.keyboard.type('btw, what is waiting for me?');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tile-lampo')).toContainText('Make it a job', { timeout: 15_000 });
  await expect(page.getByTestId('tile-lampo')).toContainText('From the Orchestrator’s chat', { timeout: 15_000 });
  await page.mouse.move(2, 2);
  await page.waitForTimeout(500);
  const flash = await png(topPart);
  await page.getByTestId('lane-orchestrator').click();
  await expect(page.getByTestId('tile-orchestrator')).toBeVisible();
  await saveBuffers('orchestrator-flash', [orch, flash]);

  // a thanks needs no answer: the Orchestrator's one-emoji reply sticks to the message as a reaction (her decision
  // answered first, so the message goes at once instead of queuing behind her turn)
  await page.getByTestId('tile-orchestrator').getByRole('button', { name: /^Refunds QA/ }).click();
  await expect.poll(() => page.evaluate(async () => (await window.sb.invoke('chat:list', undefined)).find(c => c.isOrchestrator && !c.closedAt)?.state), { timeout: 20_000 }).toBe('idle');
  await page.getByTestId('orchestrator-input').click();
  await page.keyboard.type('thanks!');
  await page.keyboard.press('Enter');
  const react = page.getByTestId('tile-orchestrator').locator('.msg-user .msg-react').last();
  await expect(react).toHaveText('👍', { timeout: 15_000 });
  await page.waitForTimeout(500);
  // from the question before it (a written answer) down to the thanks with its reaction
  const users = page.getByTestId('tile-orchestrator').locator('.msg-user');
  const cb = (await column.boundingBox())!, rb = (await react.boundingBox())!, qb = (await users.nth((await users.count()) - 2).boundingBox())!;
  const from = Math.round(qb.y - 8), to = Math.round(Math.min(cb.y + cb.height, rb.y + rb.height + 20));
  await save('reactions', { x: Math.round(cb.x), y: from, width: Math.round(cb.width), height: to - from });
});

test('README screenshot: Connettori', async () => {
  // 8. Impostazioni → Connettori: the MCP servers the app gives the agents, as cards with state, tools and fixes (ADR 0086)
  await page.keyboard.press('Control+,');
  const hub = page.getByTestId('st-group-connectors').getByTestId('connectors-hub');
  await expect(hub.getByTestId('hub-server-github')).toBeVisible({ timeout: 30_000 });
  await hub.getByTestId('hub-servers').evaluate(el => el.scrollIntoView({ block: 'start' }));
  await save('connectors');
});

test('README showcase: the Strategist\'s plan to approve in the questions window', async () => {
  // Popup on: the plan to approve is one more card of the questions window, its steps numbered with their role
  await page.keyboard.press('Escape');
  await goPage(page, 'home');
  if (!(await page.getByTestId('tile-chat-tree-plan').count())) await demo('tree');
  await expect(page.getByTestId('tile-chat-tree-plan')).toBeVisible({ timeout: 15_000 });
  const at = Date.now();
  const plan = { phase: 'proposed', at, asked: 2, doneWhen: 'Order tests pass and the release notes are ready.',
    steps: [
      { title: 'Find where the discount is computed today', detail: 'cart, order and refund', role: 'scout', state: 'todo' },
      { title: 'Apply the % discount to the full price', detail: 'no double discount on offers', role: 'artisan', state: 'todo' },
      { title: 'Check that the order tests pass', role: 'sentinel', state: 'todo' },
      { title: 'Write the release notes', role: 'herald', state: 'todo' },
    ],
    clarified: [{ q: 'Where', a: 'Cart, order and refund' }, { q: 'Offers', a: 'No, full price only' }] } as StrategyPlan;
  await demo('plan', 'tree-plan', plan);
  await expect(page.getByTestId('qwin-backdrop')).toBeVisible();
  await page.locator(`[data-testid="qwin-pick"][data-key="tree-plan/plan@${at}"]`).click();
  await expect(page.getByTestId('qwin-plan')).toBeVisible();
  await save('plan', page.getByTestId('qwin'));
});
