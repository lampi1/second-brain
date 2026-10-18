// second-brain main process: one window, the services (chats, browser + MCP, brain + feed) and the typed IPC.
import { app, dialog, session, shell, type BrowserWindow } from 'electron';
import { DefaultBrain } from '../modules/ai-first/default-brain';
import { findBrainCandidates } from './brain/detect';
import { createAppConnectors } from '../modules/onboarding/app-host';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initRelease } from './release';
import { createWindow, hiddenOpened, hiddenRun } from './window';
import { Emitter, registerHandlers, type Handlers } from './ipc';
import { createServices } from './wiring';
import { log } from './log';
import { logInputLag } from './perf';
import { APP_ID, ensureShortcuts } from './shortcuts';
import { installAppMenu } from './app-menu';
import { engineStatus, openLogin } from './cli';
import { engineInfos, engineOf } from './engines/registry';
import { withApiModels } from './engines/sessions';
import { agentsMayOpen, engineOn } from './engines/policy';
import { OverlayLayer } from './overlay';
import { showLocal, type Shell } from './open-path';
import { peekFile } from './peek-file';
import { readFileView } from './file-view';
import { readFileDiff } from './file-diff';
import type { DiffAgainst } from '../shared/file-diff';
import { askImageRoots, readAskImage } from './ask-image';
import { healthSnapshot } from './health';
import { jobGuard } from './chats/jobguard';
import { clipReader, readClipboardImage } from './clipboard-image';
import { gitBranches } from './chats/branch';
import { SearchService, demoBranchOf, brainHitsFrom } from './search/service';
import { gitBranch } from './search/sources';
import { findTranscript } from './chats/transcript';
import { createRoutedChat, previewRoute } from './chats/routed';
import { FROZEN_EPOCH } from './demo';
import { systemLang } from './lang';
import { BrainCreator } from './brain/create';
import { BrainCreationController } from './brain/create-controller';
import { ProfileService } from './brain/profile';
import { electronNode } from './brain/node';
import { createAppUpdates } from './update/wiring';
import { OrchestratorService } from './chats/orchestrator-service';
import { Headline } from './headline';
import { pulseStubHandlers } from './pulse/handlers';
import { createPulse } from './pulse/wiring';
import { pulseDemoHandlers } from './pulse/demo';
import { markRunOutcome } from './run/outcome';
import { canonicalRepoRoot } from './brain/adapters/codex-policy';

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

