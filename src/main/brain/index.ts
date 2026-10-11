// The brain module: implements BrainService (src/main/services.ts) for wiring.ts. It owns the settings (config.ts),
// the live feed of the brain folder and chats (live.ts), calm Windows toasts (notify.ts), the top-bar usage
// (usage.ts), the spending limits (budget.ts), cost/time estimates (estimates.ts) and the GET-only proxy to the
// brain's own data server (api.ts). Why one module: they share the brain folder, the Electron-node runner and the
// feed, and they restart together when the brain folder changes. Only this file touches Electron (Notification,
// the window); the parts are plain Node and unit-tested apart. Never writes into the brain: app state lives in
// userData (config.json, live-state.json, budget-state.json, jobs.jsonl, jobs-meta.json).
import { Notification, type BrowserWindow } from 'electron';
import path from 'node:path';
import type { BudgetAlert, FeedEvent, SettingChange, Settings, Usage } from '../../shared/contract';
import type { Emitter } from '../ipc';
import type { BrainService, FeedInput } from '../services';
import { log, errText } from '../log';
import { ConfigStore } from './config';
import { readCrossHarness, writeCrossHarness } from './brain-settings';
import { Live, KINDS, stamp, cut, type RawEvent } from './live';
import { Notifier, type Toast } from './notify';
import { UsageMonitor, claudeConfigFile } from './usage';
import { BudgetWatcher, type Spend } from './budget';
import { FileJobStore, Ledger } from './estimates';
import { BrainApi } from './api';
import { electronNode } from './node';

export interface BrainCtx {
  emitter: Emitter; window: () => BrowserWindow | null; userData: string; env?: NodeJS.ProcessEnv;
  /** the app's own chats are left out of the chats.mjs poll (the chat manager publishes their events) */
  skipChat?: (id: string) => boolean;
}

const FEED_MAX = 500;

