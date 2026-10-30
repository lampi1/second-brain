// IPC handlers, App: info and usage, the folder pickers and the file viewer, CLI status, «Aggiorna» (source, update),
// setup and profile, the global layer, the Task page, search, the Log, the headline. Registered by src/main/index.ts
// with every other group (Handlers in ipc.ts keeps the set complete); each channel's shape is in
// src/shared/contract/*.ts.
import type { DiffAgainst } from '../../shared/file-diff';
import { app, clipboard, ClipboardItem, dialog, nativeImage, shell } from 'electron';
import { askImageRoots, readAskImage } from '../ask-image';
import { canonicalRepoRoot } from '../brain/adapters/codex-policy';
import { detectProjectsFolder } from '../brain/projects-folder';
import { engineInfos } from '../engines/registry';
import { engineStatus, openLogin } from '../cli';
import fs from 'node:fs';
import { healthSnapshot } from '../health';
import { hiddenRun } from '../window';
import { logInputLag } from '../perf';
import path from 'node:path';
import { readFileDiff } from '../file-diff';
import { readFileView } from '../file-view';
import { copyFile, type ClipboardLike } from '../file-copy';
import { showLocal } from '../open-path';
import { systemLang } from '../lang';
import type { HandlerContext, HandlersOf } from './context';

const CLIPBOARD: ClipboardLike = {
  writeText: t => clipboard.writeText(t),
  writeRaw: (f, b) => clipboard.write([new ClipboardItem({ [`electron application/osclipboard;format="${f}"`]: new Blob([new Uint8Array(b)]) })]),
  writeImageFromPath: async p => {
    const img = nativeImage.createFromPath(p);
    if (img.isEmpty()) return false;
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(img.toPNG())], { type: 'image/png' }) })]);
    return true;
  },
};
const HIDDEN_CLIPBOARD: ClipboardLike = { writeText: async () => {}, writeRaw: async () => {}, writeImageFromPath: async () => true };

export function appHandlers({ s, win, demo, outDir, activity, overlay, profile, defaultBrain, updates, headline, pulse, search, hiddenShell, bumpBrainChoice, rendererErrors }: HandlerContext): HandlersOf<'app' | 'cli' | 'source' | 'update' | 'setup' | 'profile' | 'overlay' | 'log' | 'headline' | 'search' | 'tasks' | 'feed'> {
  return {
    'update:get': () => updates.state(),
    'update:apply': a => updates.apply(a?.id),
    'update:checkpointAnswer': a => updates.answer(a),
    'update:recovery': () => updates.recovery(),
    'update:recoveryAck': a => updates.acknowledge(a?.id),
    // read only: folder names and .git presence (projects-folder.ts); SB_HOME isolates it in trials, like the candidates
    'app:projectsFolder': () => ({ saved: s.brain.settings().projectsRoot ?? null, detected: detectProjectsFolder({ home: process.env.SB_HOME, exclude: [s.brain.settings().brainRoot, app.getPath('userData')] }), newMemoryIn: app.getPath('userData') }),
    'app:pickProjects': async () => {
      const w = win(), r = w ? await dialog.showOpenDialog(w, { title: 'Scegli la cartella dei tuoi progetti', properties: ['openDirectory'] }) : null;
      const dir = r && !r.canceled ? r.filePaths[0] ?? null : null;
      if (dir) await s.brain.setSettings({ projectsRoot: dir });
      return dir;
    },
    // the first setup's new memory, in the app's data folder (the only way the app creates one)
    'app:createBrain': a => defaultBrain.ensure(a?.language, a?.harness),
    'setup:get': () => s.setup.get(),
    'setup:save': a => s.setup.save(a.preferences, a.status),
    'profile:get': () => profile.get(),
    'profile:save': a => profile.save(a),
    'app:info': () => ({ version: app.getVersion(), ...s.brain.info(), mcpUrl: s.browser.mcpUrlFor(null), cli: s.cli(), engines: engineInfos(), health: healthSnapshot(), systemLang: systemLang() }),
    'app:pickRepo': async () => {
      const w = win(), result = w ? await dialog.showOpenDialog(w, { title: 'Scegli un repository per Codex', properties: ['openDirectory'] }) : null;
      const selected = result && !result.canceled ? result.filePaths[0] : null;
      if (!selected) return null;
      try { return canonicalRepoRoot(selected); }
      catch { throw new Error('Scegli la cartella principale di un repository Git o worktree locale, senza collegamenti o condivisioni.'); }
    },
    'app:pickBrain': async () => {
      const w = win(), r = w ? await dialog.showOpenDialog(w, { title: 'Scegli la cartella del cervello', properties: ['openDirectory'] }) : null;
      const dir = r && !r.canceled ? r.filePaths[0] ?? null : null;
      if (dir) { bumpBrainChoice(); await s.brain.setSettings({ brainRoot: dir }); }
      return dir;
    },
    // an agent's run (SB_HIDDEN, the e2e suite) never opens Explorer: it records what it would have shown
    'app:showInFolder': a => showLocal(String(a?.path ?? '').slice(0, 4096), hiddenRun() ? hiddenShell : shell),
    // an agent's hidden run never overwrites the user's clipboard: the copy is checked and dropped
    'app:copyFile': a => copyFile(String(a?.path ?? '').slice(0, 4096), hiddenRun() ? HIDDEN_CLIPBOARD : CLIPBOARD),
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
    'feed:list': () => s.brain.feed(),
    'tasks:get': () => s.tasks.get(),
    'tasks:refresh': () => s.tasks.refresh(),
    'tasks:markRead': a => s.tasks.markRead(Array.isArray(a?.keys) ? a.keys.filter((k): k is string => typeof k === 'string').slice(0, 2000) : undefined),
    'overlay:model': a => overlay.setModel(a),
    'overlay:size': a => overlay.setSize(a.width, a.height),
    'app:inputLag': a => logInputLag(a),
    'log:renderer': a => { rendererErrors.report(a); },
    'overlay:action': a => overlay.relay(a),
    'overlay:focus': a => overlay.focus(a.target),
    // "Aggiorna" (Settings → Aggiornamenti, ADR 0075): update and restart only on the user's click, never from an agent's tool
    'source:get': a => (a?.refresh || !s.source.state().at ? s.source.refresh() : s.source.state()),
    'source:dismissLaunch': () => s.source.dismissLaunch(),
    'source:check': () => s.source.sourceCheck(),
    'source:updateNow': () => s.source.updateNow(),
    'search:query': async a => { await s.memoryReview?.retryInvalidations(); return search.query(String(a?.q ?? '')); },
    'search:status': async () => s.hybrid?.status() ?? { model: { state: 'missing' }, docs: 0, chunks: 0, vectors: 0, vec: false },
    'search:retryModel': async () => s.hybrid ? s.hybrid.retryModel() : { model: { state: 'missing' }, docs: 0, chunks: 0, vectors: 0, vec: false },
    'headline:get': () => pulse?.headline() ?? headline.get(),
    'log:list': () => activity.list(),
  };
}
