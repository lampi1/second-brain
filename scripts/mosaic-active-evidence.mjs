// Isolated demo QA: 10 long transcripts, 10Hz IPC streams and trusted Electron input. No CLI or account is used.
// Usage: node scripts/mosaic-active-evidence.mjs <label> all-visible [built-root] [trace|no-beat] [width]
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const collectorRoot = path.resolve(import.meta.dirname, '..');
const root = path.resolve(process.argv[4] || collectorRoot);
const output = path.join(collectorRoot, 'test-results', 'mosaic');
fs.mkdirSync(output, { recursive: true });
const label = process.argv[2] || 'active';
const allVisible = process.argv[3] === 'all-visible';
const trace = process.argv[5] === 'trace';
const disableBeat = process.argv[5] === 'no-beat';
const results = [];
for (const width of process.argv[6] ? [Number(process.argv[6])] : [1920, 1280]) {
  const app = await electron.launch({ cwd: root, args: ['.'], env: { ...process.env, SB_HIDDEN: '1', SB_TEST: '1', SB_DEMO: '1', SB_DEMO_FREEZE: '1', SB_MCP_PORT: '0', SB_LANG: 'it', SB_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'sb-active-mosaic-')) } });
  try {
    await app.firstWindow();
    let page;
    for (let n = 0; n < 100 && !page; n++) {
      page = app.windows().find(w => w.url().startsWith('file:') && !w.url().includes('#overlay'));
      if (!page) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(page, 'Main renderer not found');
    const errors = []; page.on('pageerror', error => errors.push(error.stack));
    await page.waitForLoadState('domcontentloaded');
    const ids = await page.evaluate(async () => {
      const chats = (await window.sb.invoke('chat:list')).filter(chat => !chat.isRegia && !chat.closedAt);
      while (chats.length < 10) chats.push(await window.sb.invoke('chat:create', { harness: 'claude', cwd: chats[0].cwd, title: `Drag QA ${chats.length + 1}`, prompt: '' }));
      const prefs = JSON.parse(localStorage.getItem('sb.prefs.v1') || '{}');
      localStorage.setItem('sb.prefs.v1', JSON.stringify({ ...prefs, chatPanelsV: 1, chatExpanded: Object.fromEntries(chats.map(chat => [chat.id, true])) }));
      return chats.map(chat => chat.id);
    });
    await page.addInitScript(disableBeat => {
      // React 19's DevTools commit hook. PerformedWork (bit 1) distinguishes renders from stream commits elsewhere.
      // Missing hook injection is an explicit failure; no unsupported renderer is reported as zero renders.
      window.__qa = { phase: 'setup', phases: [{ phase: 'setup', at: performance.now() }], disabledHeartbeat: 0, injected: 0, commits: {}, workspaceRenders: {}, tileRenders: {}, transcriptRenders: {}, frames: [], tasks: [], inputs: [] };
      if (disableBeat) {
        const interval = window.setInterval.bind(window);
        window.setInterval = (callback, delay, ...args) => {
          if (delay === 500 && typeof callback === 'function' && callback.toString().includes('data-b3')) {
            window.__qa.disabledHeartbeat++; return interval(callback, 36000000, ...args);
          }
          return interval(callback, delay, ...args);
        };
      }
      window.__qaPhase = phase => { window.__qa.phase = phase; window.__qa.phases.push({ phase, at: performance.now() }); performance.mark(`mosaic-phase:${phase}`); };
      let previousFibers = new WeakSet();
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true,
        inject() { window.__qa.injected++; return 1; },
        onCommitFiberRoot(_id, root) {
          const q = window.__qa, phase = q.phase;
          q.commits[phase] = (q.commits[phase] || 0) + 1;
          const counted = new Set();
          const currentFibers = new WeakSet();
          const visit = fiber => {
            currentFibers.add(fiber);
            const node = fiber.stateNode;
            const workspace = node?.dataset?.testid === 'view-mosaico';
            const chat = node?.dataset?.chatId && node.classList?.contains('chat-tile');
            const transcript = node?.classList?.contains('chat-transcript');
            if (workspace || chat || transcript) {
              let component = fiber.return;
              while (component && typeof component.type !== 'function' && component.tag !== 15) component = component.return;
              if (component && !previousFibers.has(component) && (component.flags & 1) && !counted.has(component)) {
                counted.add(component);
                const bucket = workspace ? q.workspaceRenders : transcript ? q.transcriptRenders : q.tileRenders;
                bucket[phase] = (bucket[phase] || 0) + 1;
              }
            }
            for (let child = fiber.child; child; child = child.sibling) visit(child);
          };
          visit(root.current);
          previousFibers = currentFibers;
        },
        onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
      };
      new PerformanceObserver(list => { for (const e of list.getEntries()) window.__qa.tasks.push({ start: e.startTime, duration: e.duration }); }).observe({ type: 'longtask', buffered: true });
      let previous = 0;
      const frame = now => { if (previous) window.__qa.frames.push({ start: previous, at: now, ms: now - previous }); previous = now; requestAnimationFrame(frame); };
      requestAnimationFrame(frame);
      for (const type of ['pointerdown', 'pointermove', 'pointerup']) document.addEventListener(type, event => {
        if (window.__qa.phase !== 'setup') window.__qa.inputs.push({ type, trusted: event.isTrusted, at: performance.now() });
        // Capture precedes React's pointerup handler: the one legitimate drop render belongs to snap, not movement.
        if (type === 'pointerup' && window.__qa.phase === 'drag') window.__qaPhase('snap');
      }, true);
    }, disableBeat);
    await page.reload();
    await app.evaluate(({ BrowserWindow }, { width, height }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:') && !w.webContents.getURL().includes('#overlay'))?.setContentSize(width, height), { width, height: allVisible ? 3600 : 1080 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('[data-workspace-pane]').nth(9).waitFor({ state: 'attached' });
    // Reload checkpoints may replace localStorage seeds. Use the actual UI state, never infer expansion from storage.
    for (const id of ids) {
      const button = page.getByTestId(`chat-expand-${id}`);
      if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
      assert.equal(await button.getAttribute('aria-expanded'), 'true', `Chat ${id} must be expanded`);
    }
    await page.locator('.workspace-canvas').evaluate(canvas => { canvas.scrollTop = 0; });
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__qaPhase('calibration-positive'));
    const expansion = page.getByTestId(`chat-expand-${ids[0]}`);
    await expansion.click(); await page.waitForTimeout(300); await expansion.click(); await page.waitForTimeout(300);
    await page.evaluate(() => window.__qaPhase('calibration-negative'));
    await app.evaluate(() => globalThis.__sbDemo.say('regia', 'Counter calibration: a Regia-only message must not render workspace chat tiles.'));
    await page.waitForTimeout(400);
    const calibration = await page.evaluate(() => ({ positive: window.__qa.workspaceRenders['calibration-positive'] || 0, negativeWorkspace: window.__qa.workspaceRenders['calibration-negative'] || 0, negativeTiles: window.__qa.tileRenders['calibration-negative'] || 0 }));
    assert(calibration.positive > 0 && calibration.negativeWorkspace === 0 && calibration.negativeTiles === 0, `Invalid React counter calibration: ${JSON.stringify(calibration)}`);
    await page.evaluate(() => window.__qaPhase('setup'));
    await app.evaluate(({ BrowserWindow }, ids) => {
      const wc = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:') && !w.webContents.getURL().includes('#overlay')).webContents;
      const demo = globalThis.__sbDemo;
      const paragraph = 'A realistic engineering update with details about the current change, observations from validation, and the next action. '.repeat(5);
      for (const id of ids) {
        for (let item = 0; item < 24; item++) demo.say(id, `### Step ${item + 1}\n\n${paragraph}\n\n- Verified behavior\n- Evidence recorded`);
        wc.send('chat:item', { chatId: id, item: { kind: 'assistant', id: `qa-stream-${id}`, at: Date.now(), text: paragraph, streaming: true } });
      }
      let tick = 0;
      globalThis.__activeQATimer = setInterval(() => {
        tick++;
        for (const id of ids) wc.send('chat:item', { chatId: id, replace: true, item: { kind: 'assistant', id: `qa-stream-${id}`, at: Date.now(), text: paragraph + ' New streamed detail.'.repeat(tick), streaming: true } });
      }, 100);
    }, ids);
    await page.waitForTimeout(1000);
    const visibleChats = await page.evaluate(ids => [...document.querySelectorAll('[data-chat-log]')].filter(node => { const r = node.getBoundingClientRect(); return ids.includes(node.dataset.chatLog) && !node.closest('[inert]') && r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight; }).length, ids);
    const activeWrappers = await page.locator('.chat-transcript[data-transcript-visible="true"]').count();
    const wrapperCount = await page.locator('.chat-transcript').count();
    if (allVisible && (visibleChats !== 10 || wrapperCount > 0 && activeWrappers !== 10)) {
      const diagnostic = await page.evaluate(() => ({
        documentHidden: document.hidden, viewport: { width: innerWidth, height: innerHeight },
        transcripts: [...document.querySelectorAll('.chat-transcript')].map(node => {
          const r = node.getBoundingClientRect(), style = getComputedStyle(node);
          return { chat: node.closest('[data-chat-id]')?.dataset.chatId, visible: node.dataset.transcriptVisible, hasLog: !!node.querySelector('[data-chat-log]'), loading: !!node.querySelector('.skeleton'), rect: { x: r.x, y: r.y, w: r.width, h: r.height }, display: style.display, flex: style.flex, inert: !!node.closest('[inert]') };
        }),
      }));
      fs.writeFileSync(path.join(output, `${label}-${width}-visibility-failure.json`), JSON.stringify(diagnostic, null, 2));
      await page.screenshot({ path: path.join(output, `${label}-${width}-visibility-failure.png`) });
      assert(visibleChats === 10 && (!wrapperCount || activeWrappers === 10), `All ten transcripts must actually be visible and active; logs=${visibleChats} active=${activeWrappers}; diagnostics saved`);
    }
    const bounds = async () => page.locator('[data-workspace-pane]').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { key: node.dataset.workspacePane, x: r.x, y: r.y, w: r.width, h: r.height }; }));
    const verify = (rects, viewport) => {
      for (const rect of rects) assert(rect.x >= -1 && rect.x + rect.w <= viewport + 1, `Horizontal overflow: ${rect.key}`);
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        assert(a.x + a.w <= b.x + 1 || b.x + b.w <= a.x + 1 || a.y + a.h <= b.y + 1 || b.y + b.h <= a.y + 1, `Overlap: ${a.key}/${b.key}`);
      }
    };
    const viewport = await page.evaluate(() => innerWidth);
    const before = await bounds(); verify(before, viewport);
    await page.screenshot({ path: path.join(output, `${label}-${width}.png`) });
    if (trace) await app.evaluate(({ contentTracing }) => contentTracing.startRecording({ included_categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing', 'v8', 'toplevel', 'cc', 'gpu'] }));
    await page.evaluate(() => window.__qaPhase('stream-only'));
    await page.waitForTimeout(1200);
    const grip = await page.locator('.workspace-grip').first().boundingBox();
    const target = before[1]; assert(grip && target);
    const displayed = () => page.evaluate(ids => ids.map(id => {
      const node = document.querySelector(`[data-testid="${CSS.escape(`item-qa-stream-${id}`)}"]`);
      const r = node?.getBoundingClientRect();
      return { id, length: node?.textContent.length || 0, inert: !!node?.closest('[inert]'), visible: !!r && r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight };
    }), ids);
    const textBefore = await displayed();
    await page.evaluate(() => window.__qaPhase('drag'));
    await app.evaluate(async ({ BrowserWindow }, { from, to }) => {
      const wc = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:') && !w.webContents.getURL().includes('#overlay')).webContents;
      const send = (type, x, y, extra = {}) => wc.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), ...extra });
      send('mouseMove', from.x, from.y); send('mouseDown', from.x, from.y, { button: 'left', clickCount: 1 });
      for (let step = 1; step <= 90; step++) {
        send('mouseMove', from.x + (to.x - from.x) * step / 90, from.y + (to.y - from.y) * step / 90, { button: 'left' });
        await new Promise(resolve => setTimeout(resolve, 16));
      }
      send('mouseUp', to.x, to.y, { button: 'left', clickCount: 1 });
    }, { from: { x: grip.x + 8, y: grip.y + 8 }, to: { x: target.x + target.w * .75, y: target.y + 60 } });
    // sendInputEvent queues native input; under load renderer pointerup can arrive after the main loop returns.
    await page.waitForFunction(() => window.__qa.phase === 'snap', undefined, { timeout: 5000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__qaPhase('complete'));
    if (trace) await app.evaluate(({ contentTracing }, output) => contentTracing.stopRecording(output), path.join(output, `${label}-${width}-trace.json`));
    const textAfter = await displayed();
    for (let i = 0; i < ids.length; i++) if (allVisible || textBefore[i].visible && textAfter[i].visible) assert(textBefore[i].length > 0 && textAfter[i].length > textBefore[i].length && !textAfter[i].inert, `Frozen or hidden stream: ${ids[i]}`);
    const after = await bounds(); verify(after, viewport);
    const telemetry = await page.evaluate(() => window.__qa);
    if (disableBeat) assert(telemetry.disabledHeartbeat > 0, 'Heartbeat-only control was not applied');
    assert(telemetry.injected > 0, 'React DevTools hook not injected; render count unavailable');
    assert(telemetry.inputs.some(e => e.type === 'pointermove' && e.trusted), 'No trusted native pointer input');
    const summarize = phase => {
      const index = telemetry.phases.findIndex(entry => entry.phase === phase);
      const start = telemetry.phases[index].at, end = telemetry.phases[index + 1].at;
      const frames = telemetry.frames.filter(frame => frame.start >= start && frame.at <= end).map(frame => frame.ms).sort((a, b) => a - b);
      const crossingFrames = telemetry.frames.filter(frame => frame.start < end && frame.at > start && !(frame.start >= start && frame.at <= end));
      const tasks = telemetry.tasks.filter(task => task.start < end && task.start + task.duration > start).map(task => ({ ...task, overlapMs: Math.min(end, task.start + task.duration) - Math.max(start, task.start) }));
      return { start, end, frames: frames.length, crossingFrames, over16_7: frames.filter(ms => ms > 16.7).length, over20: frames.filter(ms => ms > 20).length, median: frames[Math.floor(frames.length * .5)], p95: frames[Math.floor(frames.length * .95)], max: Math.max(...frames), longTasks: tasks, rootCommits: telemetry.commits[phase] || 0, workspaceRenders: telemetry.workspaceRenders[phase] || 0, chatTileRenders: telemetry.tileRenders[phase] || 0, transcriptRenders: telemetry.transcriptRenders[phase] || 0 };
    };
    results.push({ width, height: allVisible ? 3600 : 1080, disableBeat, disabledHeartbeat: telemetry.disabledHeartbeat, visibleChats, activeWrappers, textBefore, textAfter, chatCount: ids.length, historyItemsPerChat: 24, streamHzPerChat: 10, calibration, before, after, streamOnly: summarize('stream-only'), drag: summarize('drag'), snap: summarize('snap'), telemetry, errors });
  } finally {
    await app.evaluate(() => clearInterval(globalThis.__activeQATimer)).catch(() => {});
    await app.close();
  }
}
fs.writeFileSync(path.join(output, `${label}.json`), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map(({ telemetry: _telemetry, before: _before, after: _after, ...summary }) => summary), null, 2));