export async function createBrain(ctx: BrainCtx): Promise<BrainService> {
  const env = ctx.env ?? process.env;
  const testing = env.SB_TEST === '1';
  const cfg = new ConfigStore(ctx.userData, env);
  const node = electronNode();
  const file = (f: string) => path.join(ctx.userData, f);
  const feed: FeedEvent[] = [];
  const budgetListeners = new Set<(a: BudgetAlert) => void>();
  const budget = new BudgetWatcher(file('budget-state.json'));
  const ledger = new Ledger(new FileJobStore(file('jobs.jsonl')), file('jobs-meta.json'));

  // ── toasts ──
  let toastsOk = !testing && Notification.isSupported();
  if (!testing && !toastsOk) log.warn('notify', 'Windows notifications not supported here: in-app feed only');
  let lastToast: Notification | null = null;
  const focusWindow = () => {
    const w = ctx.window();
    if (!w || w.isDestroyed()) return;
    if (w.isMinimized()) w.restore();
    w.show(); w.focus();
    ctx.emitter.emit('focus:next', undefined);
  };
  const showToast = (t: Toast) => {
    try {
      // never sounds (Regia 2026-10-11: "mai suoni di default"); urgency only changes how Windows ranks it
      const n = new Notification({ title: t.title, body: t.body, silent: true, urgency: t.urgent ? 'critical' : 'normal' });
      n.on('click', focusWindow);
      n.on('failed', (_e, error) => {
        toastsOk = false;
        log.error('notify', 'Windows dropped a notification: switching to in-app only', { cause: String(error), hint: 'unpackaged apps need a Start Menu shortcut with AppUserModelId "second-brain"; the packaged build installs it' });
      });
      lastToast?.close();
      lastToast = n;
      n.show();
      log.info('notify', 'toast', { data: { count: t.count, urgent: t.urgent } });
    } catch (e) {
      toastsOk = false;
      log.error('notify', 'cannot show a notification', { cause: errText(e), hint: 'in-app feed only until restart' });
    }
  };
  const notifier = new Notifier({
    settings: () => cfg.get(),
    isFocused: () => { const w = ctx.window(); return !!w && !w.isDestroyed() && w.isFocused() && w.isVisible() && !w.isMinimized(); },
    show: showToast,
    enabled: () => toastsOk,
  });

  // ── feed ──
  const publishRaw = (raw: RawEvent[]) => {
    if (!raw.length) return;
    const at = Date.now();
    const events = raw.map(e => stamp(e, at));
    feed.unshift(...events);
    if (feed.length > FEED_MAX) feed.length = FEED_MAX;
    ctx.emitter.emit('feed:events', events);
    notifier.push(events);
  };

  // ── budget ──
  const onSpend = (spend: Spend) => {
    for (const a of budget.check(cfg.get().budget, spend)) {
      ctx.emitter.emit('budget:alert', a);
      for (const fn of budgetListeners) { try { fn(a); } catch (e) { log.warn('brain', 'budget listener failed', { data: { error: errText(e) } }); } }
      publishRaw([{ kind: 'budget', title: a.text, detail: a.mode === 'ask' ? 'Ti chiedo se continuare, niente si ferma da solo' : '', priority: a.threshold === 100 ? 'urgent' : 'normal', ...(a.chatId ? { chatId: a.chatId } : {}) }]);
      log.info('brain', 'budget threshold', { data: { harness: a.harness, scope: a.scope, threshold: a.threshold, mode: a.mode } });
    }
  };

  // ── parts that depend on the brain folder (restarted when it changes) ──
  let live: Live | null = null;
  let usage: UsageMonitor | null = null;
  let api: BrainApi | null = null;
  let lastUsage: Usage | null = null;
  let backfillTimer: NodeJS.Timeout | null = null;

  const startParts = async () => {
    const root = cfg.get().brainRoot;
    usage = new UsageMonitor({
      root, node, claudeConfig: testing ? null : claudeConfigFile(env),
      onUsage: (u, spend) => { lastUsage = u; ctx.emitter.emit('usage', u); onSpend(spend); },
    });
    usage.start();
    api = new BrainApi(root, node);
    if (!root) { log.warn('brain', 'no brain folder configured', { data: { hint: 'settings:set { brainRoot } or SB_BRAIN' } }); return; }
    // the brain's own switches win at start (the file may have been edited by hand): brain-settings.ts
    const cross = readCrossHarness(root);
    if (cross !== null && cross !== cfg.get().messaging.crossHarness) cfg.set({ messaging: { crossHarness: cross } });
    live = new Live({ root, stateFile: file('live-state.json'), node, onEvents: publishRaw, ...(ctx.skipChat ? { skipChat: ctx.skipChat } : {}) });
    try { await live.start(); } catch (e) { log.error('brain', 'live feed failed to start', { cause: errText(e), hint: `check the brain folder ${root}` }); }
    // estimates from day one: past chats from cost.mjs, a little after boot (it reads 30 days of transcripts)
    backfillTimer = setTimeout(() => {
      void ledger.backfill(root, node).then(r => { if (r.skipped) log.info('brain', 'estimates backfill skipped', { data: { why: r.skipped } }); })
        .catch(e => log.warn('brain', 'estimates backfill failed', { data: { error: errText(e) } }));
    }, testing ? 1000 : 20e3);
  };
  const stopParts = () => {
    live?.stop(); usage?.stop(); api?.stop();
    if (backfillTimer) clearTimeout(backfillTimer);
    live = null; usage = null; api = null;
  };

  // every change applies live: the UI animates it (with "Annulla"), the parts that depend on it react now
  const settingListeners = new Set<(c: SettingChange, now: Settings) => void>();
  let restarting: Promise<void> = Promise.resolve();
  cfg.onChange((c, now, before) => {
    if (c.key === 'messaging.crossHarness' && now.brainRoot) {
      try { writeCrossHarness(now.brainRoot, now.messaging.crossHarness); } catch (e) { log.error('settings', 'brain-settings.json not written', { cause: errText(e), hint: 'check the brain folder is writable; inbox.mjs keeps the old value' }); }
    }
    ctx.emitter.emit('settings:changed', { ...c, settings: now });
    log.info('settings', 'changed', { ...(c.chatId ? { chat: c.chatId } : {}), data: { key: c.key, by: c.by, undoOf: c.undoOf, proposalId: c.proposalId } });
    if (now.brainRoot !== before.brainRoot) {
      log.info('brain', 'brain folder changed: restarting feed, usage and data server', { data: { brainRoot: now.brainRoot } });
      // one restart at a time: two quick changes never leave two watchers running
      restarting = restarting.then(async () => { stopParts(); await startParts(); }).catch(e => log.warn('brain', 'restart failed', { data: { error: errText(e) } }));
    }
    if (c.key.startsWith('budget.') && usage) onSpend(usage.spend()); // a new limit is checked at once
    for (const fn of settingListeners) { try { fn(c, now); } catch (e) { log.warn('settings', 'listener failed', { data: { error: errText(e) } }); } }
  });
  cfg.onProposal(p => {
    ctx.emitter.emit('settings:proposed', p);
    log.info('settings', `proposal ${p.status}`, { ...(p.chatId ? { chat: p.chatId } : {}), data: { key: p.key, id: p.id } });
  });
  await startParts();

  const kindOk = (k: unknown): k is string => typeof k === 'string' && /^[a-z][a-z-]{0,40}$/.test(k);

  return {
    feed: () => feed.slice(),
    mute: (kind, muted) => { if (!kindOk(kind) || typeof muted !== 'boolean') throw new Error('feed:mute: tipo e true/false'); cfg.set({ mute: { [kind]: muted } }); },
    usage: () => lastUsage ?? usage?.get() ?? { todayUsd: 0, fiveHourPct: null, fiveHourResetsAt: null, weekPct: null },
    info: () => ({ brainRoot: cfg.get().brainRoot }),
    settings: () => cfg.get(),
    setSettings: async patch => cfg.set(patch, { by: 'user' }),
    settingsSchema: () => cfg.schema(),
    settingsHistory: limit => cfg.history(limit),
    undoSetting: (changeId, by = 'user') => { if (typeof changeId !== 'string') throw new Error('changeId mancante'); return cfg.undo(changeId, { by }); },
    requestSetting: (key, value, origin) => cfg.request(key, value, origin),
    pendingSettings: () => cfg.pending(),
    confirmSetting: (proposalId, accept) => {
      if (typeof proposalId !== 'string' || typeof accept !== 'boolean') throw new Error('proposalId e accept (true/false)');
      return { change: cfg.confirm(proposalId, accept) };
    },
    onSettingChange: fn => { settingListeners.add(fn); return () => { settingListeners.delete(fn); }; },
    estimate: req => ledger.estimate(req),
    recordJob: job => ledger.record(job),
    api: p => api ? api.get(p) : Promise.resolve({ ok: false as const, error: 'nessun cervello configurato' }),
    publish: (events: FeedInput[]) => {
      publishRaw(events.filter(e => kindOk(e?.kind) && typeof e.title === 'string').map(e => ({
        kind: e.kind, title: cut(e.title, 200), detail: cut(e.detail ?? '', 400),
        ...(e.who ? { who: e.who } : {}), ...(e.chatId ? { chatId: e.chatId } : {}), ...(e.file ? { file: e.file } : {}),
      })));
    },
    ingestRateLimits: msg => { usage?.ingest(msg); },
    onBudgetAlert: fn => { budgetListeners.add(fn); return () => { budgetListeners.delete(fn); }; },
    shutdown: async () => { stopParts(); notifier.stop(); lastToast?.close(); },
  };
}

export { KINDS };
