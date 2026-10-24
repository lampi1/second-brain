// app_config: the Orchestrator reads and changes the app's configuration for the user (ADR 0149; the owner, 2026-10-24:
// "deve poter modificare ogni cosa richiesta dell'utente", every configuration). One tool, five areas, each through the
// module that already owns it, never a second write path:
// - setting: every key of the settings schema (brain/settings-schema.ts) via config.request with `direct` (the owner
//   chose that protected keys change at once too), logged as the agent's change with its Annulla (undo / history);
// - view: theme, density, work profile (renderer prefs, lib/view-prefs.ts) via ui:command 'prefs';
// - agent: a role's card (Brain → Agenti) via the same save as the page (a new version; undo = the previous version);
// - connector: an MCP server on/off and a role's access to it (Settings → Connettori); adding or removing a server, its
//   tokens and the accounts' logins stay the user's, in Settings (they run commands or hold credentials);
// - later: «Rispondi dopo».
// Every change needs the user's own recent words to the Orchestrator (userAsked: the same check as app_update_code),
// so neither app news, an agent's mail nor a page it read can change a setting. Secrets are never read or written.
// Mounted only on the authenticated Orchestrator endpoint by appctl/tools.ts.
import type { ChangeBy, SettingChange, SettingDef, SettingRequestResult, Settings } from '../../shared/contract';
import type { AgentCatalog, AgentDraft, AgentProfile, AgentVersion } from '../../shared/agents';
import type { McpServersState, McpToolAccess } from '../../shared/mcp-servers';
import { getAt } from '../brain/settings-schema';
import { log } from '../log';
import type { ToolDef } from './tools';

export interface ViewPrefsRead { theme: string; density: string; workProfile: string | null; orchestratorOpen: boolean; workProfiles: { id: string; title: string }[] }
export interface ConfigDeps {
  callerId: string;
  /** the user wrote to this Orchestrator in the last few minutes (their ask, not an agent's) */
  userAsked(): boolean;
  brain: {
    settings(): Settings; settingsSchema(): SettingDef[]; settingsHistory(limit?: number): SettingChange[];
    undoSetting(changeId: string, by?: ChangeBy, origin?: { chatId?: string; direct?: boolean }): SettingChange;
    requestSetting(key: string, value: unknown, origin: { by: ChangeBy; chatId?: string; reason?: string; direct?: boolean }): SettingRequestResult;
  };
  view?: { read(): Promise<ViewPrefsRead | null>; apply(patch: Record<string, unknown>): void };
  agents?: { list(): AgentCatalog; save(draft: AgentDraft, id: string): AgentProfile; history(id: string): AgentVersion[]; restore(id: string, version: number): AgentProfile };
  mcp?: { state(): McpServersState; save(a: { def: unknown; previousId?: string }): McpServersState; setAccess(a: { role: string; server: string; access: McpToolAccess }): McpServersState };
  later?: { get(): { on: boolean }; set(on: boolean): { on: boolean } };
}

export const CONFIG_ASK_MIN = 10;
const AREAS = ['setting', 'view', 'agent', 'connector', 'later'] as const;
/** The role card's fields an edit may set (name, summary and character are the role's own, fixed) */
export const AGENT_FIELDS = ['instructions', 'engine', 'model', 'effort', 'tier', 'tierMax', 'maxContext', 'skills', 'launches', 'tools', 'permissionCeiling'] as const;
const VIEW_FIELDS = ['theme', 'density', 'workProfile'] as const;

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const matches = (q: string, text: string) => { const w = norm(q).split(/\s+/).filter(Boolean); const h = norm(text); return w.every(x => h.includes(x)); };

/** The editable part of a role, as the page sends it to agents:save. */
export function draftOf(p: AgentProfile): AgentDraft {
  return { ...(p.knowhow ? { knowhow: p.knowhow } : {}), ...(p.pack ? { pack: p.pack } : {}), name: p.name, purpose: p.purpose, instructions: p.instructions, engine: p.engine, model: p.model,
    ...(p.effort ? { effort: p.effort } : {}), avatar: p.avatar, tools: p.tools, permissionCeiling: p.permissionCeiling, ...(p.maxContext !== undefined ? { maxContext: p.maxContext } : {}),
    tier: p.tier, tierMax: p.tierMax, launches: [...p.launches], skills: [...p.skills] };
}
const roleView = (p: AgentProfile) => ({ id: p.id, name: p.name, activeVersion: p.activeVersion, engine: p.engine, model: p.model, effort: p.effort ?? null, tier: p.tier, tierMax: p.tierMax,
  maxContext: p.maxContext ?? null, skills: p.skills, launches: p.launches, tools: p.tools, permissionCeiling: p.permissionCeiling, ...(p.trial ? { trial: p.trial } : {}),
  instructions: p.instructions.length > 400 ? `${p.instructions.slice(0, 400)}… (${p.instructions.length} chars)` : p.instructions });

