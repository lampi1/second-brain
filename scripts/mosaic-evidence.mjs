// Hidden Electron evidence collector, run by the Regia against a built baseline or candidate.
// Records actual rendered bounds, screenshots and one short synthetic drag without starting any agent CLI.
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(process.argv[2] || path.join(import.meta.dirname, '..'));
const label = process.argv[3] || 'after';
const output = path.resolve(import.meta.dirname, '../test-results/mosaic');
fs.mkdirSync(output, { recursive: true });
const results = [];
for (const width of [1920, 1280]) {
  const app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, SB_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'sb-mosaic-')), SB_MCP_PORT: '0', SB_TEST: '1', SB_HIDDEN: '1', SB_DEMO: '1', SB_DEMO_FREEZE: '1', SB_LANG: 'it' } });
  const messages = [];
  const observe = page => {
    page.on('pageerror', error => messages.push({ url: page.url(), error: error.stack }));
    page.on('console', message => { if (message.type() === 'error') messages.push({ url: page.url(), error: message.text() }); });
  };
  app.on('window', observe); app.windows().forEach(observe);
  try {
    await app.firstWindow();
    // The requests overlay is also a BrowserWindow and can win the firstWindow race. Select the renderer document.
    let page;
    for (let attempt = 0; attempt < 100 && !page; attempt++) {
      page = app.windows().find(window => window.url().startsWith('file:') && !window.url().includes('#overlay'));
      if (!page) await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!page) throw Error('Main renderer window not found');
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('file:') && !window.webContents.getURL().includes('#overlay'))?.setContentSize(width, 1080), width);
    await page.locator('[data-workspace-pane]').first().waitFor();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // Page screenshots cannot composite native WebContentsViews. Wait for their actual-size renderer snapshots,
    // and finish startup capture/decode before measuring input rather than racing the thumbnail timer.
    await page.waitForFunction(() => {
      const visible = [...document.querySelectorAll('.workspace-grid .viewport, .workspace-canvas .viewport')].filter(node => { const r = node.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; });
      return visible.length > 0 && visible.every(node => { const img = node.querySelector('img'); return img?.complete && img.naturalWidth > 0 && Math.abs(img.naturalWidth - node.clientWidth * devicePixelRatio) <= 3; });
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(output, `${label}-${width}.png`) });
    const bounds = await page.locator('[data-workspace-pane]').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { key: node.getAttribute('data-workspace-pane'), x: r.x, y: r.y, width: r.width, height: r.height }; }));
    const grip = page.locator('.workspace-grip').first();
    const box = await grip.boundingBox();
    if (!box) throw Error('Missing drag handle');
    const target = await page.locator('[data-workspace-pane]').nth(1).boundingBox();
    if (!target) throw Error('Missing drop target');
    // Pointer input is sent by Electron/Playwright; requestAnimationFrame samples the renderer while it drags.
    await page.mouse.move(box.x + 8, box.y + 8);
    await page.mouse.down();
    await page.evaluate(() => { window.__mosaicSampling = true; });
    const sample = page.evaluate(() => new Promise(resolve => {
      const times = []; let last = performance.now();
      const tick = now => { times.push(now - last); last = now; if (window.__mosaicSampling) requestAnimationFrame(tick); else resolve(times); };
      requestAnimationFrame(tick);
    }));
    await page.mouse.move(target.x + target.width * .75, target.y + 80, { steps: 70 });
    await page.evaluate(() => { window.__mosaicSampling = false; });
    const intervals = await sample;
    await page.mouse.up();
    const sorted = intervals.slice(1).sort((a, b) => a - b);
    await page.waitForTimeout(240);
    const settled = await page.locator('[data-workspace-pane]').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { key: node.getAttribute('data-workspace-pane'), x: r.x, y: r.y, width: r.width, height: r.height }; }));
    results.push({ width, bounds, settled, drag: { frames: sorted.length, medianMs: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.floor(sorted.length * .95)], maxMs: Math.max(...sorted), intervalsMs: intervals } });
  } catch (error) {
    const windows = [];
    for (const [index, page] of app.windows().entries()) {
      const state = await page.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(0, 6000), panes: document.querySelectorAll('[data-workspace-pane]').length })).catch(e => ({ error: String(e) }));
      windows.push(state);
      await page.screenshot({ path: path.join(output, `${label}-${width}-failure-${index}.png`) }).catch(() => {});
    }
    fs.writeFileSync(path.join(output, `${label}-${width}-failure.json`), JSON.stringify({ error: String(error), messages, windows }, null, 2));
    throw error;
  } finally { await app.close(); }
}
fs.writeFileSync(path.join(output, `${label}.json`), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ label, output, results }, null, 2));
