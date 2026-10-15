// The brain module: implements BrainService (src/main/services.ts) for wiring.ts. It owns the settings (config.ts),
// the live feed of the brain folder and chats (live.ts), calm Windows toasts (notify.ts), the top-bar usage
// (usage.ts), the spending limits (budget.ts), the job ledger (estimates.ts: real cost and time, feeding the brain's
// routing table, ADR 0053), the GET-only proxy to the brain's own data server (api.ts) and the brain's procedures
// (procedures.ts, /api/procedures). Why one module: they share the
// brain folder, the Electron-node runner and the feed, and they restart together when the brain folder changes. Only
// this file touches Electron (Notification, the window); the parts are plain Node and unit-tested apart. App state
// lives in userData (config.json, live-state.json, budget-state.json, jobs.jsonl, jobs-meta.json). It writes into the
// brain only the model routing (routing.ts, ADR 0032): a new table version when the user saves it from the settings
// page, and the routed chats' lines in the improvement loop's ledger (ops/state/improve/, the brain's own state, never
// its tracked files).
import { Notification, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { BudgetAlert, FeedEvent, Harness, SettingChange, Settings, Usage } from '../../shared/contract';
import type { Emitter } from '../ipc';
import type { BrainService, FeedInput } from '../services';
import { log, errText } from '../log';
import { ConfigStore } from './config';
import { readCrossHarness, writeCrossHarness } from './brain-settings';
import { findBrainCandidates } from './detect';
import { Live, KINDS, stamp, cut, type RawEvent } from './live';
import { Notifier, type Toast } from './notify';
import { UsageMonitor, claudeConfigFile } from './usage';
import { cursorToday, installHook } from './cursor-ledger';
import { KimiReader, kimiHome } from './kimi-usage';
import { BudgetWatcher, type Spend } from './budget';
import { FileJobStore, Ledger } from './estimates';
import { BrainEstimates } from './brain-estimates';
import { Routing, routeChat } from './routing';
import { BrainApi, type LocalApi } from './api';
import { Compare } from './compare';
import { Procedures, touchesProcedures } from './procedures';
import { Learn } from './learn';
import { ModelsSeenStore } from './models-seen';
import { electronNode } from './node';

export interface BrainCtx {
  emitter: Emitter; window: () => BrowserWindow | null; userData: string; env?: NodeJS.ProcessEnv;
  /** the app's own chats are left out of the chats.mjs poll (the chat manager publishes their events) */
  skipChat?: (id: string) => boolean;
  /** events that must not become a Windows toast now ("Rispondi dopo", main/later.ts) */
  held?: (e: FeedEvent) => boolean;
  /** extra environment for the brain's estimates.mjs run and what it starts (the sample judge): the app's text endpoint
   *  on the user's API credits (engines/text-mcp.ts, ADR 0052); read at each run */
  scriptEnv?: () => Record<string, string>;
  /** the Anthropic API engine when the writing rows «Sui crediti API» may use it now (on, with a key), else null (ADR 0052) */
  apiRoute?: () => Harness | null;
}

const FEED_MAX = 500;

export async function createBrain(ctx: BrainCtx): Promise<BrainService> {
  const env = ctx.env ?? process.env;
  const testing = env.SB_TEST === '1';
  // a hidden run (SB_HIDDEN=1: tests, the agents' dev instance) never pops Windows toasts nor raises the window
  const quiet = testing || env.SB_HIDDEN === '1';
  const cfg = new ConfigStore(ctx.userData, env);
  // first run (or an unreadable config): a single brain folder found by its signature is used at once (brain/detect.ts),
  // before any listener exists: no restart races with the first start (two live feeds were seen in the stable test)
  if (!cfg.get().brainRoot && !testing) {
    const found = findBrainCandidates();
    if (found.length === 1) { cfg.set({ brainRoot: found[0]! }); log.info('brain', 'brain folder found by itself', { data: { brainRoot: found[0] } }); }
    else if (found.length > 1) log.info('brain', 'several brain folders found: the user chooses', { data: { found } });
  }
  const node = electronNode();
  const file = (f: string) => path.join(ctx.userData, f);
  const feed: FeedEvent[] = [];
  const budgetListeners = new Set<(a: BudgetAlert) => void>();
  const budget = new BudgetWatcher(file('budget-state.json'));
  const ledger = new Ledger(new FileJobStore(file('jobs.jsonl')), file('jobs-meta.json'));

  // ── toasts ──
  let toastsOk = !quiet && Notification.isSupported();
  if (!quiet && !toastsOk) log.warn('notify', 'Windows notifications not supported here: in-app feed only');
  let lastToast: Notification | null = null;
  const focusWindow = () => {
    const w = ctx.window();
    if (!w || w.isDestroyed() || quiet) return;
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
    ...(ctx.held ? { held: ctx.held } : {}),
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
  const localApi: LocalApi = new Map(); // paths main answers itself (serveApi), kept across brain folder changes
  const compare = new Compare(() => cfg.get().brainRoot, node);
  const learn = new Learn(() => cfg.get().brainRoot, node);
  // the brain's estimates table (ops/state/estimates.json); tests only read it, never rescan transcripts
  const estNode = { exe: node.exe, get env() { return { ...node.env, ...(ctx.scriptEnv?.() ?? {}) }; } };
  const brainEst = new BrainEstimates(() => cfg.get().brainRoot, estNode);
  const routing = new Routing(() => cfg.get().brainRoot, file('routing-api.json'));
  const models = new ModelsSeenStore(file('cursor-models.json'));
  // the Procedure page: read-only, credentials masked here (procedures.ts); a change on disk reloads the page's list
  const procedures = new Procedures(() => cfg.get().brainRoot);
  localApi.set('/api/procedures', () => procedures.list());
  localApi.set('/api/procedure', q => procedures.get(q.get('id') ?? ''));
  let procTimer: NodeJS.Timeout | null = null;
  const onBrainFile = (f: string) => {
    if (!touchesProcedures(f)) return;
    procedures.invalidate();
    if (procTimer) clearTimeout(procTimer);
    procTimer = setTimeout(() => { procTimer = null; ctx.emitter.emit('procedures:changed', undefined); }, 500);
  };
  let lastUsage: Usage | null = null;
  let backfillTimer: NodeJS.Timeout | null = null;
  let warmTimer: NodeJS.Timeout | null = null;

  // the Cursor stop hook's script, beside its ledger (~/.cursor/hooks.json points at it; that file is the user's to edit)
  if (!testing) { try { installHook(); } catch (e) { log.warn('brain', 'cursor ledger hook not installed', { cause: errText(e), hint: 'check %LOCALAPPDATA%/second-brain is writable' }); } }

  const startParts = async () => {
    const root = cfg.get().brainRoot;
    // Kimi: its own session files (tests point it at their folder, SB_KIMI_HOME, never the user's)
    const kimi = !testing || env.SB_KIMI_HOME ? new KimiReader(env.SB_KIMI_HOME || kimiHome(env)) : null;
    usage = new UsageMonitor({
      root, node, claudeConfig: testing ? null : claudeConfigFile(env),
      // tests point it at their own folders (never the user's ledger or Downloads)
      ...(!testing || env.SB_CURSOR_LEDGER ? { cursor: () => cursorToday({ dir: env.SB_CURSOR_LEDGER || undefined, downloads: env.SB_DOWNLOADS || undefined }) } : {}),
      ...(kimi ? { kimi: () => kimi.today() } : {}),
      onUsage: (u, spend) => { lastUsage = u; ctx.emitter.emit('usage', u); onSpend(spend); },
    });
    usage.start();
    api = new BrainApi(root, node, undefined, localApi);
    if (!root) { log.warn('brain', 'no brain folder configured', { data: { hint: 'settings:set { brainRoot } or SB_BRAIN' } }); return; }
    // the brain's file (brain-settings.ts) is in a folder agents write to: at start it may only close the switch (edited
    // by hand), never open it; a file that would open it is put back to the app's value
    const cross = readCrossHarness(root);
    if (cross === false && cfg.get().messaging.crossHarness) cfg.set({ messaging: { crossHarness: false } });
    else if (cross === true && !cfg.get().messaging.crossHarness) {
      log.warn('settings', 'brain-settings.json opens chats across engines: ignored', { data: { hint: 'only the user opens it, in Impostazioni → Motori' } });
      try { writeCrossHarness(root, false); } catch (e) { log.error('settings', 'brain-settings.json not written', { cause: errText(e), hint: 'check the brain folder is writable; inbox.mjs keeps the old value' }); }
    }
    live = new Live({ root, stateFile: file('live-state.json'), node, onEvents: publishRaw, onFile: onBrainFile, ...(ctx.skipChat ? { skipChat: ctx.skipChat } : {}) });
    try { await live.start(); } catch (e) { log.error('brain', 'live feed failed to start', { cause: errText(e), hint: `check the brain folder ${root}` }); }
    // estimates from day one: past chats from cost.mjs, a little after boot (it reads 30 days of transcripts)
    backfillTimer = setTimeout(() => {
      void ledger.backfill(root, node).then(r => { if (r.skipped) log.info('brain', 'estimates backfill skipped', { data: { why: r.skipped } }); })
        .catch(e => log.warn('brain', 'estimates backfill failed', { data: { error: errText(e) } }));
    }, testing ? 1000 : 20e3);
    if (!testing) brainEst.schedule(); // a fresh table soon after boot (the chats run while the app was closed)
    // the brain pages' data server, started before the first page needs it (tests start it on demand)
    if (!testing) { const a = api; warmTimer = setTimeout(() => { warmTimer = null; a.warm(); }, 10e3); }
  };
  const stopParts = () => {
    live?.stop(); usage?.stop(); api?.stop(); brainEst.stop(); procedures.invalidate();
    if (procTimer) { clearTimeout(procTimer); procTimer = null; }
    if (backfillTimer) clearTimeout(backfillTimer);
    if (warmTimer) { clearTimeout(warmTimer); warmTimer = null; }
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
    info: () => {
      const root = cfg.get().brainRoot;
      const problem = cfg.loadError ?? (!root ? 'nessuna cartella del cervello scelta' : !fs.existsSync(path.join(root, 'ops', 'tools', 'brain-site.mjs')) ? `la cartella ${root} non ha il server dati del cervello (ops/tools/brain-site.mjs)` : null);
      return { brainRoot: root, brainProblem: problem };
    },
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
    recordJob: job => { const r = ledger.record(job); if (!testing) brainEst.schedule(); return r; },
    routingInfo: () => routing.info(),
    saveRouting: (routes, reason, o = {}) => {
      const by = o.by ?? 'utente (Impostazioni)';
      const info = routing.save(routes, by, reason, Date.now(), { exploration: o.exploration, costWeight: o.costWeight, evidence: o.evidence ?? null, base: o.base });
      log.info('brain', 'routing table saved', { data: { version: info.table?.version ?? null, rows: info.table?.routes.length ?? 0, exploration: info.table?.exploration ?? null, by, reason } });
      return info;
    },
    restoreRouting: (version, by = 'utente (Impostazioni)') => {
      const info = routing.restore(version, by);
      log.info('brain', 'routing table restored', { data: { from: version, version: info.table?.version ?? null, by } });
      return info;
    },
    route: req => routeChat({ counts: k => routing.armCounts(k), api: ctx.apiRoute?.() ?? null, ...req }, routing.table(), routing.registry(), brainEst.table() as { kinds?: [string, string, string][]; tasks?: [string, string, string][] } | null),
    lastRoutingActual: id => { try { return routing.lastActual(id); } catch { return null; } },
    observeRouting: rec => {
      try { routing.observe(rec); } catch (e) { log.warn('brain', 'routing outcome not written', { cause: errText(e), hint: 'check <brain>/ops/state/improve is writable' }); }
    },
    api: p => api ? api.get(p) : Promise.resolve({ ok: false as const, error: 'nessun cervello configurato' }),
    serveApi: (p, fn) => { localApi.set(p, fn); },
    compareList: () => compare.list(),
    compareSet: (experiment, on, agent) => compare.set(experiment, on, agent),
    learnAct: a => learn.act(a),
    recordModels: (h, list) => models.record(h, list),
    modelsSeen: () => models.get(),
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
