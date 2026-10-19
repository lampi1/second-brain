// A chat the user starts without choosing everything (chat:createRouted): the Task page's "Apri chat", a brain page's
// "Apri una chat", "Nuova chat" (its one-line preview too: previewRoute) and a new Orchestrator (Ricomincia da capo, Cambia
// motore, Pulisci).
// Harness, model and effort come from the routing table (brain/routing.ts, ADR 0032), the same decision app_create_chat
// makes for an Orchestrator, and the chat carries its route, so its prediction and actuals reach the improvement loop's ledger
// (wiring.ts). What the user named (the engine of Cambia motore) beats the row, as an override with its reason; no row →
// the user's defaults, as before. Why: the user, 2026-10-14, "quando dalla sezione devops premo fai partire chat mi
// aspetto che comunque passi dalle configurazioni di scelta del modello", then the same for the other paths
// (2026-10-14). Used by index.ts; test/unit/routed-chat.test.ts.
import { TASK_KINDS, type ChatSummary, type Harness, type NewChat, type RoutedNewChat, type RoutePreview, type TaskKind } from '../../shared/contract';
import { EFFORTS, type RouteRequest, type RouteResult } from '../brain/routing';
import { engineLabel, engineOf } from '../engines/registry';
import { log } from '../log';

export interface RoutedChatDeps {
  route(req: RouteRequest): RouteResult;
  /** may a chat start on this engine now (settings engineOn.*, engines/policy.ts engineOn) */
  engineOn(h: Harness): boolean;
  /** may the routing table, the defaults or an Orchestrator use this engine («Gli Orchestrator possono usare X», policy.ts agentsMayOpen) */
  agentsMayOpen(h: Harness): boolean;
  create(req: NewChat): Promise<ChatSummary>;
}

/** appCode = the chat works on the app's own code (routing area App). `byUser` = "Nuova chat" (the renderer): no cap on the first message (as chat:create), no exploration (the chat starts
 *  on the model the dialog showed) and the permission mode the user picked kept on any engine that has them. */
export interface RoutedSpace { appCode?: boolean; byUser?: boolean }

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const harnessOf = (v: unknown): Harness | undefined => (typeof v === 'string' && engineOf(v) ? v : undefined);

/** The route of a request, shared by the creation and the dialog's preview: what the user named, the table, the
 *  engines they may start now. `preview` = no exploration and no checks on the texts (the dialog asks while typing). */
