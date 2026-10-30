// app_config: the Orchestrator reads and changes the app's configuration for the user (ADR 0149; the owner, 2026-10-24:
// "deve poter modificare ogni cosa richiesta dell'utente", every configuration). One tool, five areas, each through the
// module that already owns it, never a second write path:
// - setting: every key of the settings schema (brain/settings-schema.ts) via config.request with `direct` (the owner
//   chose that protected keys change at once too), logged as the agent's change with its Annulla (undo / history);
// - view: theme, density, work profile (renderer prefs, lib/view-prefs.ts) via ui:command 'prefs';
// - agent: a role's card (Brain → Agenti) via the same save as the page (a new version for text, skills, model or tier,
//   undo = the previous version; tools, permissions and limits change the version in use, undo = set the old value, ADR 0186);
// - connector: the MCP servers of Settings → Connettori (ADR 0207; the owner, 2026-10-30: «MCP deve essere facilissimo
//   configurarlo anche per l'Orchestrator»): add (a definition, or what the user pasted: JSON, command line or URL),
//   edit a field, on/off, a role's access (Flash and the Orchestrator too), remove, test, each undoable («Annulla» on
//   the feed card it posts, or action undo); "form" opens the add form prefilled for the user. Token values never: a
//   pasted secret is dropped before anything is kept or answered, the user types tokens in Settings; the accounts'
//   logins stay the user's;
// - profile: Settings → Il mio profilo (the managed fields of the brain's me.md: name, role, language, main work, reply
//   style) via the same save as the page (ADR 0207), its revision checked; undo = set the "before" value back;
// - later: «Rispondi dopo»;
//   and the global pause: the Routine page's own calls (ADR 0155), never approving a trigger, a DevOps write or «Esegui».
// Every change needs the user's own typed message to this Orchestrator in the last minutes, and that message must be
// its latest (userAsked: appctl/user-words.ts), so neither app news, an agent's mail, the Battito card nor a turn they
// woke can change a setting; the Orchestrator's own tools and permission ceiling stay the user's click. Secrets are never read or written.
// Mounted only on the authenticated Orchestrator endpoint by appctl/tools.ts.
import type { ChangeBy, SettingChange, SettingDef, SettingRequestResult, Settings } from '../../shared/contract';
import type { AgentCatalog, AgentDraft, AgentProfile, AgentVersion } from '../../shared/agents';
import type { FeedAction } from '../../shared/contract';
import type { OwnerProfile, ProfileResult, ProfileSave } from '../../shared/profile';
import { MCP_ACCESS_ROLES, effectiveAccess, type McpServerDef, type McpServersState, type McpServerView, type McpToolAccess } from '../../shared/mcp-servers';
import { parseMcpSnippet, publicDraft } from '../../shared/mcp-paste';
import { getAt } from '../brain/settings-schema';
import { addRedaction, log } from '../log';
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
  /** apply: the renderer's checked setter (lib/view-prefs.ts), the result as it reads after it; null = no answer */
  view?: { read(): Promise<ViewPrefsRead | null>; apply(patch: Record<string, unknown>): Promise<{ ok: boolean; error?: string; view: ViewPrefsRead } | null> };
  agents?: { list(): AgentCatalog; save(draft: AgentDraft, id: string, reason?: string): AgentProfile; history(id: string): AgentVersion[]; restore(id: string, version: number): AgentProfile };
  mcp?: { state(): McpServersState; save(a: { def: unknown; previousId?: string }): McpServersState; setAccess(a: { role: string; server: string; access: McpToolAccess }): McpServersState;
    /** undoable changes (ADR 0207): each returns the key of its «Annulla» */
    agentSave?(def: unknown, previousId?: string): { id: string; undo: string }; agentRemove?(id: string): { undo: string }; agentAccess?(role: string, server: string, access: unknown): { undo: string };
    undo?(key: string): McpServersState; test?(id: string): Promise<McpServersState> };
  /** a feed card (live.ts RawEvent) with its «Annulla» */
  announce?(e: { kind: string; title: string; detail?: string; action?: FeedAction }): void;
  /** opens Settings → Connettori with the add form filled (ui:command mcpDraft; the definition carries no secret) */
  openForm?(draft: { def: McpServerDef; tokens: string[] }): void;
  later?: { get(): { on: boolean }; set(on: boolean): { on: boolean } };
  /** Settings → Il mio profilo (brain/profile.ts): the managed fields of me.md */
  profile?: { get(): Promise<ProfileResult>; save(p: ProfileSave): Promise<OwnerProfile> };
}

