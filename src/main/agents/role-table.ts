// The routing table's row for a role chat whose role names no model (ADR 0078, 0091): the row that matches the chat's
// kind and area (the launch's own kind, app code and area when app_create_chat knows them, else its title and prompt) on the role's own engine gives the model, and the effort when the role
// names none, so the user can set e.g. Sentinel's reviews to claude-opus-5-5 with low effort from the table. Never
// the API switch, never another engine: a row on another engine is ignored and the tier decides.
// Used by wiring.ts createAgentCatalog (AgentCatalogDeps.tableModel).
import type { Effort, Harness, NewChat, Settings } from '../../shared/contract';
import type { RouteRequest, RouteResult } from '../brain/routing';

export interface RoleTableSource {
  route(req: RouteRequest): RouteResult;
  settings(): Pick<Settings, 'orchestratorChats'>;
}

export function roleTableModel(brain: RoleTableSource, engine: Harness, req: Pick<NewChat, 'title' | 'prompt' | 'routeHint'>): { model: string; effort: Effort | null } | null {
  const hint = req.routeHint;
  const s = brain.settings().orchestratorChats;
  let r: RouteResult;
  try {
    r = brain.route({
      title: req.title ?? '', prompt: req.prompt ?? '', ...(hint?.kind ? { kind: hint.kind } : {}), ...(hint?.appCode ? { appCode: true } : {}), ...(hint?.area ? { area: hint.area } : {}), ask: { harness: engine }, canRun: h => h === engine, api: null,
      defaults: { harness: s.harness, models: { claude: s.claudeModel || null, cursor: s.cursorModel || null }, effort: s.claudeEffort || null },
    });
  } catch { return null; }
  if ('error' in r || r.route.source !== 'table' || r.harness !== engine || !r.model) return null;
  return { model: r.model, effort: r.effort };
}