type Decided = { error: string } | { routed: Exclude<RouteResult, { error: string }>; title: string; prompt: string; cwd: string; harness: Harness };
function decide(d: Pick<RoutedChatDeps, 'route' | 'engineOn' | 'agentsMayOpen'>, req: RoutedNewChat, own: RoutedSpace, preview: boolean): Decided {
  const regia = req?.regia === true;
  // an Orchestrator's title is its mail address and a rename has no limit: kept whole, a work chat's capped
  const title = text(req?.title, regia ? 1000 : 80), prompt = typeof req?.prompt === 'string' ? req.prompt.trim() : '', cwd = text(req?.cwd, 1000);
  if (!preview) {
    // an empty title is made from the prompt (or "Orchestrator · <name>") by the chat manager, as for chat:create
    if (!prompt && !regia) throw new Error('il primo messaggio serve');
    if (!own.byUser && prompt.length > (regia ? 40_000 : 8000)) throw new Error(`primo messaggio troppo lungo (≤ ${regia ? 40_000 : 8000} caratteri)`);
    if (!cwd) throw new Error('nessuna cartella per la chat');
  }
  // an Orchestrator's work is always 'regia', whatever its title or handoff says
  const kind: TaskKind | undefined = regia ? 'regia' : req.kind && (TASK_KINDS as readonly string[]).includes(req.kind) ? req.kind as TaskKind : undefined;
  const def = req.defaults ?? { harness: 'claude' };
  const harness: Harness = engineOf(def.harness) ? def.harness : 'claude';
  const effort = def.effort && (EFFORTS as readonly string[]).includes(def.effort) ? def.effort : null;
  const askEffort = req.ask?.effort && (EFFORTS as readonly string[]).includes(req.ask.effort) ? req.ask.effort : undefined;
  const said = { harness: harnessOf(req.ask?.harness), model: text(req.ask?.model, 200) || undefined, effort: askEffort };
  const named = !!(said.harness || said.model || said.effort);
  // the engine the user names for a work chat needs only to be on; a row of the table (the AI writes it), the defaults
  // and an Orchestrator (an agent itself) need «Gli Orchestrator possono usare X» too
  const userPick = (h: Harness) => !regia && h === said.harness;
  const refusal = (h: Harness): string | null => !d.engineOn(h) ? `${engineLabel(h)} è spento nelle impostazioni`
    : !userPick(h) && !d.agentsMayOpen(h) ? `gli Orchestrator non possono usare ${engineLabel(h)} (impostazione «Gli Orchestrator possono usare ${engineLabel(h)}»)` : null;
  const routed = d.route({
    // no title: the area is the prompt's would-be title's, i.e. none ('altro'); the kind comes from the prompt
    title, prompt: typeof req.routeText === 'string' ? req.routeText.slice(0, 2000) : prompt.slice(0, 2000),
    ...(kind ? { kind } : {}), ...(text(req.area, 40) ? { area: text(req.area, 40) } : {}), ...(own.appCode ? { appCode: true } : {}),
    canRun: h => !refusal(h),
    ask: named ? { ...(said.harness ? { harness: said.harness } : {}), ...(said.model ? { model: said.model } : {}), ...(said.effort ? { effort: said.effort } : {}), reason: text(req.ask?.reason, 300) || 'scelta dell’utente' } : {},
    defaults: { harness, models: { [harness]: text(def.model, 200) || null }, effort },
    // the preview shows the table's choice and "Nuova chat" starts what it showed: no dice roll for either
    ...(preview || own.byUser ? { counts: undefined } : {}),
  });
  if ('error' in routed) return { error: routed.error };
  const no = refusal(routed.harness);
  if (no) return { error: no };
  return { routed, title, prompt, cwd, harness };
}

/** What createRoutedChat would start now ("Nuova chat" shows it in one line while the user types). */
export function previewRoute(d: Pick<RoutedChatDeps, 'route' | 'engineOn' | 'agentsMayOpen'>, req: RoutedNewChat): RoutePreview {
  try {
    const r = decide(d, req, { byUser: true }, true);
    return 'error' in r ? r : { harness: r.routed.harness, model: r.routed.model, effort: r.routed.effort, route: r.routed.route };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function createRoutedChat(d: RoutedChatDeps, req: RoutedNewChat, own: RoutedSpace = {}): Promise<ChatSummary> {
  const dec = decide(d, req, own, false);
  if ('error' in dec) throw new Error(dec.error);
  const { routed, title, prompt, cwd, harness } = dec;
  // the permission mode belongs to the user's choice on an engine that has them: kept only when the chat stays there,
  // or wherever it goes when the user picked it in "Nuova chat" (the dialog shows it on the routed engine)
  const pm = (own.byUser || routed.harness === harness) && engineOf(routed.harness)?.caps.permissionMode && req.permissionMode ? { permissionMode: req.permissionMode } : {};
  const wt = req.worktree === true && engineOf(routed.harness)?.caps.worktree ? { worktree: true } : {};
  const chat = await d.create({
    harness: routed.harness, cwd, ...(title ? { title } : {}), ...(prompt ? { prompt } : {}), ...(routed.model ? { model: routed.model } : {}), ...(routed.effort ? { effort: routed.effort } : {}),
    ...pm, ...wt, ...(typeof req.regiaOf === 'string' && req.regiaOf ? { regiaOf: req.regiaOf } : {}),
    ...(req.regia === true ? { regia: true, ...(text(req.replaces, 100) ? { replaces: text(req.replaces, 100) } : {}), ...(text(req.regiaName, 40) ? { regiaName: text(req.regiaName, 40) } : {}) } : {}),
    route: routed.route,
  });
  const r = routed.route;
  log.info('chats', 'user chat routed', { chat: chat.id, data: { harness: routed.harness, model: routed.model, effort: routed.effort, route: r.source, kind: r.kind, area: r.area, version: r.version, reason: r.reason } });
  return chat;
}
