// second-brain main process: one window, the services (chats, browser + MCP, brain + feed) and the typed IPC. The
// handlers of each area live in src/main/ipc-handlers/*.ts; this file builds what they need (HandlerContext) and
// registers them all.
import { app, nativeImage, session, utilityProcess, type BrowserWindow } from 'electron';
import { DefaultBrain } from '../modules/ai-first/default-brain';
import { createAppConnectors } from '../modules/onboarding/app-host';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initRelease } from './release';
import { appPageUrl, createWindow, hiddenOpened, hiddenRun } from './window';
import { startTaskbar } from './taskbar';
import { Emitter, registerHandlers, type Handlers } from './ipc';
import { createServices } from './wiring';
import { attachActivity } from './activity/wiring';
import { demoLog } from './activity/demo';
import { journal } from './activity/journal';
import { log } from './log';
import { startStallWatch } from './perf';
import { RendererErrors } from './renderer-errors';
import { demoUseCounts, useCounts } from './use-counter';
import { APP_ID, ensureShortcuts, taskbarDetails } from './shortcuts';
import { installAppMenu } from './app-menu';
import { agentsMayOpen, engineOn } from './engines/policy';
import { OverlayLayer } from './overlay';
import type { Shell } from './open-path';
import { jobGuard } from './chats/jobguard';
import { clipReader } from './clipboard-image';
import { SearchService, demoBranchOf, brainHitsFrom } from './search/service';
import { gitBranch } from './search/sources';
import { findTranscript } from './chats/transcript';
import { FROZEN_EPOCH } from './demo';
import { createDemoRoutines } from './routines/demo';
import type { Routines } from './routines/service';
import { readWorker } from './read-work';
import { systemLang } from './lang';
import { setUiLangSource, uiLang } from './locale';
import { isLang } from '../shared/contract';
import { ProfileService } from './brain/profile';
import { AgentImageStore, nativeReencode } from './agents/agent-images';
import { createAppUpdates } from './update/wiring';
import { OrchestratorService } from './chats/orchestrator-service';
import { Headline } from './headline';
import { ComposerSuggest, SUGGEST_FALLBACK_MODEL } from './suggest/service';
import { tierModel } from './agents/model-tier';
import { ANTHROPIC_API } from '../shared/contract';
import { pulseStubHandlers } from './pulse/handlers';
import { createPulse } from './pulse/wiring';
import { pulseDemoHandlers } from './pulse/demo';
import { ProposalsService } from './proposals/service';
import { Workflows } from './workflows/service';
import { VoiceService, voiceRoot } from './voice/service';
import { RecordingService } from './recordings/service';
import type { InvokeArg, InvokeChannel, InvokeResult } from '../shared/contract';
import type { HandlerContext } from './ipc-handlers/context';
import { chatsHandlers } from './ipc-handlers/chats';
import { browserHandlers } from './ipc-handlers/browser';
import { appHandlers } from './ipc-handlers/app';
import { settingsHandlers } from './ipc-handlers/settings';
import { brainHandlers } from './ipc-handlers/brain';
import { agentsHandlers } from './ipc-handlers/agents';
import { mediaHandlers } from './ipc-handlers/media';

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform === 'win32') app.setAppUserModelId(APP_ID); // Windows toasts and taskbar grouping only
// userData (ADR 0007): a stable release (started by the launcher, SB_RELEASE set) uses %APPDATA%/second-brain; a build run
// from the repo uses %APPDATA%/second-brain-dev and MCP port 4329, so dev never touches the stable cockpit; tests isolate it.
// first: read the release and scrub the stable-only variables, so no CLI, shell or dev instance inherits them
const stable = initRelease(app.getAppPath());
export const isStable = !!stable.release;
if (!isStable && !process.env.SB_MCP_PORT) process.env.SB_MCP_PORT = '4329';
app.setPath('userData', process.env.SB_USER_DATA ?? path.join(app.getPath('appData'), isStable ? 'second-brain' : 'second-brain-dev'));
// a second start (the icon clicked while the app is open or still quitting) leaves at once, before any service starts,
// with the code the stable launcher (scripts/release.mjs ALREADY_RUNNING) reads as "already open", never "broken"
if (!app.requestSingleInstanceLock()) app.exit(75);

