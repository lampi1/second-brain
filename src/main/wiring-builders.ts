// Two self-contained steps of createServices (wiring.ts), each building one service from what is already wired and
// called at the same point of the start as before: the user's personal Browser page (ADR 0133) and Impara (ADR 0185,
// 0188). Kept apart so wiring.ts stays readable; the construction order is wiring.ts's.
import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import { PersonalBrowser } from './personal/browser';
import { LessonStore } from './learn/store';
import { LearnService, type TeachRun } from './learn/service';
import { runRead } from './learn/material';
import { appGuide, teacherOption } from './learn/sources';
import { systemLang } from './lang';
import { uiLang } from './locale';
import { safeStorageCipher } from './engines/secrets';
import { engineInfos } from './engines/registry';
import { withApiModels } from './engines/sessions';
import { engineOn } from './engines/policy';
import type { BrainService, ChatService } from './services';
import type { ChatManager } from './chats/manager';
import type { TaskService } from './tasks/service';
import type { HeadlessRunner } from './compare/headless';
import type { Ctx, Wired } from './wiring-types';

/** The user's own everyday browser, the Browser page (personal/browser.ts, ADR 0133). */
export function buildPersonal(ctx: Ctx, brain: BrainService, browser: Wired['browser'], chats: ChatService, manager: ChatManager): PersonalBrowser {
  const personalLang = () => { const l = brain.settings().language; return l === 'it' || l === 'en' ? l : systemLang(); };
  return new PersonalBrowser({
    emitter: ctx.emitter, window: ctx.window, userData: ctx.userData, cipher: safeStorageCipher(safeStorage), appName: app.getName(), lang: personalLang,
    // «Affida a un agente» (ADR 0133): only a live chat whose role drives a browser gets the tab, told by an app message
    lend: (chatId, view, back) => ({ tabId: browser.lend!(chatId, view, back).id }),
    reclaim: agentTab => browser.close(agentTab),
    canLend: chatId => {
      const it = personalLang() === 'it';
      const c = chats.list().find(x => x.id === chatId);
      if (!c || c.closedAt || c.quick) return it ? 'Chat non trovata o chiusa.' : 'Chat not found or closed.';
      return manager.browserAccess(chatId) === 'all' ? null : it ? 'Questo agente non usa il browser: scegline un altro.' : 'This agent does not drive a browser: pick another one.';
    },
    tell: (chatId, text) => chats.send(chatId, text),
  });
}

/** Impara (learn/service.ts): lessons researched and written by hidden read-only runs on the engines that are on. */
export function buildLearn(ctx: Ctx, brain: BrainService, tasks: TaskService, headless: HeadlessRunner): LearnService {
  // Impara (ADR 0185, 0188): each lesson is researched, verified and written by hidden read-only runs
  // (compare/headless.ts) on the engine the user picked (else the best one that is on and reads files: Claude first,
  // its strongest model); the web research and its check always on Claude, the only engine whose run can have the web
  // tools and no file tool; the material gathered by the app with the user's own gh / git
  const teachers = () => engineInfos().filter(e => e.kind !== 'api' && e.caps.tools && engineOn(brain.settings(), e.id));
  const teacher = () => { const all = teachers(); return all.find(e => e.kind === 'claude') ?? all[0] ?? null; };
  return new LearnService({
    store: new LessonStore(path.join(ctx.userData, 'learn')), lang: uiLang, run: runRead,
    devops: () => { const t = tasks.get(); return { prs: t.prs, repoDirs: t.repoDirs }; },
    cannotTeach: () => (teacher() ? null : 'Per preparare una lezione serve un motore acceso che legge i file (Impostazioni → Motori).'),
    teachers: () => { const seen = withApiModels(brain.modelsSeen()); return teachers().map(e => teacherOption(e, seen[e.id]?.ids ?? [])); },
    webOk: () => teachers().some(e => e.kind === 'claude'),
    places: () => {
      const repo = brain.settings().appRepo || app.getAppPath();
      return { brain: brain.info().brainRoot || null, appSource: repo && fs.existsSync(path.join(repo, 'src')) ? repo : null };
    },
    guide: appGuide,
    teach: async (r: TeachRun) => {
      const all = teachers();
      const picked = r.teacher ? all.find(e => e.id === r.teacher!.engine) ?? null : null;
      const e = r.web ? all.find(x => x.kind === 'claude') ?? null : picked ?? teacher();
      if (!e) return { ok: false, error: r.web ? 'Claude è spento' : 'nessun motore acceso' };
      // the user's model on the engine they picked; Claude's strongest otherwise
      const model = r.teacher?.engine === e.id && r.teacher.model ? r.teacher.model : e.kind === 'claude' ? 'opus' : null;
      const out = await headless.run({ engine: e.id, model, effort: e.caps.effort ? r.effort : null, cwd: r.cwd, prompt: r.prompt, round: r.round, timeoutMs: r.timeoutMs, ...(r.web ? { web: true } : {}), ...(r.onText ? { onText: r.onText } : {}) });
      return out.ok ? { ok: true, text: out.text, costUsd: out.costUsd, engine: e.id, model: out.model } : { ok: false, error: out.error };
    },
    changed: (state, lesson) => ctx.emitter.emit('impara:changed', { state, ...(lesson ? { lesson } : {}) }),
    tutorText: (lesson, turn, text) => ctx.emitter.emit('impara:tutor', { lesson, turn, text }),
  });
}
