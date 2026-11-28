// A self-contained step of createServices (wiring.ts), building one service from what is already wired and called at
// the same point of the start as before: Impara (ADR 0185, 0188; the personal Browser page left with ADR 0212) and its
// «News» (ADR 0265). Kept apart so wiring.ts stays readable; the construction order is wiring.ts's.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { LessonStore } from './learn/store';
import { LearnService, type TeachRun } from './learn/service';
import { NewsService, netFetch, type NewsFetch } from './news/service';
import { timersFor } from './timers';
import { runRead } from './learn/material';
import { appGuide, teacherOption } from './learn/sources';
import { AcceptedModels, parseModelRefusal, probeAccepted } from './learn/accepted-models';
import { MODEL_REFUSED } from '@shared/lesson';
import { errText, log } from './log';
import { uiLang } from './locale';
import { engineInfos } from './engines/registry';
import { withApiModels } from './engines/sessions';
import { engineOn } from './engines/policy';
import { electronNode, runNode } from './brain/node';
import { ActivitiesService } from './activities/service';
import { devopsReader } from './activities/sources/devops';
import { mcpReader, outlookConfig, teamsConfig } from './activities/sources/mcp';
import { createGmailReader } from './activities/sources/gmail';
import { defaultLocate } from './tasks/service';
import type { ActivitySource, ActivitySourceReader } from '../shared/activities';
import type { McpServersService } from './mcp-servers/service';
import type { OrchestratorWake } from './chats/orchestrator-wake';
import type { BrainService } from './services';
import type { TaskService } from './tasks/service';
import type { HeadlessRunner } from './compare/headless';
import type { Ctx } from './wiring-types';

/** Impara (learn/service.ts): lessons researched and written by hidden read-only runs on the engines that are on. */
export function buildLearn(ctx: Ctx, brain: BrainService, tasks: TaskService, headless: HeadlessRunner): LearnService {
  // Impara (ADR 0185, 0188): each lesson is researched, verified and written by hidden read-only runs
  // (compare/headless.ts) on the engine the user picked (else the best one that is on and reads files: Claude first,
  // its strongest model); the web research and its check always on Claude, the only engine whose run can have the web
  // tools and no file tool; the material gathered by the app with the user's own gh / git
  const teachers = () => engineInfos().filter(e => e.kind !== 'api' && e.caps.tools && engineOn(brain.settings(), e.id));
  const teacher = () => { const all = teachers(); return all.find(e => e.kind === 'claude') ?? all[0] ?? null; };
  // the models each engine's hidden runs take on their command line (learn/accepted-models.ts): Cursor's differ from
  // the ids its chats list, so it is asked once (a refused probe, no model runs) and any later refusal updates it
  const accepted = new AcceptedModels(path.join(ctx.userData, 'learn', 'accepted-models.json'));
  const probed = new Set<string>();
  const probe = (id: string) => {
    if (probed.has(id) || accepted.get(id)) return;
    probed.add(id);
    const cwd = path.join(ctx.userData, 'learn', 'probe');
    fs.mkdirSync(cwd, { recursive: true });
    void probeAccepted(id, accepted, model => headless.run({ engine: id, model, effort: null, cwd, prompt: 'Rispondi solo: ok', round: 'impara-models', timeoutMs: 60_000, noTools: true }))
      .then(ok => { if (ok) ctx.emitter.emit('impara:changed', { state: learn.state() }); })
      .catch(() => { /* the list stays unknown: the form offers auto only */ });
  };
  const learn: LearnService = new LearnService({
    store: new LessonStore(path.join(ctx.userData, 'learn')), lang: uiLang, run: runRead,
    devops: () => { const t = tasks.get(); return { prs: t.prs, repoDirs: t.repoDirs }; },
    cannotTeach: () => (teacher() ? null : 'Per preparare una lezione serve un motore acceso che legge i file (Impostazioni → Motori).'),
    teachers: () => {
      const seen = withApiModels(brain.modelsSeen());
      return teachers().map(e => { if (e.id === 'cursor') probe(e.id); return teacherOption(e, seen[e.id]?.ids ?? [], accepted.get(e.id)); });
    },
    webOk: () => teachers().some(e => e.kind === 'claude'),
    away: () => brain.settings().awayMode === true,
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
      if (out.ok) return { ok: true, text: out.text, costUsd: out.costUsd, engine: e.id, model: out.model, ...(out.deniedTools ? { deniedTools: out.deniedTools } : {}) };
      // the engine took no such model: its list is kept (the form offers only those now) and the lesson says why
      // a file that cannot be written (locked by an antivirus) never hides the refusal itself
      if (out.acceptedModels) try { accepted.learn(e.id, out.acceptedModels, out.acceptedPartial === true); } catch (err) { log.warn('learn', 'accepted models not saved', { cause: errText(err), data: { engine: e.id } }); }
      const refused = parseModelRefusal(out.error);
      return { ok: false, error: refused ? `${MODEL_REFUSED}${refused.model}` : out.error };
    },
    changed: (state, lesson) => ctx.emitter.emit('impara:changed', { state, ...(lesson ? { lesson } : {}) }),
    tutorText: (lesson, turn, text) => ctx.emitter.emit('impara:tutor', { lesson, turn, text }),
  });
  return learn;
}