let win: BrowserWindow | null = null;
/** the page's interface errors to the `renderer` log, rate-limited (ADR 0192) */
const rendererErrors = new RendererErrors();

app.whenReady().then(async () => {
  log.init(app.getPath('userData'));
  startStallWatch(); // a frozen window (main thread blocked) is logged with its cause, scope perf
  ensureShortcuts(outDir);
  installAppMenu();
  // macOS: the Dock shows the shared Electron bundle's icon unless told otherwise (no app bundle of our own, ADR 0054)
  if (process.platform === 'darwin') app.dock?.setIcon(path.join(outDir, 'icon.png'));
  log.info('app', 'start', { data: { version: app.getVersion(), electron: process.versions.electron, userData: app.getPath('userData') } });
  win = createWindow(outDir, false);
  // Windows: the taskbar button's icon and relaunch command (a pin of the window shows the app, not Electron)
  const appDetails = hiddenRun() ? null : taskbarDetails(outDir);
  if (appDetails) win.setAppDetails(appDetails);
  // Attach before starting services: ready-to-show may fire while their asynchronous initialization is pending.
  const windowReady = new Promise<void>(resolve => win!.once('ready-to-show', resolve));
  const emitter = new Emitter(() => win?.webContents ?? null);
  // engines' Job Objects (ADR 0026): the helper loads while the services start; engines started before it is ready wait
  if (process.env.SB_DEMO !== '1') jobGuard.start(path.join(app.getPath('userData'), 'jobguard'));
  const s = await createServices({ emitter, window: () => win, userData: app.getPath('userData') });
  // the usage counter (ADR 0202): local, zero tokens; after the services, so the agent runs' store opened app.db first;
  // the demo counts in memory only, from two fake weeks
  useCounts.init(process.env.SB_DEMO === '1' ? { userData: null, seed: demoUseCounts(process.env.SB_DEMO_FREEZE === '1' ? FROZEN_EPOCH : Date.now()), ...(process.env.SB_DEMO_FREEZE === '1' ? { now: () => FROZEN_EPOCH } : {}) } : { userData: app.getPath('userData') });
  setUiLangSource(() => { const l = s.brain.settings().language; return isLang(l) ? l : systemLang(); });
  // the Log page (ADR 0111): the app's own events, readable and live, kept 7 days at most; zero tokens
  const activity = attachActivity({ userData: app.getPath('userData'), emitter, chats: () => s.chats.list(), brainRoot: () => s.brain.info().brainRoot });
  if (process.env.SB_DEMO === '1') journal.seed(demoLog(process.env.SB_DEMO_FREEZE === '1' ? FROZEN_EPOCH : Date.now()));
  /** The Routine section's service; the demo gets seeded run folders read by the same code. */
  let demoRoutines: Routines | undefined;
  const stopRoutineView = () => { s.routines?.stop(); demoRoutines?.stop(); };
  win.webContents.on('render-process-gone', stopRoutineView);
  win.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) stopRoutineView(); });
  win.on('closed', stopRoutineView);
  const routinesOf = (): Routines => {
    if (s.routines) return s.routines;
    if (process.env.SB_DEMO === '1') return demoRoutines ??= createDemoRoutines(app.getPath('userData'), process.env.SB_DEMO_FREEZE === '1' ? FROZEN_EPOCH : Date.now(), change => emitter.emit('routines:progress', change));
    throw new Error('Routine non disponibili: riavvia l’app.');
  };
  const requireReviewRoot = (expected: unknown): void => {
    const actual = s.brain.info().brainRoot;
    if (!actual || typeof expected !== 'string' || path.resolve(expected) !== path.resolve(actual)) throw new Error('Brain changed: reload the review before acting.');
  };
  // the global request layer: a small top-most view above browser tiles and pages (main/overlay.ts)
  const overlay = new OverlayLayer(() => win, outDir);
  overlay.start();
  (globalThis as Record<string, unknown>).__sbOverlay = { state: () => overlay.state() }; // e2e tests and diagnostics
  const opened = hiddenOpened;
  const hiddenShell: Shell = { showItemInFolder: p => { opened.push(`folder ${p}`); } };
  (globalThis as Record<string, unknown>).__sbOpened = opened; // e2e: what a hidden run would have opened
  const clip = clipReader();
  // Ctrl+K full-text search (ADR 0023): indexed on the first query, updated only when the user searches
  const demo = process.env.SB_DEMO === '1';
  const search = new SearchService({
    chats: () => s.chats.list(),
    items: id => s.chats.items(id),
    transcriptOf: c => (!demo && c.harness === 'claude' && c.sessionId ? findTranscript(c.sessionId, c.cwd) : null),
    brainRoot: () => (demo ? process.env.SB_BRAIN ?? null : s.brain.info().brainRoot),
    branchOf: demo ? demoBranchOf : gitBranch,
    // brain files ranked by the hybrid search (words + meaning, SPEC 23) when it answers; else by the palette's own index
    ...(s.hybrid ? { brainHits: brainHitsFrom(s.hybrid) } : {}),
    ...(demo && process.env.SB_DEMO_FREEZE === '1' ? { now: () => FROZEN_EPOCH } : {}),
  });
  let brainChoiceRevision = 0;
  const emitBeforeBrainChoice = emitter.emit.bind(emitter);
  emitter.emit = (channel, payload) => {
    if (channel === 'settings:changed' && payload && typeof payload === 'object' && 'key' in payload && payload.key === 'brainRoot') brainChoiceRevision++;
    emitBeforeBrainChoice(channel, payload);
  };
  const agentImages = new AgentImageStore(path.join(app.getPath('userData'), 'agent-images'), nativeReencode(nativeImage), images => emitter.emit('avatars:changed', images));
  const profile = new ProfileService({ root: () => s.brain.settings().brainRoot, template: (() => { try { return fs.readFileSync(path.join(app.getAppPath(), 'brain-template', 'me.template.md'), 'utf8'); } catch { return ''; } })() });
  const defaultBrain = new DefaultBrain({ userData: app.getPath('userData'), templateRoot: path.join(app.getAppPath(), 'brain-template'), current: () => s.brain.settings().brainRoot, usable: () => !s.brain.info().brainProblem, revision: () => brainChoiceRevision, connect: async root => { await s.brain.setSettings({ brainRoot: root }); }, projects: () => s.brain.settings().projectsRoot ?? null });
    const updates = createAppUpdates({ appPath: app.getAppPath(), userData: app.getPath('userData'), running: stable.release, version: app.getVersion(), disabled: demo || !!process.env.SB_TEST,
      emitter, problem: () => s.updateChats?.problem() ?? null, saveChats: () => { if (!s.updateChats) throw new Error('Salvataggio chat non disponibile.'); s.updateChats.checkpoint(); },
      flush: () => win?.webContents.session.flushStorageData(), quit: () => app.quit(),
    });
  const workflows = s.workflows ?? new Workflows(path.join(app.getPath('userData'), 'work-threads.json'), rows => emitter.emit('work:changed', rows));
  const orchestrator = new OrchestratorService(s.chats, () => s.brain.info().brainRoot, {
    route: r => s.brain.route(r), engineOn: h => engineOn(s.brain.settings(), h), agentsMayOpen: h => agentsMayOpen(s.brain.settings(), h),
    orchestratorChats: () => s.brain.settings().orchestratorChats,
  });
  // the Grindhouse's headline (SPEC 18): never a model call in the demo or under test
  const readBrain = (rel: string): string => {
    const root = demo ? null : s.brain.info().brainRoot;
    try { return root ? fs.readFileSync(path.join(root, rel), 'utf8').slice(-20_000) : ''; } catch { return ''; }
  };
  const headline = new Headline({
    file: path.join(app.getPath('userData'), 'headline.json'),
    complete: (req, signal) => s.engines.text.complete(req, signal),
    settings: () => ({ on: s.brain.settings().pulse?.headline.on !== false }),
    lang: uiLang,
    material: () => {
      const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { chats: s.chats.list(), nowMd: readBrain('now.md'), journal: readBrain(path.join('journal', `${day}.md`)), aiErrors: readBrain('ai-errors.md') };
    },
    visible: () => !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized(),
    emit: st => emitter.emit('headline:changed', st),
    calls: !demo && !process.env.SB_TEST,
    ...(demo && process.env.SB_DEMO_FREEZE === '1' ? { now: () => FROZEN_EPOCH } : {}),
  });
  // the chat composer's model suggestion (ADR 0118): the light tier on the API engine, never a call in the demo or under test
  const composerSuggest = new ComposerSuggest({
    file: path.join(app.getPath('userData'), 'suggest.json'),
    complete: (req, signal) => s.engines.text.complete(req, signal),
    settings: () => { const c = s.brain.settings(); return { on: c.suggestOn !== false, modelOn: c.suggestModel !== false, dailyUsd: c.suggestDailyUsd ?? 0.05 }; },
    model: () => { const c = s.brain.settings(), reg = s.brain.routingInfo().registry; return tierModel(ANTHROPIC_API, 'light', reg, c.modelTiers) ?? tierModel('claude', 'light', reg, c.modelTiers) ?? SUGGEST_FALLBACK_MODEL; },
    calls: !demo && !process.env.SB_TEST && !process.env.VITEST,
  });
  // voice mode (ADR 0152): the local speech engine in its own utility process, started on first use
  const voice = new VoiceService({
    root: voiceRoot(app.getPath('userData')),
    script: path.join(outDir, 'main', 'voice-worker.js'),
    settings: () => { const c = s.brain.settings(); return { asr: c.voiceAsr ?? 'fast', voice: c.voiceName ?? 'paola' }; },
    fork: script => utilityProcess.fork(script, [], { serviceName: 'second-brain voice', stdio: 'ignore' }) as never,
    changed: st => emitter.emit('voice:changed', st),
    heard: event => emitter.emit('voice:heard', event),
    speech: event => emitter.emit('voice:speech', event),
    committed: session => emitter.emit('voice:committed', { session }),
    fake: process.env.SB_VOICE_FAKE === '1' || demo ? { text: process.env.SB_VOICE_FAKE_TEXT ?? 'Ciao, cosa c’è di nuovo?', delayMs: Number(process.env.SB_VOICE_FAKE_DELAY_MS) || 600 } : null,
  });
  s.brain.onSettingChange(change => { if (change.key === 'voiceAsr' || change.key === 'voiceName') voice.settingsChanged(); });
  // call recordings (ADR 0154): written to userData/recordings, transcribed by the same local Whisper, zero tokens
  const recordings = new RecordingService({
    store: s.recordings, home: app.getPath('home'),
    transcribe: (wav, progress) => voice.transcribe(wav, progress),
    asr: () => s.brain.settings().voiceAsr ?? 'fast',
    changed: st => emitter.emit('rec:changed', st),
  });
  recordings.recover();
  // the page reloaded or its process died mid-call: the recording it fed is closed, never left open (ADR 0154)
  const recPageGone = () => { if (s.recordings.openIds().length) recordings.abandonOpen(); };
  win?.webContents.on('did-start-navigation', d => { if (d.isMainFrame && !d.isSameDocument) recPageGone(); });
  win?.webContents.on('render-process-gone', recPageGone);
  app.on('will-quit', () => { recordings.dispose(); voice.dispose(); useCounts.close(); });
  const pulse = createPulse(s, { emitter, window: () => win, userData: app.getPath('userData') }, () => headline.get());
  // the Battito's proposals count in the morning block's "Da approvare" (ADR 0102)
  if (s.morning && pulse) s.morning.extraApprovals = () => pulse.pendingApprovals();
  const unsubscribePulse = s.brain.onSettingChange(change => { if (change.key.startsWith('pulse.') || change.key === 'jobs.fallback') pulse?.start(); });
    const mcpServers = () => { if (!s.mcpServers) throw new Error('Server MCP non disponibili.'); return s.mcpServers; };
    const connectors = createAppConnectors(app.getPath('userData'), () => s.tasks.refreshFresh(), l => s.tasks.onRead(l));
    await connectors.ready;
    const research = () => { if (!s.research) throw new Error('Manutenzione con ricerca non disponibile.'); return s.research; };
    const learn = () => { if (!s.learn) throw new Error('Impara non è disponibile.'); return s.learn; };
  const ctx: HandlerContext = {
    s, win: () => win, emitter, demo, outDir, activity, overlay, profile, agentImages, defaultBrain, updates, workflows, orchestrator, headline,
    composerSuggest, voice, recordings, pulse, mcpServers, connectors, research, learn, routinesOf, requireReviewRoot, search, clip, hiddenShell,
    proposals: () => proposals, bumpBrainChoice: () => { brainChoiceRevision++; }, rendererErrors,
  };
  const handlers: Handlers = {
    ...chatsHandlers(ctx),
    ...browserHandlers(ctx),
    ...appHandlers(ctx),
    ...settingsHandlers(ctx),
    ...brainHandlers(ctx),
    ...agentsHandlers(ctx),
    ...mediaHandlers(ctx),
    ...(pulse?.handlers() ?? (demo ? pulseDemoHandlers(process.env.SB_DEMO_FREEZE === '1' ? FROZEN_EPOCH : Date.now(), {
      settings: () => s.brain.settings().pulse, changed: () => emitter.emit('pulse:changed', undefined), approvalsChanged: () => emitter.emit('approvals:changed', undefined),
    }) : pulseStubHandlers())),
  };
  // the deck's sources call the same handlers their old pages called (never a second path to the same write)
  const call = <K extends InvokeChannel>(ch: K, arg: InvokeArg<K>): Promise<InvokeResult<K>> =>
    Promise.resolve((handlers[ch] as unknown as (x: InvokeArg<K>, e: never) => InvokeResult<K> | Promise<InvokeResult<K>>)(arg, undefined as never));
  const reviewRoot = () => s.brain.info().brainRoot ?? '';
  const proposals = new ProposalsService({
    userData: app.getPath('userData'), root: () => s.brain.info().brainRoot, emit: count => emitter.emit('proposals:changed', { count }),
    ports: {
      now: demo && process.env.SB_DEMO_FREEZE === '1' ? () => FROZEN_EPOCH : () => Date.now(),
      runs: () => s.agentRuns?.list() ?? [], chats: () => s.chats.list(),
      ...(s.learningReview ? { candidates: {
        list: async () => (await call('learning:state', undefined)).candidates,
        promote: (name: string, expectedDigest: string, replayId: string, exampleRunId: string) => call('learning:promote', { expectedRoot: reviewRoot(), name, expectedDigest, replayId, exampleRunId }),
      } } : {}),
      changes: { list: () => s.brainModel.changes(), stored: () => s.brainModel.log.all(), rollback: (id: string) => call('brainmodel:rollback', { id }) },
      settings: { pending: () => s.brain.pendingSettings(), confirm: (proposalId: string, accept: boolean) => call('settings:confirm', { proposalId, accept }) },
      roles: { list: () => s.agents.list().profiles, resolveTrial: (id: string, decision: 'keep' | 'rollback') => call('agents:trialDecide', { id, decision }) },
      ...(s.agentLifecycle ? { lifecycle: { read: () => s.agentLifecycle!.read({}), decide: (key: string, decision: 'approve' | 'dismiss') => call('agents:lifecycleDecide', { key, decision }) } } : {}),
      pulse: { list: () => call('approvals:list', {}), decide: (id: string, decision: 'approve' | 'discard') => call('approvals:decide', { id, decision }) },
      policies: { status: async () => { const r = await call('brain:api', { path: '/api/improve' }); return r.ok ? r.data : null; }, act: a => call('learn:act', a) },
      ...(s.research ? { research: { list: () => s.research!.cards(), approve: (id: string) => s.research!.approve(id), reject: (id: string) => s.research!.reject(id), repo: () => s.research!.repo(), candidates: () => s.research!.candidateCards() } } : {}),
    },
    ...(s.research ? { clickAt: () => s.research!.clickAt() } : {}),
  });
  // the badge follows its sources' own events; settings proposals and the loop's status are read every minute too
  const PROPOSAL_EVENTS: readonly string[] = ['maintenance:changed', 'brainmodel:changed', 'approvals:changed', 'agents:lifecycleChanged', 'agents:changed', 'settings:proposed', 'settings:changed'];
  emitter.tap(channel => { if (PROPOSAL_EVENTS.includes(channel)) proposals.changed(); });
  // an approved or auto-applied change rolled back from anywhere counts as a no in the Proposte ledger (ADR 0193)
  s.brainModel.log.onRolledBack(id => proposals.changeUndone(id));
  void windowReady.then(() => proposals.start());
  registerHandlers(handlers, () => win?.webContents ?? null, { contents: () => overlay.contents, channels: ['overlay:size', 'overlay:action', 'overlay:focus'] });
  // Recovery starts before the renderer store: its IPC must already be registered on the first navigation.
  void win.loadURL(appPageUrl(outDir));
  const prepareUpdates = setTimeout(() => { void updates.prepare(); }, 45_000); prepareUpdates.unref();
  // the hybrid brain search (SPEC 23) indexes in its worker a little after the window is up (never delaying the start)
  const startSearch = setTimeout(() => s.hybrid?.start(), 5_000); startSearch.unref();
  // the headline's first refresh waits for the window and the start's own work (it is never on the start's path)
  void windowReady.then(() => { if (pulse) pulse.start(); });
  // the taskbar button: what waits for the user and whether an agent works (ADR 0102; Windows only, never under SB_HIDDEN)
  let stopTaskbar = () => {};
  void windowReady.then(() => { stopTaskbar = startTaskbar({ window: () => win, chats: () => s.chats.list(), waiting: () => s.chats.pending().length + s.asks.pending().length }); });
  // chats whose turn the last quit or crash cut go on by themselves ("ripresa dopo il riavvio"); not on ready-to-show,
  // which may have fired while the services were starting
  const resumed = s.chats.resumeInterrupted();
  if (resumed) log.info('app', 'chats resumed after the restart', { data: { resumed } });
  // the stable launcher (scripts/release.mjs launch) waits for this file to know the release started (ADR 0007)
  void windowReady.then(() => {
    try { fs.writeFileSync(path.join(app.getPath('userData'), 'ready.json'), JSON.stringify({ release: stable.release ?? 'dev', pid: process.pid, at: new Date().toISOString() })); } catch (e) { log.warn('app', 'ready file not written', { data: String(e) }); }
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
    void connectors.service.cancelLogin();
    headline.stop(); readWorker.stop();
    pulse?.stop(); unsubscribePulse(); stopTaskbar(); proposals.stop();
    log.info('app', 'quit started');
    // the stable launcher (scripts/release.mjs) waits for a quitting app to go before starting again; an open one it leaves be
    try { fs.writeFileSync(path.join(app.getPath('userData'), 'quitting.json'), JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); } catch { /* best effort */ }
    const cap = new Promise<void>(r => setTimeout(r, 6000));
    void Promise.race([s.shutdown(), cap])
      .catch(err => log.warn('app', 'shutdown failed', { data: String(err) }))
      .finally(async () => {
        s.killNow();
        // app.exit skips Chromium's own shutdown: the app page's localStorage (layout, Orchestrator widget state) written in
        // the last seconds would be lost without this
        session.defaultSession.flushStorageData();
        // the process ends only once each of its threads and its Chromium children ran: on a busy CPU that took 20-130 s;
        // the job guard's helper starts a booster that outlives our code and raises them all (jobguard.ts Boost)
        await jobGuard.quit(process.pid).catch(() => {});
        log.info('app', 'exit');
        // our last moment (the log writes synchronously): what comes after is Electron's and Chromium's own teardown
        // (profile files, GPU caches; 0.3-6 s, longer under load), shortened only by the boost above
        process.once('exit', () => log.info('app', 'node exit'));
        app.exit(0);
      });
  });
  app.on('will-quit', () => s.killNow());
});

app.on('second-instance', () => { if (win && !hiddenRun()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
