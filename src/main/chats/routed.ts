// A chat the user starts without choosing everything (chat:createRouted): "Nuova chat" and a new Orchestrator (Ricomincia da capo, Cambia motore, Pulisci). The brain pages never start one:
// their "Discuti" goes to the Orchestrator, which delegates (2026-10-19).
// Harness, model and effort come from the routing table (brain/routing.ts, ADR 0032), the same decision app_create_chat
// makes for an Orchestrator, and the chat carries its route, so its prediction and actuals reach the improvement loop's ledger
// (wiring.ts). What the user named (the engine of Cambia motore) beats the row, as an override with its reason; no row →
// the user's defaults, as before. Why: the user, 2026-10-14, "quando dalla sezione devops premo fai partire chat mi
// aspetto che comunque passi dalle configurazioni di scelta del modello", then the same for the other paths
// (2026-10-14). Used by index.ts; test/unit/routed-chat.test.ts.
import { type ChatSummary, type Harness, type NewChat, type RoutedNewChat, type TaskKind } from '../../shared/contract';
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

/** The route of a request: what the user named, the table, the engines they may start now. */
type Decided = { error: string } | { routed: Exclude<RouteResult, { error: string }>; title: string; prompt: string; cwd: string; harness: Harness };
function decide(d: Pick<RoutedChatDeps, 'route' | 'engineOn' | 'agentsMayOpen'>, req: RoutedNewChat, own: RoutedSpace): Decided {
  const orchestrator = req?.orchestrator === true;
  // an Orchestrator's title is its mail address and a rename has no limit: kept whole, a work chat's capped
  const title = text(req?.title, orchestrator ? 1000 : 80), prompt = typeof req?.prompt === 'string' ? req.prompt.trim() : '', cwd = text(req?.cwd, 1000);
  // an empty title is made from the prompt (or "Orchestrator") by the chat manager, as for chat:create
  if (!prompt && !orchestrator) throw new Error('il primo messaggio serve');
  if (!own.byUser && prompt.length > (orchestrator ? 40_000 : 8000)) throw new Error(`primo messaggio troppo lungo (≤ ${orchestrator ? 40_000 : 8000} caratteri)`);
  if (!cwd) throw new Error('nessuna cartella per la chat');
  // an Orchestrator's work is always 'orchestrator', whatever its title or handoff says
  const kind: TaskKind | undefined = orchestrator ? 'orchestrator' : undefined;
  const def = req.defaults ?? { harness: 'claude' };
  const harness: Harness = engineOf(def.harness) ? def.harness : 'claude';
  const effort = def.effort && (EFFORTS as readonly string[]).includes(def.effort) ? def.effort : null;
  const askEffort = req.ask?.effort && (EFFORTS as readonly string[]).includes(req.ask.effort) ? req.ask.effort : undefined;
  const said = { harness: harnessOf(req.ask?.harness), model: text(req.ask?.model, 200) || undefined, effort: askEffort };
  const named = !!(said.harness || said.model || said.effort);
  // the engine the user names for a work chat needs only to be on; a row of the table (the AI writes it), the defaults
  // and an Orchestrator (an agent itself) need «Gli Orchestrator possono usare X» too
  const userPick = (h: Harness) => !orchestrator && h === said.harness;
  const refusal = (h: Harness): string | null => !d.engineOn(h) ? `${engineLabel(h)} è spento nelle impostazioni`
    : !userPick(h) && !d.agentsMayOpen(h) ? `gli Orchestrator non possono usare ${engineLabel(h)} (impostazione «Gli Orchestrator possono usare ${engineLabel(h)}»)` : null;
  const routed = d.route({
    // no title: the area is the prompt's would-be title's, i.e. none ('altro'); the kind comes from the prompt
    title, prompt: prompt.slice(0, 2000),
    ...(kind ? { kind } : {}), ...(own.appCode ? { appCode: true } : {}),
    canRun: h => !refusal(h),
    ask: named ? { ...(said.harness ? { harness: said.harness } : {}), ...(said.model ? { model: said.model } : {}), ...(said.effort ? { effort: said.effort } : {}), reason: text(req.ask?.reason, 300) || 'scelta dell’utente' } : {},
    defaults: { harness, models: { [harness]: text(def.model, 200) || null }, effort },
    // "Nuova chat" starts the table's choice: no dice roll
    ...(own.byUser ? { counts: undefined } : {}),
  });
  if ('error' in routed) return { error: routed.error };
  const no = refusal(routed.harness);
  if (no) return { error: no };
  return { routed, title, prompt, cwd, harness };
}

export async function createRoutedChat(d: RoutedChatDeps, req: RoutedNewChat, own: RoutedSpace = {}): Promise<ChatSummary> {
  const dec = decide(d, req, own);
  if ('error' in dec) throw new Error(dec.error);
  const { routed, title, prompt, cwd, harness } = dec;
  // the permission mode belongs to the user's choice on an engine that has them: kept only when the chat stays there,
  // or wherever it goes when the user picked it in "Nuova chat" (the dialog shows it on the routed engine)
  const pm = (own.byUser || routed.harness === harness) && engineOf(routed.harness)?.caps.permissionMode && req.permissionMode ? { permissionMode: req.permissionMode } : {};
  const wt = req.worktree === true && engineOf(routed.harness)?.caps.worktree ? { worktree: true } : {};
  const chat = await d.create({
    harness: routed.harness, cwd, ...(title ? { title } : {}), ...(prompt ? { prompt } : {}), ...(routed.model ? { model: routed.model } : {}), ...(routed.effort ? { effort: routed.effort } : {}),
    ...pm, ...wt,
    ...(req.orchestrator === true ? { orchestrator: true, ...(text(req.replaces, 100) ? { replaces: text(req.replaces, 100) } : {}) } : {}),
    route: routed.route,
  });
  const r = routed.route;
  log.info('chats', 'user chat routed', { chat: chat.id, data: { harness: routed.harness, model: routed.model, effort: routed.effort, route: r.source, kind: r.kind, area: r.area, version: r.version, reason: r.reason } });
  return chat;
}
