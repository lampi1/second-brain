// IPC handlers, Agents: roles and their versions, metrics and estimates, avatars, work threads and lessons, routines,
// connectors and MCP servers, the Guida. Registered by src/main/index.ts with every other group (Handlers
// in ipc.ts keeps the set complete); each channel's shape is in src/shared/contract/*.ts.
import { FROZEN_EPOCH } from '../demo';
import { checkRunIds, demoEstimateRuns, mergeRuns } from '../agents/run-estimates';
import { errText, log } from '../log';
import { judgingEstimate } from '../agents/judge-sample';
import { readWorker } from '../read-work';
import type { HandlerContext, HandlersOf } from './context';

export function agentsHandlers({ s, demo, agentImages, workflows, orchestrator, mcpServers, connectors, routinesOf }: HandlerContext): HandlersOf<'agents' | 'avatars' | 'work' | 'routines' | 'connectors' | 'mcpservers' | 'guide'> {
  return {
    'connectors:list': () => connectors.service.list(),
    'connectors:login': a => connectors.service.login(a?.provider),
    'connectors:cancelLogin': () => connectors.service.cancelLogin(),
    'connectors:probe': a => connectors.service.probe(a?.provider),
    'connectors:select': a => connectors.service.select(a?.provider, a?.projects),
    'connectors:disconnect': a => connectors.service.disconnect(a?.provider),
    'connectors:useToken': a => connectors.service.useToken(a),
    // the user's MCP servers (ADR 0086): the user's clicks only; a token goes in once and never comes back
    'mcpservers:state': () => mcpServers().state(),
    'mcpservers:save': a => mcpServers().save(a),
    'mcpservers:remove': a => mcpServers().remove(a?.id),
    'mcpservers:setSecret': a => mcpServers().setSecret(a),
    'mcpservers:deleteSecret': a => mcpServers().deleteSecret(a),
    'mcpservers:setAccess': a => mcpServers().setAccess(a),
    'mcpservers:test': a => mcpServers().test(a?.id),
    'mcpservers:importScan': () => mcpServers().importScan(),
    'mcpservers:importApply': a => mcpServers().importApply(a?.keys),
    'agents:list': () => s.agents.list(),
    // the brain skills that fit a request (the role start dialog); the demo ranks by words only
    'agents:undo': a => { if (!s.runFeedback) throw new Error('Annulla non disponibile.'); return s.runFeedback.undo(a); },
    'agents:save': a => s.agentPacks.learning.save(a.profile, a.id),
    'agents:reset': a => s.agents.reset(String(a?.id ?? '')),
    'agents:trialDecide': a => s.agents.resolveTrial(a.id, a.decision),
    // the user's click on a "Da approvare" entry: the only way a lifecycle proposal is applied (agents/lifecycle-api.ts)
    'agents:lifecycleDecide': a => { if (!s.agentLifecycle) throw new Error('Coda «Da approvare» non disponibile.'); return s.agentLifecycle.decide(a); },
    'agents:history': a => s.agents.history(a.id),
    'agents:metrics': a => {
      const tag = (v: unknown) => typeof v === 'string' && v.length <= 120 ? v : undefined;
      const skill = tag(a?.skill), app = tag(a?.app), repo = tag(a?.repo);
      return s.chats.runMetrics?.({ ...(typeof a?.since === 'number' ? { since: a.since } : {}),
        ...(skill !== undefined ? { skill } : {}), ...(app !== undefined ? { app } : {}), ...(repo !== undefined ? { repo } : {}) }) ?? [];
    },
    // the strips' and the Orchestrator plan's estimates (ADR 0087); the demo brings its own run history
    'agents:estimates': a => {
      const now = demo && process.env.SB_DEMO_FREEZE === '1' ? FROZEN_EPOCH : Date.now();
      const runs = mergeRuns(demo ? demoEstimateRuns(now) : s.agentRuns?.list() ?? [], s.chats.list().map(c => c.run));
      // the chats' runs are the store's own records (adopted ones too): its revision plus the count covers both
      const key = !demo && s.agentRuns ? `store:${s.agentRuns.revision}/${runs.length}` : undefined;
      return readWorker.call({ op: 'estimates', runs, runIds: checkRunIds(a?.runIds), now }, key);
    },
    'agents:judgingEstimate': () => {
      const now = demo && process.env.SB_DEMO_FREEZE === '1' ? FROZEN_EPOCH : Date.now();
      return judgingEstimate(mergeRuns(demo ? demoEstimateRuns(now) : s.agentRuns?.list() ?? [], s.chats.list().map(c => c.run)), now);
    },
    'agents:restoreVersion': a => s.agents.restoreVersion(a.id, a.version),
    // the user's own picture for a role (the role's page): a PNG checked and re-encoded by main, never sent to an engine
    'avatars:get': () => agentImages.get(),
    'avatars:set': a => agentImages.set(a?.id, a?.bytes),
    'avatars:reset': a => agentImages.reset(a?.id),
    'work:lessons': () => s.agentPacks.learning.waiting(),
    'work:lessonDecide': a => {
      const lesson = s.agentPacks.learning.waiting().find(p => p.id === a.id);
      if (!lesson || lesson.rule !== a.rule) throw new Error('La proposta è cambiata: rileggila.');
      const reviewed = s.agentPacks.learning.review(a.id, a.approve, a.feedback);
      const target = orchestrator.get();
      if (a.feedback && target) void s.chats.send(target.id, `[evento app] L’utente chiede una proposta diversa per la regola ${reviewed.id}. Proposta rifiutata: ${JSON.stringify(reviewed.rule)}. Risposta: ${JSON.stringify(reviewed.note)}. Prepara la nuova proposta nella modale; nessuna modifica è approvata.`, undefined, false, 'Decisioni', false, { kind: 'app' }).catch(e => log.warn('chats', 'lesson feedback wake failed', { cause: errText(e), hint: 'The feedback is saved in the lesson review record.' }));
    },
    // the Routine section (ADR 0175, 0176): package secrets stay in main, the renderer only sees which slots are set
    'routines:list': () => routinesOf().snapshot(),
    'routines:import': a => routinesOf().importZip(Buffer.from(String(a.data), 'base64')),
    'routines:export': a => routinesOf().exportForTerminal(String(a.id)),
    'routines:setSecrets': a => routinesOf().setSecrets(a.id, a.values && typeof a.values === 'object' ? a.values : {}),
    'routines:image': a => routinesOf().image(a.ref, a.path),
    'routines:watch': a => routinesOf().watch(a.ref, a.subscription),
    'routines:unwatch': a => routinesOf().unwatch(a.subscription),
    'routines:archive': () => s.routineArchive?.snapshot() ?? { contextKey: 'unavailable', drafts: [], versions: [], active: {}, runs: [] },
    'routines:convert': a => routinesOf().convert(a.flowId),
    'work:list': () => workflows.list(),
    'work:decide': a => {
      const row = workflows.decide(a);
      const target = orchestrator.get();
      if (target) void s.chats.send(target.id, `[evento app] Decisione registrata nel filo ${row.id}. Rileggi app_work_list e prosegui dalla decisione salvata; questa notifica non concede altri permessi.`, undefined, false, 'Lavoro', false, { kind: 'app' }).catch(e => log.warn('chats', 'workflow decision wake failed', { cause: errText(e), hint: 'The decision is saved; Fai il punto resumes it.' }));
      return row;
    },
    // «Chiedi alla Guida» and the cards «da verificare» (main/guide/service.ts, ADR 0196); none in the demo
    'guide:ask': async a => s.guide ? s.guide.ask(a) : { ok: false, text: '', cards: [], files: [], costUsd: null, costBasis: 'unknown', model: null, reason: 'unavailable', noEngine: true },
    'guide:stale': () => s.guide?.stale() ?? { checked: false, cards: [] },
  };
}