export function configTool(d: ConfigDeps): ToolDef {
  const asked = (what: string) => { if (!d.userAsked()) throw new Error(`bloccato: cambia ${what} solo quando l'utente te lo chiede, con parole sue, negli ultimi ${CONFIG_ASK_MIN} minuti`); };
  const role = (id: unknown): AgentProfile => {
    const p = d.agents?.list().profiles.find(x => x.id === id);
    if (!p) throw new Error(`ruolo sconosciuto: ${String(id)} (ruoli: ${d.agents?.list().profiles.map(x => x.id).join(', ') ?? 'nessuno'})`);
    return p;
  };
  return {
    name: 'app_config',
    description: `Read and change the app's configuration for the user, exactly as their own click in the app would (every change is logged with its Annulla). action "get" (read, optional query), "set", "undo", "history". area: "setting" (every key of Impostazioni and more: key + value; get lists key, label, description, type, current value), "view" (theme system|light|dark, density comfortable|compact, workProfile: key + value), "agent" (a role's card in Brain → Agenti: agentId + key = one of ${AGENT_FIELDS.join('|')} + value; undo with agentId + version), "connector" (an MCP server: server + key "enabled" (boolean) or key "access" with role + value all|read|none|{tools:[...]}), "later" («Rispondi dopo»: value true|false). Change only what the user asked in their own words in the last ${CONFIG_ASK_MIN} minutes; then tell them in one line what changed and that Annulla is in the change log. Never secrets, tokens, logins or adding/removing MCP servers: those stay in Settings for the user. Where a setting is on screen: app_guide / app_ui outline.`,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: { type: 'object', additionalProperties: false, required: ['action', 'area'], properties: {
      action: { type: 'string', enum: ['get', 'set', 'undo', 'history'] }, area: { type: 'string', enum: [...AREAS] },
      key: { type: 'string', description: 'setting key, view field, agent field, or connector field (enabled|access)' }, value: { description: 'the new value (JSON type of the field)' },
      query: { type: 'string', description: 'get: words to filter by (label, key, description)' }, agentId: { type: 'string' }, server: { type: 'string' }, role: { type: 'string' },
      changeId: { type: 'string', description: 'undo of a setting: the change id from set or history' }, version: { type: 'integer', description: 'undo of an agent: the version to restore' },
      reason: { type: 'string', description: 'the user\'s ask, in a few words (kept in the log)' },
    } },
    run: async a => {
      const action = String(a.action ?? ''), area = String(a.area ?? '');
      if (!(AREAS as readonly string[]).includes(area)) throw new Error(`area: ${AREAS.join(' | ')}`);
      const q = typeof a.query === 'string' ? a.query : '';
      const reason = typeof a.reason === 'string' ? a.reason.slice(0, 300) : undefined;
      switch (area) {
        case 'setting': {
          if (action === 'get') {
            const s = d.brain.settings();
            return d.brain.settingsSchema().filter(x => !q || matches(q, `${x.key} ${x.label} ${x.description}`)).map(x => ({
              key: x.key, label: x.label, description: x.description, type: x.type, ...(x.values ? { values: x.values } : {}), ...(x.min !== undefined ? { min: x.min, max: x.max } : {}),
              ...(x.nullable ? { nullable: true } : {}), ...(x.key.includes('*') ? {} : { value: getAt(s, x.key) }), default: x.default }));
          }
          if (action === 'history') return d.brain.settingsHistory(20).map(c => ({ id: c.id, at: new Date(c.at).toISOString(), by: c.by, key: c.key, before: c.before, after: c.after, ...(c.undone ? { undone: true } : {}) }));
          if (action === 'undo') {
            asked('le impostazioni');
            const ch = d.brain.undoSetting(String(a.changeId ?? ''), 'agent', { chatId: d.callerId, direct: true });
            log.info('appctl', 'Orchestrator undid a setting change', { chat: d.callerId, data: { key: ch.key } });
            return { undone: a.changeId, change: { id: ch.id, key: ch.key, value: ch.after } };
          }
          if (action !== 'set') break;
          asked('le impostazioni');
          const r = d.brain.requestSetting(String(a.key ?? ''), a.value, { by: 'agent', chatId: d.callerId, ...(reason ? { reason } : {}), direct: true });
          if ('error' in r) throw new Error(r.error);
          if ('proposal' in r) return { proposal: r.proposal.id, note: 'in attesa del clic dell’utente in Memoria → Proposte' };
          log.info('appctl', 'Orchestrator changed a setting', { chat: d.callerId, data: { key: r.applied.key } });
          return { changed: r.applied.key, before: r.applied.before, after: r.applied.after, changeId: r.applied.id, undo: 'app_config undo with this changeId, or Annulla in the change log' };
        }
        case 'view': {
          if (!d.view) throw new Error('vista non disponibile (finestra chiusa)');
          if (action === 'get') return (await d.view.read()) ?? { error: 'la finestra non risponde' };
          if (action !== 'set') break;
          const key = String(a.key ?? '');
          if (!(VIEW_FIELDS as readonly string[]).includes(key)) throw new Error(`key: ${VIEW_FIELDS.join(' | ')}`);
          asked('la vista');
          const before = await d.view.read();
          d.view.apply({ [key]: a.value });
          const after = await d.view.read();
          if (before && after && JSON.stringify((before as unknown as Record<string, unknown>)[key]) === JSON.stringify((after as unknown as Record<string, unknown>)[key]) && JSON.stringify(a.value) !== JSON.stringify((before as unknown as Record<string, unknown>)[key])) {
            throw new Error(`valore non valido per ${key} (vedi app_config get area view)`);
          }
          log.info('appctl', 'Orchestrator changed a view preference', { chat: d.callerId, data: { key } });
          return { changed: key, before: before ? (before as unknown as Record<string, unknown>)[key] : null, after: after ? (after as unknown as Record<string, unknown>)[key] : a.value, undo: 'set it back with the "before" value' };
        }
        case 'agent': {
          if (!d.agents) throw new Error('ruoli non disponibili');
          if (action === 'get') return (a.agentId ? [role(a.agentId)] : d.agents.list().profiles).map(roleView);
          if (action === 'history') return d.agents.history(role(a.agentId).id).slice(-10).map(v => ({ version: v.version, at: new Date(v.at).toISOString(), author: v.author, reason: v.reason, state: v.state }));
          if (action === 'undo') {
            asked('i ruoli');
            const p = d.agents.restore(role(a.agentId).id, Number(a.version));
            log.info('appctl', 'Orchestrator restored a role version', { chat: d.callerId, data: { role: p.id, version: p.activeVersion } });
            return { agentId: p.id, activeVersion: p.activeVersion };
          }
          if (action !== 'set') break;
          const key = String(a.key ?? '');
          if (!(AGENT_FIELDS as readonly string[]).includes(key)) throw new Error(`key: ${AGENT_FIELDS.join(' | ')}`);
          asked('i ruoli');
          const old = role(a.agentId);
          const p = d.agents.save({ ...draftOf(old), [key]: a.value } as AgentDraft, old.id);
          if (p.activeVersion === old.activeVersion) return { agentId: p.id, unchanged: true, note: 'già così' };
          log.info('appctl', 'Orchestrator changed a role', { chat: d.callerId, data: { role: p.id, key, version: p.activeVersion } });
          return { agentId: p.id, changed: key, before: (old as unknown as Record<string, unknown>)[key] ?? null, after: (p as unknown as Record<string, unknown>)[key] ?? null, version: p.activeVersion, undo: { agentId: p.id, version: old.activeVersion } };
        }
        case 'connector': {
          if (!d.mcp) throw new Error('connettori non disponibili');
          const st = d.mcp.state();
          if (action === 'get') return { servers: st.servers.map(s => ({ id: s.id, label: s.label, transport: s.transport, enabled: s.enabled, ...(s.purpose ? { purpose: s.purpose } : {}),
            tokens: Object.values(s.secretMasks).every(Boolean) ? 'set' : 'missing', tools: s.lastTest?.tools.length ?? null, ...(s.lastTest?.error ? { error: s.lastTest.error.message } : {}) })), access: st.access };
          if (action !== 'set') break;
          const server = st.servers.find(s => s.id === a.server);
          if (!server) throw new Error(`server sconosciuto: ${String(a.server)} (aggiungerne uno lo fa l’utente in Impostazioni → Avanzate)`);
          asked('i connettori');
          if (a.key === 'enabled') {
            if (typeof a.value !== 'boolean') throw new Error('enabled: true | false');
            const { secretMasks: _m, lastTest: _t, ...def } = server; void _m; void _t;
            d.mcp.save({ def: { ...def, enabled: a.value }, previousId: server.id });
            log.info('appctl', 'Orchestrator switched an MCP server', { chat: d.callerId, data: { server: server.id, enabled: a.value } });
            return { server: server.id, enabled: a.value, undo: 'set enabled back' };
          }
          if (a.key === 'access') {
            const v = a.value;
            const ok = v === 'all' || v === 'read' || v === 'none' || (!!v && typeof v === 'object' && Array.isArray((v as { tools?: unknown }).tools) && (v as { tools: unknown[] }).tools.every(x => typeof x === 'string'));
            if (!ok || typeof a.role !== 'string') throw new Error('access: role + value all | read | none | {"tools":[...]}');
            const before = st.access[a.role]?.servers[server.id] ?? 'all';
            d.mcp.setAccess({ role: a.role, server: server.id, access: v as McpToolAccess });
            log.info('appctl', 'Orchestrator changed a role\'s MCP access', { chat: d.callerId, data: { server: server.id, role: a.role } });
            return { server: server.id, role: a.role, before, after: v };
          }
          throw new Error('key: enabled | access');
        }
        case 'later': {
          if (!d.later) throw new Error('non disponibile');
          if (action === 'get') return d.later.get();
          if (action !== 'set') break;
          if (typeof a.value !== 'boolean') throw new Error('value: true | false');
          asked('«Rispondi dopo»');
          const before = d.later.get().on;
          return { before, after: d.later.set(a.value).on };
        }
      }
      throw new Error(`action ${action} non vale per l'area ${area}`);
    },
  };
}