export const CONFIG_ASK_MIN = 10;
const AREAS = ['setting', 'view', 'agent', 'connector', 'profile', 'later'] as const;
const PROFILE_FIELDS = ['name', 'role', 'language', 'mainWork', 'replyStyle'] as const;
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
  // the MCP servers (ADR 0207): every change undoable, announced on a feed card with its «Annulla», never a secret value
  const connector = async (action: string, a: Record<string, unknown>, reason?: string): Promise<unknown> => {
    const m = d.mcp;
    if (!m) throw new Error('connettori non disponibili');
    const st = m.state();
    const find = (id: unknown): McpServerView => {
      const s = st.servers.find(x => x.id === id);
      if (!s) throw new Error(`server sconosciuto: ${String(id)} (server: ${st.servers.map(x => x.id).join(', ') || 'nessuno'})`);
      return s;
    };
    const defOf = (s: McpServerView): McpServerDef => { const { secretMasks: _m, lastTest: _t, ...def } = s; void _m; void _t; return def; };
    const tell = (title: string, detail: string, undo: string) => d.announce?.({ kind: 'connector-changed', title, detail: `${detail} · ${reason ? `richiesta: ${reason}` : 'su tua richiesta'}`, action: { kind: 'connector-undo', undo } });
    // what the agent gave (a paste or a definition) as a definition without any secret value
    const draftFrom = (): { def: McpServerDef; tokens: string[]; dropped: string[] } => {
      if (typeof a.snippet === 'string' && a.snippet.trim()) {
        const r = parseMcpSnippet(a.snippet.slice(0, 20_000));
        if (!r.ok) throw new Error(`non capisco cosa è stato incollato (${r.error}): serve un JSON "mcpServers", un comando (npx -y …) o un URL https`);
        const pick = r.drafts.length === 1 ? r.drafts[0]! : r.drafts.find(x => x.def.id === a.server);
        if (!pick) throw new Error(`il JSON ha ${r.drafts.length} server: scegline uno con server = ${r.drafts.map(x => x.def.id).join(' | ')}`);
        // a token pasted by mistake is never kept nor answered; the logs redact it too
        for (const v of r.drafts.flatMap(x => Object.values(x.values))) addRedaction(v);
        return publicDraft(pick);
      }
      if (a.def && typeof a.def === 'object') {
        const def = { enabled: true, secrets: [], ...(a.def as Record<string, unknown>) } as unknown as McpServerDef;
        if (!def.id && typeof def.label === 'string') def.id = def.label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'server';
        return { def, tokens: (def.secrets ?? []).map(x => x.name), dropped: [] };
      }
      throw new Error('serve snippet (JSON, comando o URL) oppure def');
    };
    const view = (s: McpServerView) => ({ id: s.id, label: s.label, transport: s.transport, enabled: s.enabled, runs: s.transport === 'stdio' ? [s.command, ...(s.args ?? [])].join(' ') : s.url ?? '',
      ...(s.env ? { env: Object.keys(s.env) } : {}), ...(s.headers ? { headers: Object.keys(s.headers) } : {}), ...(s.purpose ? { purpose: s.purpose } : {}),
      tokens: s.secrets.map(x => ({ name: x.name, where: x.where, set: !!s.secretMasks[`${x.where}:${x.name}`] })),
      test: s.lastTest ? (s.lastTest.ok ? { ok: true, tools: s.lastTest.tools.length, reading: s.lastTest.tools.filter(x => x.readOnly).length } : { ok: false, error: s.lastTest.error?.code, fix: s.lastTest.error?.fix }) : null,
      roles: Object.fromEntries(MCP_ACCESS_ROLES.map(r => [r, effectiveAccess(r, st.access[r]?.servers[s.id])])) });
    switch (action) {
      case 'get': return { servers: st.servers.map(view), tokenStore: st.secretsAvailable ? 'ok' : 'unavailable', note: 'token values are never shown: the user types them in each server\'s card' };
      case 'form': {
        if (!d.openForm) throw new Error('la finestra non è disponibile');
        const draft = draftFrom();
        d.openForm({ def: draft.def, tokens: draft.tokens });
        return { opened: 'Impostazioni → Connettori, modulo «Aggiungi server MCP» compilato', tokens: draft.tokens, note: draft.tokens.length ? 'the user types the token values there, then «Salva e prova»' : 'the user checks it and clicks «Salva e prova»' };
      }
      case 'add': {
        if (!m.agentSave) throw new Error('non disponibile');
        asked('i connettori');
        const draft = draftFrom();
        const r = m.agentSave(draft.def);
        const s = m.state().servers.find(x => x.id === r.id);
        log.info('appctl', 'Orchestrator added an MCP server', { chat: d.callerId, data: { server: r.id, transport: s?.transport } });
        tell(`L’Orchestrator ha aggiunto il server MCP «${s?.label ?? r.id}»`, s ? view(s).runs : r.id, r.undo);
        return { added: r.id, changeId: r.undo, tokensMissing: draft.tokens, ...(draft.dropped.length ? { leftOut: draft.dropped } : {}),
          next: draft.tokens.length ? 'tell the user to type the token(s) in its card in Impostazioni → Connettori (app_config action form or app_ui page impostazioni/connectors), then test' : 'test it with action test', undo: 'action undo with this changeId, or Annulla on its card' };
      }
      case 'remove': {
        if (!m.agentRemove) throw new Error('non disponibile');
        const s = find(a.server);
        asked('i connettori');
        const r = m.agentRemove(s.id);
        log.info('appctl', 'Orchestrator removed an MCP server', { chat: d.callerId, data: { server: s.id } });
        tell(`L’Orchestrator ha tolto il server MCP «${s.label}»`, 'tolto con i suoi token e gli accessi dei ruoli: «Annulla» lo rimette com’era', r.undo);
        return { removed: s.id, changeId: r.undo, undo: 'action undo with this changeId (tokens and access come back too)' };
      }
      case 'undo': {
        if (!m.undo) throw new Error('non disponibile');
        asked('i connettori');
        m.undo(String(a.changeId ?? ''));
        log.info('appctl', 'Orchestrator undid a connector change', { chat: d.callerId });
        return { undone: a.changeId };
      }
      case 'test': {
        if (!m.test) throw new Error('non disponibile');
        const s = find(a.server);
        // a test starts the server's command: the user's ask, like a change
        asked('i connettori');
        const after = (await m.test(s.id)).servers.find(x => x.id === s.id);
        const t = after?.lastTest;
        return t ? (t.ok ? { server: s.id, ok: true, tools: t.tools.length, reading: t.tools.filter(x => x.readOnly).length, ms: t.ms } : { server: s.id, ok: false, error: t.error }) : { server: s.id, ok: false };
      }
      case 'set': {
        const s = find(a.server);
        asked('i connettori');
        const key = String(a.key ?? '');
        if (key === 'access') {
          const v = a.value;
          const ok = v === 'all' || v === 'read' || v === 'none' || (!!v && typeof v === 'object' && Array.isArray((v as { tools?: unknown }).tools) && (v as { tools: unknown[] }).tools.every(x => typeof x === 'string'));
          if (!ok || typeof a.role !== 'string') throw new Error('access: role + value all | read | none | {"tools":[...]}');
          if (!MCP_ACCESS_ROLES.includes(a.role)) throw new Error(`ruolo sconosciuto: ${a.role} (ruoli: ${MCP_ACCESS_ROLES.join(', ')})`);
          const before = effectiveAccess(a.role, st.access[a.role]?.servers[s.id]);
          let undo: string | undefined;
          if (m.agentAccess) undo = m.agentAccess(a.role, s.id, v).undo; else m.setAccess({ role: a.role, server: s.id, access: v as McpToolAccess });
          log.info('appctl', 'Orchestrator changed a role\'s MCP access', { chat: d.callerId, data: { server: s.id, role: a.role } });
          if (undo) tell(`L’Orchestrator ha cambiato chi usa «${s.label}»`, `${a.role}: ${JSON.stringify(before)} → ${JSON.stringify(v)}`, undo);
          return { server: s.id, role: a.role, before, after: effectiveAccess(a.role, v as McpToolAccess), ...(undo ? { changeId: undo } : {}) };
        }
        const def = defOf(s);
        const FIELDS = ['enabled', 'label', 'purpose', 'command', 'args', 'env', 'url', 'headers', 'tokens'] as const;
        if (!(FIELDS as readonly string[]).includes(key)) throw new Error(`key: access | ${FIELDS.join(' | ')}`);
        if (key === 'enabled' && typeof a.value !== 'boolean') throw new Error('enabled: true | false');
        const next: McpServerDef = key === 'tokens'
          ? { ...def, secrets: (Array.isArray(a.value) ? a.value : []).map(n => (def.transport === 'stdio' ? { where: 'env' as const, name: String(n) } : { where: 'header' as const, name: String(n), ...(String(n).toLowerCase() === 'authorization' ? { prefix: 'Bearer ' } : {}) })) }
          : { ...def, [key]: a.value } as McpServerDef;
        if (!m.agentSave) { m.save({ def: next, previousId: s.id }); return { server: s.id, changed: key }; }
        const r = m.agentSave(next, s.id);
        log.info('appctl', 'Orchestrator changed an MCP server', { chat: d.callerId, data: { server: s.id, key } });
        tell(key === 'enabled' ? `L’Orchestrator ha ${a.value ? 'acceso' : 'spento'} il server MCP «${s.label}»` : `L’Orchestrator ha modificato il server MCP «${s.label}»`, key === 'enabled' ? (a.value ? 'acceso' : 'spento') : `campo ${key}`, r.undo);
        return { server: r.id, changed: key, changeId: r.undo, ...(key === 'command' || key === 'args' || key === 'env' || key === 'url' ? { note: 'a token saved for the old command or address is not used for the new one: the user types it again' } : {}) };
      }
    }
    throw new Error(`action ${action} non vale per l'area connector (get | add | set | remove | test | form | undo)`);
  };
  return {
    name: 'app_config',
    description: `Read and change the app's configuration for the user, exactly as their own click in the app would (every change is logged with its Annulla). action "get" (read, optional query), "set", "undo", "history"; for connectors also "add", "remove", "test", "form". area: "setting" (every key of Impostazioni and more: key + value; get lists key, label, description, type, current value), "view" (theme system|light|dark, density comfortable|compact, workProfile: key + value), "agent" (a role's card in Brain → Agenti: agentId + key = one of ${AGENT_FIELDS.join('|')} + value; undo with agentId + version when set made a new version (text, skills, model, tier), else set the "before" value back), "connector" (the MCP servers of Impostazioni → Connettori: get = each server, how it runs, its token slots set|missing and who may use it; add = snippet (what the user pasted: a Claude Desktop/Cursor "mcpServers" JSON, a command line like "npx -y @x/server", or an http(s) URL; server = which one when the JSON has several) or def {label, transport stdio|http, command, args, env, url, headers, secrets:[{where env|header, name, prefix?}], purpose}; set = server + key enabled (boolean) | access (role ${MCP_ACCESS_ROLES.join('|')} + value all|read|none|{tools:[...]}) | label | purpose | command | args | env | url | headers | tokens (the token variable or header names); remove = server; test = server (opens it as a chat would and lists its tools); form = snippet or def: opens the add form prefilled for the user; undo = changeId from add/set/remove), "profile" (Il mio profilo, the brain's me.md: get, or set key name|role|language|mainWork (array of lines)|replyStyle + value), "later" («Rispondi dopo»: value true|false). Change only what the user asked in their own words in the last ${CONFIG_ASK_MIN} minutes; then tell them in one line what changed and that Annulla is on the change's card. Never secret values: never put a token in snippet, def, env or headers (a pasted one is dropped before anything is kept); when a server needs a token, say which one and that they type it in its card (form opens it); logins stay the user's. Where a setting is on screen: app_guide / app_ui outline.`,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: { type: 'object', additionalProperties: false, required: ['action', 'area'], properties: {
      action: { type: 'string', enum: ['get', 'set', 'undo', 'history', 'add', 'remove', 'test', 'form'] }, area: { type: 'string', enum: [...AREAS] },
      key: { type: 'string', description: 'setting key, view field, agent field, or connector field (enabled|access|label|purpose|command|args|env|url|headers|tokens)' }, value: { description: 'the new value (JSON type of the field)' },
      snippet: { type: 'string', description: 'connector add/form: what the user pasted (JSON, command line or URL), secrets left out' }, def: { type: 'object', description: 'connector add/form: a server definition without secret values' },
      query: { type: 'string', description: 'get: words to filter by (label, key, description)' }, agentId: { type: 'string' }, server: { type: 'string' }, role: { type: 'string' },
      changeId: { type: 'string', description: 'undo of a setting (the change id from set or history) or of a connector change (the changeId it returned)' }, version: { type: 'integer', description: 'undo of an agent: the version to restore' },
      reason: { type: 'string', description: 'the user\'s ask, in a few words (a role change keeps it in its history)' },
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
            // without words: one short line per key (the full rows of all 86 keys are ~6k tokens)
            if (!q) return d.brain.settingsSchema().map(x => `${x.key}${x.key.includes('*') ? '' : `=${JSON.stringify(getAt(s, x.key))}`} · ${x.label}`).join('\n');
            return d.brain.settingsSchema().filter(x => matches(q, `${x.key} ${x.label} ${x.description}`)).map(x => ({
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
          const r = await d.view.apply({ [key]: a.value });
          if (!r) throw new Error('la finestra non ha risposto: riprova tra un attimo');
          if (!r.ok) throw new Error(r.error ?? `valore non valido per ${key} (vedi app_config get area view)`);
          log.info('appctl', 'Orchestrator changed a view preference', { chat: d.callerId, data: { key } });
          return { changed: key, before: before ? (before as unknown as Record<string, unknown>)[key] : null, after: (r.view as unknown as Record<string, unknown>)[key], undo: 'set it back with the "before" value' };
        }
        case 'agent': {
          if (!d.agents) throw new Error('ruoli non disponibili');
          if (action === 'get') return (a.agentId ? [role(a.agentId)] : d.agents.list().profiles).map(roleView);
          if (action === 'history') return d.agents.history(role(a.agentId).id).slice(-10).map(v => ({ version: v.version, at: new Date(v.at).toISOString(), author: v.author, reason: v.reason, state: v.state, ...(v.changed ? { changed: v.changed } : {}), ...(v.amended ? { amended: v.amended.map(x => x.reason) } : {}) }));
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
          // its own tools and permission ceiling stay the user's click on its card: a turn that read untrusted text
          // must not be able to widen the Orchestrator itself
          if (old.id === 'orchestrator' && (key === 'tools' || key === 'permissionCeiling')) throw new Error('bloccato: i permessi dell’Orchestrator li cambia solo l’utente, dalla sua carta in Brain → Agenti');
          const p = d.agents.save({ ...draftOf(old), [key]: a.value } as AgentDraft, old.id, `Modificato dall’Orchestrator su richiesta dell’utente${reason ? `: ${reason}` : ''}`.slice(0, 600));
          if (p.updatedAt === old.updatedAt) return { agentId: p.id, unchanged: true, note: 'già così' };
          log.info('appctl', 'Orchestrator changed a role', { chat: d.callerId, data: { role: p.id, key, version: p.activeVersion } });
          const before = (old as unknown as Record<string, unknown>)[key] ?? null;
          // tools, permissions and limits change the version in use in place (ADR 0186): undo = set the old value back
          return { agentId: p.id, changed: key, before, after: (p as unknown as Record<string, unknown>)[key] ?? null, version: p.activeVersion,
            undo: p.activeVersion === old.activeVersion ? { agentId: p.id, key, value: before, how: 'set it back with the "before" value (same version)' } : { agentId: p.id, version: old.activeVersion } };
        }
        case 'connector': return connector(action, a, reason);
        case 'profile': {
          if (!d.profile) throw new Error('profilo non disponibile');
          const r = await d.profile.get();
          if (!r.ok) throw new Error(r.reason === 'no-brain' ? 'nessun brain scelto: il profilo vive nel suo me.md' : `me.md non leggibile (${r.reason})`);
          const p = r.profile;
          const fields = Object.fromEntries(PROFILE_FIELDS.map(k => [k, p[k]]));
          if (action === 'get') return { ...fields, locked: p.locked, rules: p.rules.map(x => x.title) };
          if (action !== 'set') break;
          const key = String(a.key ?? '');
          if (!(PROFILE_FIELDS as readonly string[]).includes(key)) throw new Error(`key: ${PROFILE_FIELDS.join(' | ')}`);
          if (p.locked.includes(key as (typeof PROFILE_FIELDS)[number])) throw new Error(`il campo ${key} di me.md ha una forma che l'app non cambia da sola: usa la skill brain-edit`);
          const ok = key === 'mainWork' ? Array.isArray(a.value) && a.value.every(x => typeof x === 'string') : typeof a.value === 'string';
          if (!ok) throw new Error(key === 'mainWork' ? 'mainWork: array of lines' : `${key}: text`);
          asked('il profilo');
          const after = await d.profile.save({ revision: p.revision, fields: { [key]: a.value } });
          log.info('appctl', 'Orchestrator changed the profile', { chat: d.callerId, data: { key } });
          return { changed: key, before: (fields as Record<string, unknown>)[key], after: (after as unknown as Record<string, unknown>)[key], undo: 'set it back with the "before" value' };
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