/** Impara «News» (ADR 0265): the sources read with the app's own requests (none in the tests), one AI pass per refresh
 *  on Claude (a hidden run with no tool, Sonnet at low effort: summaries, not research), its tokens as Claude reports
 *  them. The daily refresh runs on the app's timers. */
export function buildNews(ctx: Ctx, brain: BrainService, headless: HeadlessRunner): NewsService {
  const claude = () => engineInfos().find(e => e.kind === 'claude' && engineOn(brain.settings(), e.id)) ?? null;
  const offline: NewsFetch = async () => { throw new Error('rete spenta nei test'); };
  const t = timersFor('news');
  const dir = path.join(ctx.userData, 'news');
  return new NewsService({
    dir, fetch: process.env.SB_TEST === '1' ? offline : netFetch, lang: uiLang,
    noAi: () => (claude() ? null : 'Per i riassunti serve Claude acceso (Impostazioni → Motori). Le notizie arrivano lo stesso, senza riassunto.'),
    ai: async prompt => {
      const e = claude();
      if (!e) return { ok: false, error: 'Claude è spento' };
      const cwd = path.join(dir, 'run');
      fs.mkdirSync(cwd, { recursive: true });
      const out = await headless.run({ engine: e.id, model: 'sonnet', effort: e.caps.effort ? 'low' : null, cwd, prompt, round: 'news-summary', timeoutMs: 6 * 60_000, noTools: true });
      if (!out.ok) return { ok: false, error: out.error };
      const tk = out.tokens;
      return { ok: true, text: out.text, tokens: tk ? tk.input + tk.cacheRead + tk.cacheWrite + tk.output : null, costUsd: out.costUsd };
    },
    changed: state => ctx.emitter.emit('news:changed', state),
    setInterval: (fn, ms) => t.setInterval(fn, ms), clearInterval: h => t.clearInterval(h as NodeJS.Timeout),
  });
}

/** «Attività pianificate» (ADR 0373): the engine with its readers. DevOps = the Task service's own read (the brain's or the
 *  app's devops-me.mjs, zero tokens); Outlook and Teams = tools/call on the user's connectors through the MCP gateway (zero
 *  tokens, held back while a connector needs its login); Gmail = the connector the user added whose id says «gmail» (none:
 *  a visible error); the triage = one hidden pass on Claude with no tool; the news = one grouped news to the
 *  Orchestrator. The timer is the service's own (start()); stop() is called at shutdown. */
export function buildActivities(ctx: Ctx, brain: BrainService, headless: HeadlessRunner, mcpServers: McpServersService, wake: OrchestratorWake): ActivitiesService {
  const claude = () => engineInfos().find(e => e.kind === 'claude' && engineOn(brain.settings(), e.id)) ?? null;
  const node = electronNode();
  const call = (server: string, tool: string, args: Record<string, unknown>) => mcpServers.gateway.callServer(server, tool, args);
  const held = (server: string) => mcpServers.gateway.heldReason(server);
  const gmailId = (): string | null => mcpServers.state().servers.find(s => /gmail/i.test(s.id))?.id ?? null;
  const readers: Record<ActivitySource, ActivitySourceReader> = {
    devops: devopsReader(async days => {
      const root = brain.info().brainRoot;
      const script = root ? defaultLocate(root) : null;
      return root && script ? runNode(node, script, ['--json', '--full', '--days', String(days)], root, 180_000) : null;
    }),
    outlook: mcpReader(outlookConfig(), { call, held }),
    teams: mcpReader(teamsConfig(), { call, held }),
    gmail: createGmailReader({ serverId: () => gmailId(), call }),
  };
  const dir = path.join(ctx.userData, 'activities');
  return new ActivitiesService({
    file: path.join(ctx.userData, 'activities.json'),
    reader: source => readers[source],
    ai: async prompt => {
      const e = claude();
      if (!e) return { ok: false, error: 'Claude è spento (Impostazioni → Motori): la selezione ha bisogno di lui' };
      fs.mkdirSync(dir, { recursive: true });
      const out = await headless.run({ engine: e.id, model: 'haiku', effort: e.caps.effort ? 'low' : null, cwd: dir, prompt, round: 'activity-triage', timeoutMs: 5 * 60_000, noTools: true });
      if (!out.ok) return { ok: false, error: out.error };
      const tk = out.tokens;
      return { ok: true, text: out.text, tokens: tk ? tk.input + tk.cacheRead + tk.cacheWrite + tk.output : null, costUsd: out.costUsd, model: out.model };
    },
    notify: n => { wake.activityNews({ activityId: n.activityId, title: n.activityName, text: n.text }); },
    emit: st => ctx.emitter.emit('activities:changed', st),
    gmailConnector: () => gmailId() !== null,
  });
}
