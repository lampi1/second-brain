// second-brain main process: one window, the services (chats, browser + MCP, brain + feed) and the typed IPC.
import { app, dialog, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWindow, hiddenRun } from './window';
import { Emitter, registerHandlers, type Handlers } from './ipc';
import { createServices } from './wiring';
import { log } from './log';
import { APP_ID, ensureShortcuts } from './shortcuts';
import { claudeStatus, cursorStatus, openLogin } from './cli';
import { OverlayLayer } from './overlay';

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
app.setAppUserModelId(APP_ID);
// userData (ADR 0007): a stable release (started by the launcher, SB_RELEASE set) uses %APPDATA%/second-brain; a build run
// from the repo uses %APPDATA%/second-brain-dev and MCP port 4329, so dev never touches the stable cockpit; tests isolate it.
export const isStable = !!process.env.SB_RELEASE;
if (!isStable && !process.env.SB_MCP_PORT) process.env.SB_MCP_PORT = '4329';
app.setPath('userData', process.env.SB_USER_DATA ?? path.join(app.getPath('appData'), isStable ? 'second-brain' : 'second-brain-dev'));
if (!app.requestSingleInstanceLock()) app.quit();

let win: BrowserWindow | null = null;

app.whenReady().then(async () => {
  log.init(app.getPath('userData'));
  ensureShortcuts();
  log.info('app', 'start', { data: { version: app.getVersion(), electron: process.versions.electron, userData: app.getPath('userData') } });
  win = createWindow(outDir);
  const emitter = new Emitter(() => win?.webContents ?? null);
  const s = await createServices({ emitter, window: () => win, userData: app.getPath('userData') });
  // the global request layer: a small top-most view above browser tiles and pages (main/overlay.ts)
  const overlay = new OverlayLayer(() => win, outDir);
  overlay.start();
  (globalThis as Record<string, unknown>).__sbOverlay = { state: () => overlay.state() }; // e2e tests and diagnostics
  const handlers: Handlers = {
    'app:info': () => ({ version: app.getVersion(), ...s.brain.info(), mcpUrl: s.browser.mcpUrlFor(null), cli: s.cli() }),
    'app:pickBrain': async () => {
      const r = win ? await dialog.showOpenDialog(win, { title: 'Scegli la cartella del cervello', properties: ['openDirectory'] }) : null;
      const dir = r && !r.canceled ? r.filePaths[0] ?? null : null;
      if (dir) await s.brain.setSettings({ brainRoot: dir });
      return dir;
    },
    'app:usage': () => s.brain.usage(),
    'cli:status': a => (a.harness === 'claude' ? claudeStatus() : cursorStatus()),
    'cli:login': a => openLogin(a.harness),
    'chat:list': () => s.chats.list(),
    'chat:items': a => s.chats.items(a.chatId),
    'chat:pending': () => s.chats.pending(),
    'chat:create': a => s.chats.create(a),
    'chat:send': a => s.chats.send(a.chatId, a.text),
    'chat:answer': a => s.chats.answer(a.chatId, a.requestId, a.answer),
    'chat:stop': a => s.chats.stop(a.chatId),
    'chat:stopAll': () => s.chats.stopAll(),
    'chat:close': a => s.chats.close(a.chatId),
    'chat:set': ({ chatId, ...patch }) => s.chats.set(chatId, patch),
    'browser:list': () => s.browser.list(),
    'browser:open': a => s.browser.open(a.url, a.ownerChatId ?? null, a.env),
    'browser:navigate': a => s.browser.navigate(a.tabId, a.url),
    'browser:go': a => s.browser.go(a.tabId, a.dir),
    'browser:close': a => s.browser.close(a.tabId),
    'views:layout': a => s.browser.layout(a),
    'browser:handoffs': () => s.browser.handoffs(),
    'browser:handoffResolve': a => s.browser.resolveHandoff(a.id, a.outcome, a.note),
    'browser:envList': () => s.browser.envs(),
    'feed:list': () => s.brain.feed(),
    'feed:mute': a => s.brain.mute(a.kind, a.muted),
    'settings:get': () => s.brain.settings(),
    'settings:set': a => s.brain.setSettings(a),
    'settings:schema': () => s.brain.settingsSchema(),
    'settings:history': a => s.brain.settingsHistory(a?.limit),
    'settings:undo': a => s.brain.undoSetting(a?.changeId, 'user'),
    // the page relays an agent's request (e.g. from a chat tile): an agent's, never counted as the user's ok
    'settings:propose': a => s.brain.requestSetting(a?.key, a?.value, { by: 'agent', ...(a?.chatId ? { chatId: String(a.chatId) } : {}), ...(a?.reason ? { reason: String(a.reason) } : {}) }),
    'settings:pending': () => s.brain.pendingSettings(),
    'settings:confirm': a => s.brain.confirmSetting(a?.proposalId, a?.accept),
    'estimate:get': a => s.brain.estimate(a),
    'estimate:record': a => s.brain.recordJob(a),
    'brain:api': a => s.brain.api(a?.path),
    'overlay:model': a => overlay.setModel(a),
    'overlay:size': a => overlay.setSize(a.width, a.height),
    'overlay:action': a => overlay.relay(a),
    'overlay:focus': a => overlay.focus(a.target),
  };
  registerHandlers(handlers, () => win?.webContents ?? null, { contents: () => overlay.contents, channels: ['overlay:size', 'overlay:action', 'overlay:focus'] });
  // the stable launcher (scripts/release.mjs launch) waits for this file to know the release started (ADR 0007)
  win.once('ready-to-show', () => {
    try { fs.writeFileSync(path.join(app.getPath('userData'), 'ready.json'), JSON.stringify({ release: process.env.SB_RELEASE ?? 'dev', pid: process.pid, at: new Date().toISOString() })); } catch (e) { log.warn('app', 'ready file not written', { data: String(e) }); }
  });
  win.on('closed', () => { win = null; app.quit(); });
  // Quit: idle CLIs end cleanly, busy ones get their process trees killed (shutdown; capped at 6 s because taskkill
  // alone takes 1-3.5 s on Windows), then anything still alive is killed synchronously before app.exit (the children
  // of claude.exe would otherwise outlive the app); will-quit kills again in case this path is skipped.
  let quitting = false;
  app.on('before-quit', e => {
    // closing the window quits twice (our 'closed' handler + Electron's window-all-closed): every repeat is held too,
    // or the app would exit in the same tick without the clean shutdown (app.exit below emits no before-quit)
    e.preventDefault();
    if (quitting) return;
    quitting = true;
    const cap = new Promise<void>(r => setTimeout(r, 6000));
    void Promise.race([s.shutdown(), cap])
      .catch(err => log.warn('app', 'shutdown failed', { data: String(err) }))
      .finally(() => { s.killNow(); app.exit(0); });
  });
  app.on('will-quit', () => s.killNow());
});

app.on('second-instance', () => { if (win && !hiddenRun()) { if (win.isMinimized()) win.restore(); win.focus(); } });