app.whenReady().then(async () => {
  log.init(app.getPath('userData'));
  ensureShortcuts();
  installAppMenu();
  // macOS: the Dock shows the shared Electron bundle's icon unless told otherwise (no app bundle of our own, ADR 0054)
  if (process.platform === 'darwin') app.dock?.setIcon(path.join(outDir, 'icon.png'));
  log.info('app', 'start', { data: { version: app.getVersion(), electron: process.versions.electron, userData: app.getPath('userData') } });
  win = createWindow(outDir, false);
  // Attach before starting services: ready-to-show may fire while their asynchronous initialization is pending.
  const windowReady = new Promise<void>(resolve => win!.once('ready-to-show', resolve));
  const emitter = new Emitter(() => win?.webContents ?? null);
  // engines' Job Objects (ADR 0026): the helper loads while the services start; engines started before it is ready wait
  if (process.env.SB_DEMO !== '1') jobGuard.start(path.join(app.getPath('userData'), 'jobguard'));
  const s = await createServices({ emitter, window: () => win, userData: app.getPath('userData') });
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
  const brainCreation = new BrainCreationController({
    creator: new BrainCreator({ appPath: app.getAppPath(), node: electronNode() }), disabled: demo,
    chooseParent: async folderName => {
      const result = win ? await dialog.showOpenDialog(win, { title: `Dove creare la nuova cartella «${folderName}»`, buttonLabel: 'Crea qui', properties: ['openDirectory'] }) : null;
      return result && !result.canceled ? result.filePaths[0] ?? null : null;
    }, currentRoot: () => s.brain.settings().brainRoot, selectionRevision: () => brainChoiceRevision, engineKnown: id => !!engineOf(id),
    connect: async root => { await s.brain.setSettings({ brainRoot: root }); },
  });
  const profile = new ProfileService({ root: () => s.brain.settings().brainRoot, template: (() => { try { return fs.readFileSync(path.join(app.getAppPath(), 'brain-template', 'me.template.md'), 'utf8'); } catch { return ''; } })() });
  const defaultBrain = new DefaultBrain({ userData: app.getPath('userData'), templateRoot: path.join(app.getAppPath(), 'brain-template'), current: () => s.brain.settings().brainRoot, usable: () => !s.brain.info().brainProblem, revision: () => brainChoiceRevision, connect: async root => { await s.brain.setSettings({ brainRoot: root }); } });
    const updates = createAppUpdates({ appPath: app.getAppPath(), userData: app.getPath('userData'), running: stable.release, version: app.getVersion(), disabled: demo || !!process.env.SB_TEST,
      emitter, problem: () => s.updateChats?.problem() ?? null, saveChats: () => { if (!s.updateChats) throw new Error('Salvataggio chat non disponibile.'); s.updateChats.checkpoint(); },
      flush: () => win?.webContents.session.flushStorageData(), quit: () => app.quit(),
    });
  const orchestrator = new OrchestratorService(s.chats, () => s.brain.info().brainRoot, {
    route: r => s.brain.route(r), engineOn: h => engineOn(s.brain.settings(), h), agentsMayOpen: h => agentsMayOpen(s.brain.settings(), h),
    regiaChats: () => s.brain.settings().regiaChats,
  });
  // the Grindhouse's headline (SPEC 18): never a model call in the demo or under test
  const readBrain = (rel: string): string => {
    const root = demo ? null : s.brain.info().brainRoot;
    try { return root ? fs.readFileSync(path.join(root, rel), 'utf8').slice(-20_000) : ''; } catch { return ''; }
  };
  const headline = new Headline({
    file: path.join(app.getPath('userData'), 'headline.json'),
    complete: (req, signal) => s.engines.text.complete(req, signal),
    settings: () => s.brain.settings(),
    lang: () => { const l = s.brain.settings().language; return l === 'it' || l === 'en' ? l : systemLang(); },
    material: () => {
      const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { chats: s.chats.list(), nowMd: readBrain('now.md'), journal: readBrain(path.join('journal', `${day}.md`)), aiErrors: readBrain('ai-errors.md') };
    },
    visible: () => !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized(),
    emit: st => emitter.emit('headline:changed', st),
    calls: !demo && !process.env.SB_TEST,
    ...(demo && process.env.SB_DEMO_FREEZE === '1' ? { now: () => FROZEN_EPOCH } : {}),
  });
  const pulse = createPulse(s, { emitter, window: () => win, userData: app.getPath('userData') }, () => headline.get());
  const unsubscribePulse = s.brain.onSettingChange(change => { if (change.key.startsWith('pulse.') || change.key === 'jobs.fallback') pulse?.start(); });
    const connectors = createAppConnectors(app.getPath('userData'), () => s.devops.refreshFresh());
    await connectors.ready;
    const handlers: Handlers = {
      'connectors:list': () => connectors.service.list(),
      'connectors:login': a => connectors.service.login(a?.provider),
      'connectors:cancelLogin': () => connectors.service.cancelLogin(),
      'connectors:probe': a => connectors.service.probe(a?.provider),
      'connectors:select': a => connectors.service.select(a?.provider, a?.projects),
      'connectors:disconnect': a => connectors.service.disconnect(a?.provider),
      'update:get': () => updates.state(),
      'update:apply': a => updates.apply(a?.id),
      'update:checkpointAnswer': a => updates.answer(a),
      'update:recovery': () => updates.recovery(),
      'update:recoveryAck': a => updates.acknowledge(a?.id),
    'app:brainCreation': () => brainCreation.capability(),
    'app:brainCandidates': () => findBrainCandidates(process.env.SB_HOME),
    'app:createBrain': a => a?.automatic === true ? defaultBrain.ensure(a.language, a.harness) : brainCreation.create(a),
    'improve:proposals': () => s.proposals.list(),
    'improve:proposalAvailability': () => s.proposals.availability(),
    'improve:proposalCreate': () => s.proposals.create(),
    'improve:proposalRefresh': a => s.proposals.refresh(a?.id),
    'improve:proposalResume': a => s.proposals.resume(a?.id),
    'improve:proposalPublish': a => s.proposals.publish(a),
    'progress:get': () => s.progress.get(),
    'progress:setHidden': a => s.progress.setHidden(a?.hidden),
    'progress:confirmResult': a => s.progress.confirmResult(a?.chatId, a?.resultAt),
    'chat:autoCloseGet': () => { s.autoClose.refresh(); return s.autoClose.state(); },
    'chat:autoClosePresence': a => s.autoClose.setPresence(Array.isArray(a?.holds) ? a.holds : []),
    'chat:autoCloseKeep': a => { if (typeof a?.chatId !== 'string' || typeof a.keep !== 'boolean') throw new Error('Richiesta non valida.'); s.autoClose.keepOpen(a.chatId, a.keep); },
    'agents:list': () => s.agents.list(),
    'agents:classify': a => {
      if (!s.classifyAgents) throw Error('agent classifier unavailable');
      return s.classifyAgents(a?.request);
    },
    'agents:save': a => s.agents.save(a.profile, a.id),
    'agents:duplicate': a => s.agents.duplicate(a.id),
    'agents:archive': a => s.agents.archive(a.id),
    'agents:restore': a => s.agents.restore(a.id),
    'agents:history': a => s.agents.history(a.id),
    'agents:keep': a => s.agents.keep(a?.id, 'brother'),
    'agents:retire': a => s.agents.retire(a?.id, typeof a?.reason === 'string' ? a.reason.slice(0, 600) : '', 'brother'),
    'run:outcome': a => markRunOutcome(s.chats, a),
    'agents:metrics': a => {
      const root = demo ? null : s.brain.info().brainRoot;
      let aiErrors: string | undefined;
      try { if (root) aiErrors = fs.readFileSync(path.join(root, 'ai-errors.md'), 'utf8'); } catch { aiErrors = undefined; }
      const tag = (v: unknown) => typeof v === 'string' && v.length <= 120 ? v : undefined;
      const skill = tag(a?.skill), app = tag(a?.app), repo = tag(a?.repo);
      return s.chats.runMetrics?.({ ...(aiErrors !== undefined ? { aiErrors } : {}), ...(typeof a?.since === 'number' ? { since: a.since } : {}),
        ...(skill !== undefined ? { skill } : {}), ...(app !== undefined ? { app } : {}), ...(repo !== undefined ? { repo } : {}) }) ?? [];
    },
    'agents:restoreVersion': a => s.agents.restoreVersion(a.id, a.version),
    'agents:draft': a => s.agents.draft(a),
    'setup:get': () => s.setup.get(),
    'setup:save': a => s.setup.save(a.preferences, a.status),
    'profile:get': () => profile.get(),
    'profile:save': a => profile.save(a),
    'app:info': () => ({ version: app.getVersion(), ...s.brain.info(), mcpUrl: s.browser.mcpUrlFor(null), cli: s.cli(), engines: engineInfos(), health: healthSnapshot(), systemLang: systemLang() }),
    'app:pickRepo': async () => {
      const result = win ? await dialog.showOpenDialog(win, { title: 'Scegli un repository per Codex', properties: ['openDirectory'] }) : null;
      const selected = result && !result.canceled ? result.filePaths[0] : null;
      if (!selected) return null;
      try { return canonicalRepoRoot(selected); }
      catch { throw new Error('Scegli la cartella principale di un repository Git o worktree locale, senza collegamenti o condivisioni.'); }
    },
    'app:pickBrain': async () => {
      const r = win ? await dialog.showOpenDialog(win, { title: 'Scegli la cartella del cervello', properties: ['openDirectory'] }) : null;
      const dir = r && !r.canceled ? r.filePaths[0] ?? null : null;
      if (dir) { brainChoiceRevision++; await s.brain.setSettings({ brainRoot: dir }); }
      return dir;
    },
    // an agent's run (SB_HIDDEN, the e2e suite) never opens Explorer: it records what it would have shown
    'app:showInFolder': a => showLocal(String(a?.path ?? '').slice(0, 4096), hiddenRun() ? hiddenShell : shell),
    'app:peekFile': a => peekFile(String(a?.path ?? '').slice(0, 1000), typeof a?.cwd === 'string' ? a.cwd : undefined),
    'app:readFile': a => {
      const chat=typeof a?.chatId==='string'?s.chats.list().find(chat=>chat.id===a.chatId):undefined;
      const brainRoot=demo?process.env.SB_BRAIN:s.brain.info().brainRoot;
      const count=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>0?n:undefined;
      return readFileView(typeof a?.path==='string'?a.path:'',{cwd:chat?.cwd??brainRoot??undefined,offset:count(a?.offset),align:a?.align===true,before:count(a?.before),line:count(a?.line)});
    },
    'app:readFileDiff': a => {
      const chat=typeof a?.chatId==='string'?s.chats.list().find(chat=>chat.id===a.chatId):undefined;
      const brainRoot=demo?process.env.SB_BRAIN:s.brain.info().brainRoot;
      const w=a?.against;
      const against:DiffAgainst|null=w?.kind==='head'?{kind:'head'}:w?.kind==='ref'&&typeof w.ref==='string'?{kind:'ref',ref:w.ref}:w?.kind==='file'&&typeof w.path==='string'?{kind:'file',path:w.path}:null;
      if(!against)return {kind:'refused',reason:'ref'};
      return readFileDiff(typeof a?.path==='string'?a.path:'',against,chat?.cwd??brainRoot??undefined);
    },
    'app:askImage': a => readAskImage(String(a?.path ?? '').slice(0, 1000), askImageRoots({
      userData: app.getPath('userData'), appData: app.getPath('appData'), brainRoot: demo ? process.env.SB_BRAIN ?? null : s.brain.info().brainRoot,
      repos: [s.brain.settings().appRepo, fs.existsSync(path.join(outDir, '..', '.git')) ? path.dirname(outDir) : null],
    })),
    'app:usage': () => s.brain.usage(),
    'cli:status': a => engineStatus(a.harness, a.checkLogin !== false),
    'cli:login': a => openLogin(a.harness),
    'chat:list': () => s.chats.list(),
    'chat:items': a => s.chats.items(a.chatId),
    'chat:pending': () => [...s.chats.pending(), ...s.asks.pending()].sort((a, b) => a.at - b.at),
    'chat:create': a => s.chats.create(a),
    // a chat from a record (DevOps "Apri chat"): the routing table picks the engine, model and effort (ADR 0032)
    'chat:createRouted': a => createRoutedChat({ route: r => s.brain.route(r), engineOn: h => engineOn(s.brain.settings(), h), agentsMayOpen: h => agentsMayOpen(s.brain.settings(), h), create: r => s.chats.create(r) }, a, { byUser: true }),
    'routing:preview': a => previewRoute({ route: r => s.brain.route(r), engineOn: h => engineOn(s.brain.settings(), h), agentsMayOpen: h => agentsMayOpen(s.brain.settings(), h) }, a),
    'chat:send': async a => { await s.chats.send(a.chatId, a.text, a.images); s.chats.resumedByUser?.(a.chatId, a.text); },
    'chat:answer': a => s.chats.answer(a.chatId, a.requestId, a.answer),
    'chat:stop': a => s.chats.stop(a.chatId, a.keepQueued === true),
    'chat:stopAll': () => s.chats.stopAll(),
    'chat:close': a => s.chats.close(a.chatId),
    'chat:archive': a => s.chats.archive(a.chatId, { auto: a.auto === true }),
    'chat:reopen': async a => { const c = await s.chats.reopen(a.chatId); s.chats.resumedByUser?.(a.chatId); return s.chats.list().find(x => x.id === a.chatId) ?? c; },
    'chat:admitNow': a => s.chats.admitNow(a.chatId),
    'chat:set': ({ chatId, ...patch }) => s.chats.set(chatId, patch),
    'chat:handoff': a => s.chats.handoff(a.chatId, { reason: 'manual' }),
    'chat:handoffRead': a => s.chats.readHandoff(a.chatId, typeof a.session === 'string' ? a.session : undefined),
    'chat:continue': a => s.chats.continueChat(a.chatId),
    'browser:list': () => s.browser.list(),
    'browser:open': a => s.browser.open(a.url, a.ownerChatId ?? null, a.env),
    'browser:navigate': a => s.browser.navigate(a.tabId, a.url),
    'browser:go': a => s.browser.go(a.tabId, a.dir),
    'browser:close': a => s.browser.close(a.tabId),
    'views:layout': a => s.browser.layout(a),
    'browser:handoffs': () => s.browser.handoffs(),
    'browser:handoffResolve': a => s.browser.resolveHandoff(a.id, a.outcome, a.note),
    'browser:handoffCopy': a => s.browser.copyFromHandoff(a.id, a.field),
    'browser:envList': () => s.browser.envs(),
    'credentials:list': () => s.browser.credentials(),
    'credentials:copy': a => s.browser.copyCredential(a.id, a.field),
    'feed:list': () => s.brain.feed(),
    'feed:mute': a => s.brain.mute(a.kind, a.muted),
    'settings:get': () => s.brain.settings(),
    // API keys: write-only from the page, never returned (engines/secrets.ts); no MCP tool reaches these
    'secrets:status': () => s.engines.secretsStatus(),
    'secrets:set': a => s.engines.setSecret(a.engine, a.key),
    'secrets:delete': a => s.engines.deleteSecret(a.engine),
    'engines:trust': a => s.engines.trust(a.engine),
    'engines:spend': () => s.engines.apiSpend(),
    'settings:set': a => s.brain.setSettings(a),
    'settings:schema': () => s.brain.settingsSchema(),
    'settings:history': a => s.brain.settingsHistory(a?.limit),
    'settings:undo': a => s.brain.undoSetting(a?.changeId, 'user'),
    // the page relays an agent's request (e.g. from a chat tile): an agent's, never counted as the user's ok
    'settings:propose': a => s.brain.requestSetting(a?.key, a?.value, { by: 'agent', ...(a?.chatId ? { chatId: String(a.chatId) } : {}), ...(a?.reason ? { reason: String(a.reason) } : {}) }),
    'settings:pending': () => s.brain.pendingSettings(),
    'settings:confirm': a => s.brain.confirmSetting(a?.proposalId, a?.accept),
    'estimate:record': a => s.brain.recordJob(a),
    'brain:api': a => s.brain.api(a?.path),
    'compare:list': () => s.brain.compareList(),
    'compare:set': a => s.brain.compareSet(a?.experiment, a?.on, a?.agent),
    'learn:act': a => s.brain.learnAct(a),
    'models:seen': () => withApiModels(s.brain.modelsSeen()),
    'routing:get': () => s.brain.routingInfo(),
    // the renderer is the user's (sender check in ipc.ts): agents never reach this write, they only propose in chat
    'routing:save': a => s.brain.saveRouting(Array.isArray(a?.routes) ? a.routes : [], typeof a?.reason === 'string' && a.reason.trim() ? a.reason.trim().slice(0, 300) : null,
      { ...(a?.exploration !== undefined ? { exploration: Number(a.exploration) } : {}), ...(a?.costWeight !== undefined ? { costWeight: Number(a.costWeight) } : {}),
        ...(Number.isInteger(a?.baseVersion) ? { base: a.baseVersion } : {}) }),
    'routing:restore': a => s.brain.restoreRouting(Number(a?.version)),
    'devops:get': () => s.devops.get(),
    'devops:refresh': () => s.devops.refresh(),
    // only the folders of the app's own chats, never a network path (a stat on \\host\share would reach out)
    'chat:branches': a => {
      const known = new Set(s.chats.list().map(c => c.cwd));
      const cwds = Array.isArray(a?.cwds) ? a.cwds.filter(c => typeof c === 'string' && known.has(c) && !/^[\\/]{2}/.test(c)) : [];
      return (s.branches ?? gitBranches)(cwds);
    },
    'devops:markRead': a => s.devops.markRead(Array.isArray(a?.keys) ? a.keys.filter((k): k is string => typeof k === 'string').slice(0, 2000) : undefined),
    'overlay:model': a => overlay.setModel(a),
    'overlay:size': a => overlay.setSize(a.width, a.height),
    'app:inputLag': a => logInputLag(a),
    'overlay:action': a => overlay.relay(a),
    'overlay:focus': a => overlay.focus(a.target),
    // a run answers the "Comando da eseguire" request of that block (Esegui on the card or under the block)
    'run:start': a => { const run = s.runner.start(a); s.asks.ran(run.chatId, run.itemId, run.code); return run; },
    'run:dismiss': a => s.asks.dismiss(a.chatId, a.requestId),
    'run:stop': a => s.runner.stop(a.runId),
    'run:list': a => s.runner.list(a?.chatId),
    'skills:list': () => s.skills.list(),
    'skills:read': a => s.skills.read(String(a?.id ?? '')),
    'skills:save': a => s.skills.save(a),
    'skills:delete': a => s.skills.remove(String(a?.id ?? '')),
    // the engine's own list when it reported one, else its skills on disk for the chat's folder
    'chat:commands': a => {
      const c = s.chats.list().find(x => x.id === a?.chatId);
      return c ? s.chats.commands(c.id) ?? s.skills.commandsFor(c.harness, c.cwd) : [];
    },
    // "Migliora l'app" (ADR 0020): promote and restart only on the user's click, never from an agent's tool
    'improve:get': a => (a?.refresh || !s.improve.state().at ? s.improve.refresh() : s.improve.state()),
    'improve:promote': () => s.improve.promote(),
    'improve:regia': a => orchestrator.ensure(a),
    'orchestrator:get': () => orchestrator.get(),
    'orchestrator:ensure': a => orchestrator.ensure(a),
    'improve:dismissLaunch': () => s.improve.dismissLaunch(),
    'clipboard:image': a => readClipboardImage(clip, Array.isArray(a?.seen) ? a.seen.filter((t): t is string => typeof t === 'string').slice(0, 20) : []),
    'search:query': a => search.query(String(a?.q ?? '')),
    'search:status': async () => s.hybrid?.status() ?? { model: { state: 'missing' }, docs: 0, chunks: 0, vectors: 0, vec: false },
    'search:retryModel': async () => s.hybrid ? s.hybrid.retryModel() : { model: { state: 'missing' }, docs: 0, chunks: 0, vectors: 0, vec: false },
    'later:get': () => s.later.get(),
    'later:set': a => s.later.set(a?.on === true),
    'sync:get': () => s.brain.syncState(),
    'sync:now': a => s.brain.syncNow(a?.domain),
    'sync:resolve': a => s.brain.syncResolve(a?.domain, a?.choice),
    'headline:get': () => pulse?.headline() ?? headline.get(),
    ...(pulse?.handlers() ?? (demo ? pulseDemoHandlers(process.env.SB_DEMO_FREEZE === '1' ? FROZEN_EPOCH : Date.now(), {
      settings: () => s.brain.settings().pulse, changed: () => emitter.emit('pulse:changed', undefined), approvalsChanged: () => emitter.emit('approvals:changed', undefined),
    }) : pulseStubHandlers())),
  };
  registerHandlers(handlers, () => win?.webContents ?? null, { contents: () => overlay.contents, channels: ['overlay:size', 'overlay:action', 'overlay:focus'] });
  // Recovery starts before the renderer store: its IPC must already be registered on the first navigation.
  void win.loadURL(pathToFileURL(path.join(outDir, 'renderer', 'index.html')).href);
  const prepareUpdates = setTimeout(() => { void updates.prepare(); }, 45_000); prepareUpdates.unref();
  // the hybrid brain search (SPEC 23) indexes in its worker a little after the window is up (never delaying the start)
  const startSearch = setTimeout(() => s.hybrid?.start(), 5_000); startSearch.unref();
  // the headline's first refresh waits for the window and the start's own work (it is never on the start's path)
  void windowReady.then(() => { if (pulse) pulse.start(); });
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
    headline.stop();
    pulse?.stop(); unsubscribePulse();
    log.info('app', 'quit started');
    // the stable launcher (scripts/release.mjs) waits for a quitting app to go before starting again; an open one it leaves be
    try { fs.writeFileSync(path.join(app.getPath('userData'), 'quitting.json'), JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); } catch { /* best effort */ }
    const cap = new Promise<void>(r => setTimeout(r, 6000));
    void Promise.race([s.shutdown(), cap])
      .catch(err => log.warn('app', 'shutdown failed', { data: String(err) }))
      .finally(async () => {
        s.killNow();
        // app.exit skips Chromium's own shutdown: the app page's localStorage (layout, Regia widget state) written in
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

app.on('second-instance', () => { if (win && !hiddenRun()) { if (win.isMinimized()) win.restore(); win.focus(); } });
