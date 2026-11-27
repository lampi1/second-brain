// app_config: the Orchestrator reads and changes the app's configuration for the user (ADR 0149; the owner, 2026-10-24:
// "deve poter modificare ogni cosa richiesta dell'utente", every configuration). One tool, five areas, each through the
// module that already owns it, never a second write path:
// - setting: every key of the settings schema (brain/settings-schema.ts) via config.request with `direct` (the owner
//   chose that protected keys change at once too), logged as the agent's change with its Annulla (undo / history);
// - view: theme, density, work profile (renderer prefs, lib/view-prefs.ts) via ui:command 'prefs';
// - agent: a role's card (Brain → Agenti) via the same save as the page (a new version for text or skills,
//   undo = the previous version; tools, permissions and limits change the version in use, undo = set the old value, ADR 0186);
// - connector: the MCP servers of Settings → Connettori (ADR 0207; the owner, 2026-10-30: «MCP deve essere facilissimo
//   configurarlo anche per l'Orchestrator»): add (a definition, or what the user pasted: JSON, command line or URL),
//   edit a field, on/off, a role's access (the Orchestrator too), remove, test, each undoable («Annulla» on
//   the feed card it posts, or action undo); "form" opens the add form prefilled for the user. Token values never: a
//   pasted secret is dropped before anything is kept or answered, the user types tokens in Settings; the accounts'
//   logins stay the user's;
// - profile: Settings → Il mio profilo (the managed fields of the brain's me.md: name, role, language, main work, reply
//   style) via the same save as the page (ADR 0207), its revision checked; undo = set the "before" value back;
// - later: «Rispondi dopo».
// Every change needs the user's own typed message to this Orchestrator, or their «Sì» to one of its native questions
// (userAsked: appctl/user-words.ts), in the last minutes or still in the turn it started (the owner, 2026-11-01: «ti
// devo sempre scrivere in chat le parole esatte»). In its first minutes app news or an agent's mail after it do not void
// it (ADR 0371); a strict change (STRICT_AGENT_KEYS, a protected setting, connectors, undo, the profile: what widens
// what agents may do) holds only with nothing but his own words since, so neither app news, an agent's mail, quoted
// text nor a turn they woke can make it; the Orchestrator's own tools and permission ceiling stay the user's click. Secrets are never read or written.
// Mounted only on the authenticated Orchestrator endpoint by appctl/tools.ts.
import type { ChangeBy, SettingChange, SettingDef, SettingRequestResult, Settings } from '../../shared/contract';
import type { AgentCatalog, AgentDraft, AgentProfile, AgentVersion } from '../../shared/agents';
import type { FeedAction } from '../../shared/contract';
import type { OwnerProfile, ProfileResult, ProfileSave } from '../../shared/profile';
import { runsOf, MCP_ACCESS_ROLES, effectiveAccess, type McpServerDef, type McpServersState, type McpServerView, type McpToolAccess } from '../../shared/mcp-servers';
import { parseMcpSnippet, publicDraft } from '../../shared/mcp-paste';
import { cardPresets, checkedPresets, type FullPresets, type ModelPreset, type RolePresets } from '../../shared/model-presets';
import { checkedLevels, type FullLevels, type LevelModel, type RoleLevels } from '../../shared/model-levels';
import { defOf, getAt, validate } from '../brain/settings-schema';
import { namesInOrder, sentencesOf, wordsOf } from '../../shared/engine-order';
import { ToolRefusal } from '../mcp/refusal';
import type { HeldChange, PendingChange } from './pending-config';
import { addRedaction, log } from '../log';
import type { ToolDef } from './tools';

export interface ViewPrefsRead { theme: string; density: string; workProfile: string | null; orchestratorOpen: boolean; workProfiles: { id: string; title: string }[] }
export interface ConfigDeps {
  callerId: string;
  /** the user wrote to this Orchestrator in the last few minutes (their ask, not an agent's); strict: and nothing but
   *  his own words came since (ADR 0371: a change that widens what agents may do) */
  userAsked(strict?: boolean): boolean;
  /** what the user's last «Sì» to this Orchestrator was about, when recent (user-words.ts answeredText); null = none */
  saidYesTo?(): { text: string; used(): void } | null;
  /** a change that is not applied stays «da applicare» on its own panel (pending-config.ts, ADR 0361) */
  held?: { hold(c: Omit<PendingChange, 'id' | 'at'>): PendingChange; applied(c: HeldChange): void };
  brain: {
    settings(): Settings; settingsSchema(): SettingDef[]; settingsHistory(limit?: number): SettingChange[];
    undoSetting(changeId: string, by?: ChangeBy, origin?: { chatId?: string; direct?: boolean }): SettingChange;
    requestSetting(key: string, value: unknown, origin: { by: ChangeBy; chatId?: string; reason?: string; direct?: boolean }): SettingRequestResult;
  };
  /** apply: the renderer's checked setter (lib/view-prefs.ts), the result as it reads after it; null = no answer */
  view?: { read(): Promise<ViewPrefsRead | null>; apply(patch: Record<string, unknown>): Promise<{ ok: boolean; error?: string; view: ViewPrefsRead } | null> };
  agents?: { list(): AgentCatalog; save(draft: AgentDraft, id: string, reason?: string): AgentProfile; history(id: string): AgentVersion[]; restore(id: string, version: number): AgentProfile;
    /** the card's three presets, Base on the registry's model when it has none (catalog.presetsOf, ADR 0336); absent = cardPresets */
    presetsOf?(p: AgentProfile): FullPresets;
    /** the card's three ordered lists (catalog.levelsFor, ADR 0347); absent = none shown */
    levelsOf?(p: AgentProfile): FullLevels };
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
/** a turn the user's ask started (or their «Sì» answered) keeps that ask this long while it runs */
export const CONFIG_TURN_MIN = 120;
const AREAS = ['setting', 'view', 'agent', 'connector', 'profile', 'later'] as const;
const PROFILE_FIELDS = ['name', 'role', 'language', 'mainWork', 'replyStyle'] as const;
/** The role card's fields an edit may set (name, summary and character are the role's own, fixed) */
/** A role's fields whose change widens what its agents may do or read as their rules: strict proof (ADR 0371). */
export const STRICT_AGENT_KEYS: readonly string[] = ['instructions', 'skills', 'launches', 'tools', 'permissionCeiling', 'codeMode'];
export const AGENT_FIELDS = ['instructions', 'engine', 'model', 'effort', 'maxContext', 'skills', 'launches', 'tools', 'permissionCeiling', 'presets', 'levels', 'engineOrder', 'codeMode', 'fast'] as const;
const VIEW_FIELDS = ['theme', 'density', 'workProfile'] as const;

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const matches = (q: string, text: string) => { const w = norm(q).split(/\s+/).filter(Boolean); const h = norm(text); return w.every(x => h.includes(x)); };

/** The editable part of a role, as the page sends it to agents:save. */
export function draftOf(p: AgentProfile): AgentDraft {
  return { ...(p.knowhow ? { knowhow: p.knowhow } : {}), ...(p.pack ? { pack: p.pack } : {}), name: p.name, purpose: p.purpose, instructions: p.instructions, engine: p.engine, model: p.model,
    ...(p.effort ? { effort: p.effort } : {}), avatar: p.avatar, tools: p.tools, permissionCeiling: p.permissionCeiling, ...(p.maxContext !== undefined ? { maxContext: p.maxContext } : {}),
    tier: p.tier, tierMax: p.tierMax, ...(p.presets ? { presets: structuredClone(p.presets) } : {}), ...(p.codeMode ? { codeMode: true } : {}), ...(p.fast ? { fast: true } : {}),
    launches: [...p.launches], skills: [...p.skills] };
}

const showPreset = (p: ModelPreset) => `${p.model ?? 'modello del livello'}${p.effort ? ` / ${p.effort}` : ''}`;
/** app_config's presets value { min?, base, max? }, each { model, effort? } (ADR 0336), as the card's own presets (min and
 *  max; checkedPresets, the check the card's save runs too). Base is the card's model and effort and must stay so (they
 *  change with key model / effort); an engine other than the card's is refused (one engine per role). The models are
 *  checked against the engine by the card's save (catalog.ts). A JSON string is read too. Throws a clear refusal. */
export function presetsValue(v: unknown, card: AgentProfile, base: ModelPreset): RolePresets {
  const shape = 'presets: un oggetto { min?, base, max? }, ognuno { model, effort? }';
  let o = v;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { throw new Error(`${shape}.`); } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error(`${shape}.`);
  const { base: b, engine, ...rest } = o as Record<string, unknown>;
  if (engine !== undefined && engine !== card.engine) throw new Error(`presets: il ruolo ${card.id} gira solo sul motore ${card.engine} (un motore per ruolo, i preset sono suoi modelli); per cambiare motore usa key engine.`);
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error(`presets: manca base { model, effort? }: è il modello della scheda e resta quello (ora ${showPreset(base)}).`);
  const bm = (b as Record<string, unknown>).model, be = (b as Record<string, unknown>).effort;
  const model = bm === '' || bm === 'null' || bm === undefined ? null : bm;
  const okModel = model === (card.model ?? null) || model === (base.model ?? null);
  if (!okModel || (be ?? null) !== (card.effort ?? null)) throw new Error(`presets: base deve restare il modello e l'effort della scheda (${showPreset(base)}); per cambiarli usa key model / effort.`);
  return checkedPresets(rest) ?? {};
}
/** A card's lists as it stores them (#468): its own lists, else its Base and its own Minimo / Massimo on its engine (a level
 *  it never set keeps following Base). The undo of a levels change sets this back. */
export function storedLevels(p: AgentProfile): RoleLevels {
  if (p.levels && Object.keys(p.levels).length) return structuredClone(p.levels);
  const at = (x: ModelPreset): LevelModel => ({ engine: p.engine, model: x.model, ...(x.effort ? { effort: x.effort } : {}) });
  return { base: [at({ model: p.model ?? null, ...(p.effort ? { effort: p.effort } : {}) })], ...(p.presets?.min?.model ? { min: [at(p.presets.min)] } : {}), ...(p.presets?.max?.model ? { max: [at(p.presets.max)] } : {}) };
}
/** app_config's levels value (#468): { min?, base?, max? }, each an ordered list of { engine, model | null, effort? }, from
 *  any engine, checked like the role page (checkedLevels: at most 8 per level, no engine + model twice); the models are
 *  checked against their engines by the card's save. The Orchestrator has Base only (it runs on its chat's engine and is
 *  never launched at a level: the first model of the list on that engine is the one it starts on). A JSON string is read too. */
export function levelsValue(v: unknown, card: AgentProfile): RoleLevels {
  let o = v;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { throw new Error('levels: un oggetto { min?, base?, max? }, ognuno una lista ordinata di { engine, model, effort? }.'); } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('levels: un oggetto { min?, base?, max? }, ognuno una lista ordinata di { engine, model, effort? }.');
  const raw = o as Record<string, unknown>;
  if (card.id === 'orchestrator' && (raw.min !== undefined || raw.max !== undefined)) throw new Error('levels: l’Orchestrator ha solo Base (gira sul motore della sua chat e non parte mai a un livello): manda { base: [...] }.');
  // a level left out keeps its list; an empty list ([]) sends Minimo or Massimo back to following Base
  const kept = storedLevels(card);
  const l = checkedLevels(card.id === 'orchestrator' ? { base: kept.base, ...raw } : { ...kept, ...raw });
  if (!l) throw new Error('levels: serve almeno un livello con almeno un modello ({ base: [{ engine, model, effort? }] }).');
  if (!l.base?.length) throw new Error('levels: Base ha almeno un modello.');
  return l;
}
/** A change as its panel says it: the whole change in one canonical sentence (and, for a long text, the text itself), and
 *  for an order of the engines the words that name it too. */
export interface ChangeWords { text: string; full?: string; order?: { engines: readonly (readonly string[])[]; others: readonly (readonly string[])[]; and?: readonly string[]; never?: readonly string[] } }
/** Whether a card's words name this very change: the canonical sentence, word for word, or, for an order, one sentence that
 *  names those engines in that order and no other. Nothing looser: a yes to a similar card is no yes to this change. */
export function names(card: string, w: ChangeWords): boolean {
  if (w.full !== undefined) return false; // a long text is never named by a short card
  return sentencesOf(card).some(x => x.trim() === wordsOf(w.text).trim()) || !!w.order && namesInOrder(card, w.order.engines, w.order);
}
/** An engine's names as a person says them: its label, its id, and OpenAI for the engine whose models are OpenAI's. */
const engineNames = (c: AgentCatalog | undefined) => (id: string): string[] => {
  const e = c?.models.find(m => m.engine === id);
  const openai = !!e?.models.length && e.models.every(m => /^openai\//i.test(m.id));
  return [...(openai ? ['OpenAI'] : []), ...(e ? [e.label] : []), id];
};
const shown = (v: unknown): string => typeof v === 'string' ? v : v === true ? 'acceso' : v === false ? 'spento' : JSON.stringify(v);
const orderWords = (c: AgentCatalog | undefined, ids: readonly string[]) => {
  const engine = engineNames(c);
  return { engines: ids.map(engine), others: (c?.models ?? []).map(m => m.engine as string).filter(id => !ids.includes(id)).map(engine).filter(n => !ids.some(id => engine(id).some(x => n.includes(x)))) };
};
/** A settings change in words. */
export function settingWords(key: string, value: unknown, c: AgentCatalog | undefined): ChangeWords {
  const engine = engineNames(c);
  if (key === 'engineOrder') {
    const ids = value as string[];
    return ids.length ? { text: `Ordine dei motori per tutti i ruoli: ${ids.map(x => engine(x)[0]).join(', poi ')}.`,
      // a sentence about one role is that role's exception, never everybody's order
      order: { ...orderWords(c, ids), and: ['tutti i ruoli', 'ogni ruolo', 'ordine dei motori', 'all roles', 'every role', 'alle Rollen'], never: (c?.profiles ?? []).flatMap(p => [p.name, p.id]) } }
      : { text: 'Ordine dei motori per tutti i ruoli: nessuno, vale quello delle liste di ogni livello.' };
  }
  if (key === 'engineThresholds') {
    const rows = Object.entries(value as Record<string, number>);
    return { text: `Soglie dei motori: ${rows.map(([id, n]) => `${engine(id)[0]} ${n}%`).join(', ') || 'nessuna'}.` };
  }
  return { text: `${defOf(key)?.label ?? key}: ${shown(value)}.` };
}
/** A role card's change in words. */
export function agentWords(p: AgentProfile, key: string, value: unknown, c: AgentCatalog): ChangeWords {
  const engine = engineNames(c);
  if (key === 'levels') {
    const l = value as RoleLevels, at = (x: LevelModel) => `${engine(x.engine)[0]} ${c.models.find(m => m.engine === x.engine)?.models.find(m => m.id === x.model)?.name ?? x.model ?? 'predefinito'}${x.effort ? ` ${x.effort}` : ''}`;
    const kept = storedLevels(p), changed = (['base', 'min', 'max'] as const).filter(id => JSON.stringify(l[id] ?? []) !== JSON.stringify(kept[id] ?? []));
    const level = { min: 'Minimo', base: 'Base', max: 'Massimo' };
    return { text: `${p.name}, modelli per livello. ${(changed.length ? changed : (['base'] as const)).map(id => `${level[id]}: ${(l[id] ?? []).map(at).join(', poi ') || 'come Base'}`).join('. ')}.` };
  }
  if (key === 'engineOrder') {
    const ids = Array.isArray(value) ? value as string[] : [];
    return ids.length ? { text: `${p.name}, eccezione all’ordine dei motori: ${ids.map(x => engine(x)[0]).join(', poi ')}.`, order: { ...orderWords(c, ids), and: [p.name, p.id], never: c.profiles.filter(x => x.id !== p.id).flatMap(x => [x.name, x.id]) } }
      : { text: `${p.name}: nessuna eccezione, segue l’ordine dei motori di tutti.` };
  }
  // the whole text is on the panel: what he reads is what is applied
  if (key === 'instructions') return { text: `${p.name}, nuove istruzioni (${String(value).length} caratteri).`, full: String(value) };
  return { text: `${p.name}, ${key}: ${shown(value)}.` };
}
/** A role card with one field changed, as its save takes it. */
export const changedDraft = (p: AgentProfile, key: string, value: unknown): AgentDraft => ({ ...draftOf(p), [key]: value }) as AgentDraft;
export const roleReason = (reason?: string): string => `Modificato dall’Orchestrator su richiesta dell’utente${reason ? `: ${reason}` : ''}`.slice(0, 600);

const roleView = (p: AgentProfile, presets: FullPresets, levels?: FullLevels) => ({ id: p.id, name: p.name, activeVersion: p.activeVersion, engine: p.engine, model: p.model, effort: p.effort ?? null,
  codeMode: p.codeMode === true, ...(p.engine === 'cursor' ? { fast: p.fast === true } : {}), maxContext: p.maxContext ?? null, skills: p.skills, launches: p.launches, tools: p.tools, permissionCeiling: p.permissionCeiling, presets, ...(levels ? { levels: p.id === 'orchestrator' ? { base: levels.base } : levels } : {}), ...(p.trial ? { trial: p.trial } : {}),
  ...(p.engineOrder?.length ? { engineOrder: p.engineOrder } : {}), instructions: p.instructions.length > 400 ? `${p.instructions.slice(0, 400)}… (${p.instructions.length} chars)` : p.instructions });

export function configTool(d: ConfigDeps): ToolDef {
  const asked = (what: string, strict = false) => {
    if (d.userAsked(strict)) return;
    throw new Error(strict
      ? `bloccato: cambia ${what} solo quando l'utente te lo chiede, senza nessun altro messaggio dopo (né di agenti né dell'app), perché questa modifica allarga ciò che gli agenti possono fare: un suo messaggio o un suo «Sì» a una tua domanda, negli ultimi ${CONFIG_ASK_MIN} minuti o nello stesso turno; chiediglielo con una domanda Sì/No`
      : `bloccato: cambia ${what} solo quando l'utente te lo chiede: un suo messaggio o un suo «Sì» a una tua domanda, negli ultimi ${CONFIG_ASK_MIN} minuti (anche se dopo sono arrivati messaggi di agenti o dell'app) o nello stesso turno senza altri messaggi dopo; chiediglielo con una domanda Sì/No`);
  };
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
    const tell = (title: string, detail: string, undo: string, activate?: { server: string; runs: string }) => d.announce?.({ kind: 'connector-changed', title, detail: `${detail} · ${reason ? `richiesta: ${reason}` : 'su tua richiesta'}`, action: { kind: 'connector-undo', undo, ...(activate ? { activate } : {}) } });
    // what the Orchestrator adds, or whose command, arguments, variables or address it changes, is saved off and waits for
    // the user's own «Attiva» on its card (ADR 0207: a prompt injection plus a quick "ok" never starts a program)
    const held = (def: McpServerDef): McpServerDef => ({ ...def, enabled: false, awaiting: { runs: runsOf(def), at: Date.now() } });
    const ACTIVATE = 'it is saved OFF: tell the user to read what it runs on its card (feed or Impostazioni → Connettori) and click «Attiva»; only then can it be tested or used';
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
        // never the user's own origin marks: importedFrom, awaiting
        const { importedFrom: _i, awaiting: _w, ...given } = a.def as Record<string, unknown>; void _i; void _w;
        const def = { enabled: true, secrets: [], ...given } as unknown as McpServerDef;
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
        asked('i connettori', true);
        const draft = draftFrom();
        const r = m.agentSave(held(draft.def));
        const s = m.state().servers.find(x => x.id === r.id);
        const runs = s ? runsOf(s) : '';
        log.info('appctl', 'Orchestrator added an MCP server (off until the user activates it)', { chat: d.callerId, data: { server: r.id, transport: s?.transport } });
        tell(`L’Orchestrator ha aggiunto il server MCP «${s?.label ?? r.id}»: è spento finché non premi «Attiva»`, `avvia: ${runs}`, r.undo, { server: r.id, runs });
        return { added: r.id, state: 'off, waiting for the user\'s «Attiva»', runs, changeId: r.undo, tokensMissing: draft.tokens, ...(draft.dropped.length ? { leftOut: draft.dropped } : {}),
          next: `${ACTIVATE}${draft.tokens.length ? '; before that they type the token(s) in the same card (action form opens it)' : ''}`, undo: 'action undo with this changeId, or Annulla on its card' };
      }
      case 'remove': {
        if (!m.agentRemove) throw new Error('non disponibile');
        const s = find(a.server);
        asked('i connettori', true);
        const r = m.agentRemove(s.id);
        log.info('appctl', 'Orchestrator removed an MCP server', { chat: d.callerId, data: { server: s.id } });
        tell(`L’Orchestrator ha tolto il server MCP «${s.label}»`, 'tolto con i suoi token e gli accessi dei ruoli: «Annulla» lo rimette com’era', r.undo);
        return { removed: s.id, changeId: r.undo, undo: 'action undo with this changeId (tokens and access come back too)' };
      }
      case 'undo': {
        if (!m.undo) throw new Error('non disponibile');
        asked('i connettori', true);
        m.undo(String(a.changeId ?? ''));
        log.info('appctl', 'Orchestrator undid a connector change', { chat: d.callerId });
        return { undone: a.changeId };
      }
      case 'test': {
        if (!m.test) throw new Error('non disponibile');
        const s = find(a.server);
        // a test starts the server's command: the user's ask, like a change, and never before their «Attiva»
        if (s.awaiting) throw new Error(`«${s.label}» aspetta «Attiva»: ${ACTIVATE}`);
        asked('i connettori', true);
        const after = (await m.test(s.id)).servers.find(x => x.id === s.id);
        const t = after?.lastTest;
        return t ? (t.ok ? { server: s.id, ok: true, tools: t.tools.length, reading: t.tools.filter(x => x.readOnly).length, ms: t.ms } : { server: s.id, ok: false, error: t.error }) : { server: s.id, ok: false };
      }
      case 'set': {
        const s = find(a.server);
        asked('i connettori', true);
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
        if (key === 'enabled' && a.value === true && s.awaiting) throw new Error(`«${s.label}» aspetta «Attiva»: ${ACTIVATE}`);
        const repoint = key === 'command' || key === 'args' || key === 'env' || key === 'url';
        const next: McpServerDef = key === 'tokens'
          ? { ...def, secrets: (Array.isArray(a.value) ? a.value : []).map(n => (def.transport === 'stdio' ? { where: 'env' as const, name: String(n) } : { where: 'header' as const, name: String(n), ...(String(n).toLowerCase() === 'authorization' ? { prefix: 'Bearer ' } : {}) })) }
          : { ...def, [key]: a.value } as McpServerDef;
        const saved = repoint ? held(next) : next;
        if (!m.agentSave) { m.save({ def: saved, previousId: s.id }); return { server: s.id, changed: key, ...(repoint ? { state: 'off, waiting for the user\'s «Attiva»', next: ACTIVATE } : {}) }; }
        const r = m.agentSave(saved, s.id);
        const after = m.state().servers.find(x => x.id === r.id);
        const runs = after ? runsOf(after) : runsOf(saved);
        log.info('appctl', 'Orchestrator changed an MCP server', { chat: d.callerId, data: { server: s.id, key, held: repoint } });
        tell(key === 'enabled' ? `L’Orchestrator ha ${a.value ? 'acceso' : 'spento'} il server MCP «${s.label}»` : repoint ? `L’Orchestrator ha cambiato cosa avvia «${s.label}»: è spento finché non premi «Attiva»` : `L’Orchestrator ha modificato il server MCP «${s.label}»`,
          key === 'enabled' ? (a.value ? 'acceso' : 'spento') : repoint ? `avvia: ${runs}` : `campo ${key}`, r.undo, repoint || after?.awaiting ? { server: r.id, runs } : undefined);
        return { server: r.id, changed: key, changeId: r.undo, ...(repoint ? { state: 'off, waiting for the user\'s «Attiva»', runs, next: ACTIVATE, note: 'a token saved for the old command or address is not used for the new one: the user types it again' } : {}) };
      }
    }
    throw new Error(`action ${action} non vale per l'area connector (get | add | set | remove | test | form | undo)`);
  };
  return {
    name: 'app_config',
    description: `Read and change the app's configuration for the user, exactly as their own click in the app would (every change is logged with its Annulla). action "get" (read, optional query), "set", "undo", "history"; for connectors also "add", "remove", "test", "form". area: "setting" (every key of Impostazioni and more: key + value; get lists key, label, description, type, current value), "view" (theme system|light|dark, density comfortable|compact, workProfile: key + value), "agent" (a role's card in Brain → Agenti: agentId + key = one of ${AGENT_FIELDS.join('|')} + value; codeMode = true|false, the role's chats work through run_code (not the Orchestrator; full on Claude, partial elsewhere); fast = true|false (Cursor only); presets = the role's Minimo/Base/Massimo (its page, ADR 0336), value {min?, base, max?} each {model, effort?}: base must be the card's current model and effort (change them with key model|effort), min and max only models of the role's one engine, omitted = the same as Base, {base} alone clears them; get returns each role's presets and levels; levels = the role's ordered model lists per level (ADR 0347, the page's «Modelli per livello»), value {min?, base?, max?} each an ordered list (first = best, at most 8, no engine + model twice) of {engine, model (null = the engine's default), effort?} from ANY engine: this is how to put models of several engines in one level; a level left out keeps its list, [] sends min/max back to following base, and the head of base becomes the card's engine, model and effort; engineOrder = this role's exception to the one engine order (a list of engine ids, [] = none: the one order is the setting engineOrder, with engineThresholds the % past which the next engine starts; to put an engine first or last for every role set that setting, never every role's lists); the Orchestrator has base only (its chat starts on the first model of the list on its engine); undo of presets or levels = set the undo.value it returned (levels also posts a card with Annulla); undo with agentId + version when set made a new version (text, skills), else set the "before" value back), "connector" (the MCP servers of Impostazioni → Connettori: get = each server, how it runs, its token slots set|missing and who may use it; add = (saved OFF until the user's own «Attiva» on its card, which shows what it runs; so is a change of command|args|env|url; no test before it) snippet (what the user pasted: a Claude Desktop/Cursor "mcpServers" JSON, a command line like "npx -y @x/server", or an http(s) URL; server = which one when the JSON has several) or def {label, transport stdio|http, command, args, env, url, headers, secrets:[{where env|header, name, prefix?}], purpose}; set = server + key enabled (boolean) | access (role ${MCP_ACCESS_ROLES.join('|')} + value all|read|none|{tools:[...]}) | label | purpose | command | args | env | url | headers | tokens (the token variable or header names); remove = server; test = server (opens it as a chat would and lists its tools); form = snippet or def: opens the add form prefilled for the user; undo = changeId from add/set/remove), "profile" (Il mio profilo, the brain's me.md: get, or set key name|role|language|mainWork (array of lines)|replyStyle + value), "later" («Rispondi dopo»: value true|false). Change only what the user asked: their own message, or their «Sì» to your native yes/no question naming the exact change, in the last ${CONFIG_ASK_MIN} minutes or the turn it started (a setting or role change they did not ask yet: just call set; the app keeps it «da applicare» and asks them itself with the exact change, so never ask twice); then tell them in one line what changed and that Annulla is on the change's card. Never secret values: never put a token in snippet, def, env or headers (a pasted one is dropped before anything is kept); when a server needs a token, say which one and that they type it in its card (form opens it); logins stay the user's. Where a setting is on screen: app_guide / app_ui outline.`,
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
      /** The proof of a change (ADR 0361): the user's ask as always, or their recent «Sì» to a card that names this very
       *  change. Else it is not applied and stays «da applicare» on a panel the app writes. */
      const proven = (c: HeldChange, what: string, words: ChangeWords, strict = false) => {
        if (d.userAsked(strict)) return;
        const yes = d.saidYesTo?.() ?? null;
        // one yes, one change: the proof is spent with it
        if (yes !== null && names(yes.text, words)) { yes.used(); return; }
        const why = 'serviva un tuo messaggio, o un tuo Sì a un pannello che nomina questa modifica';
        if (!d.held) { asked(what, strict); return; }
        const h = d.held.hold({ ...c, chatId: d.callerId, text: words.text, ...(words.full !== undefined ? { full: words.full } : {}), why, ...(reason ? { reason } : {}) });
        throw new ToolRefusal(`bloccato: ${why}. Non persa: è «da applicare» (${h.id}) su un pannello dell'app, il suo Sì la applica da solo. Non richiederla e non fargli un'altra domanda; digli in una riga che il pannello lo aspetta.`);
      };
      /** A change the user did ask and the app refused: the reason goes to the user, and the change stays «da applicare». */
      const refused = (c: HeldChange, words: ChangeWords, e: unknown): never => {
        const why = e instanceof Error ? e.message : String(e);
        if (d.held) { const h = d.held.hold({ ...c, chatId: d.callerId, text: words.text, ...(words.full !== undefined ? { full: words.full } : {}), why, ...(reason ? { reason } : {}) }); throw new Error(`${why} Non persa: è «da applicare» (${h.id}) su un pannello dell'app che dice il motivo.`); }
        throw e;
      };
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
            asked('le impostazioni', true);
            const ch = d.brain.undoSetting(String(a.changeId ?? ''), 'agent', { chatId: d.callerId, direct: true });
            log.info('appctl', 'Orchestrator undid a setting change', { chat: d.callerId, data: { key: ch.key } });
            return { undone: a.changeId, change: { id: ch.id, key: ch.key, value: ch.after } };
          }
          if (action !== 'set') break;
          const key = String(a.key ?? ''), ok = validate(key, a.value);
          if (!ok.ok) throw new Error(ok.error);
          const held: HeldChange = { area: 'setting', key, value: ok.value };
          // folders where Codex runs on its own are checked as they are now, at his own click in Impostazioni: never held
          // a protected key (autonomy, budgets, the brain's folder, the rules to the chats…) is strict (ADR 0371)
          if (defOf(key)?.type === 'repo-paths') asked('le impostazioni', true);
          else proven(held, 'le impostazioni', settingWords(key, ok.value, d.agents?.list()), defOf(key)?.protected === true);
          const r = d.brain.requestSetting(key, a.value, { by: 'agent', chatId: d.callerId, ...(reason ? { reason } : {}), direct: true });
          // refused by its own check after the proof: it stays «da applicare» with the reason (ADR 0361 point 8)
          if ('error' in r) return refused(held, settingWords(key, ok.value, d.agents?.list()), new Error(r.error));
          if ('applied' in r) d.held?.applied(held);
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
          const ag = d.agents;
          const presetsOf = (p: AgentProfile) => ag.presetsOf?.(p) ?? cardPresets(p);
          if (action === 'get') return (a.agentId ? [role(a.agentId)] : ag.list().profiles).map(p => roleView(p, presetsOf(p), ag.levelsOf?.(p)));
          if (action === 'history') return d.agents.history(role(a.agentId).id).slice(-10).map(v => ({ version: v.version, at: new Date(v.at).toISOString(), author: v.author, reason: v.reason, state: v.state, ...(v.changed ? { changed: v.changed } : {}), ...(v.amended ? { amended: v.amended.map(x => x.reason) } : {}) }));
          if (action === 'undo') {
            asked('i ruoli', true);
            const p = d.agents.restore(role(a.agentId).id, Number(a.version));
            log.info('appctl', 'Orchestrator restored a role version', { chat: d.callerId, data: { role: p.id, version: p.activeVersion } });
            return { agentId: p.id, activeVersion: p.activeVersion };
          }
          if (action !== 'set') break;
          const key = String(a.key ?? '');
          if (!(AGENT_FIELDS as readonly string[]).includes(key)) throw new Error(`key: ${AGENT_FIELDS.join(' | ')}`);
          const old = role(a.agentId);
          // its own tools and permission ceiling stay the user's click on its card: a turn that read untrusted text
          // must not be able to widen the Orchestrator itself
          if (old.id === 'orchestrator' && (key === 'tools' || key === 'permissionCeiling')) throw new Error('bloccato: i permessi dell’Orchestrator li cambia solo l’utente, dalla sua carta in Brain → Agenti');
          // "null" or "" for the model: the registry's model (an agent that cannot send a JSON null)
          // presets: { min?, base, max? } with Base the card's own model and effort (ADR 0336)
          const value = key === 'presets' ? presetsValue(a.value, old, presetsOf(old).base) : key === 'levels' ? levelsValue(a.value, old) : key === 'model' && (a.value === '' || a.value === 'null') ? null : a.value;
          const held: HeldChange = { area: 'agent', key, agentId: old.id, value };
          const words = agentWords(old, key, value, d.agents.list());
          proven(held, 'i ruoli', words, STRICT_AGENT_KEYS.includes(key));
          let p: AgentProfile;
          try { p = d.agents.save(changedDraft(old, key, value), old.id, roleReason(reason)); } catch (e) { return refused(held, words, e); }
          d.held?.applied(held);
          if (p.updatedAt === old.updatedAt) return { agentId: p.id, unchanged: true, note: 'già così' };
          log.info('appctl', 'Orchestrator changed a role', { chat: d.callerId, data: { role: p.id, key, version: p.activeVersion } });
          const field = (x: AgentProfile) => key === 'presets' ? presetsOf(x) : key === 'levels' ? storedLevels(x) : (x as unknown as Record<string, unknown>)[key] ?? null;
          const before = field(old);
          // presets: the view shows all three, the undo sets back what the card stored (its own Base, and min / max only
          // when it had them: the expanded view would pin them to the Base, or fail on a Base without a model)
          if (key === 'levels') {
            // the change's card in the feed, with its «Annulla» (the lists change the version in use in place)
            const list = (l: RoleLevels) => (['base', 'min', 'max'] as const).filter(id => l[id]?.length).map(id => `${id}: ${l[id]!.map(x => `${x.model ?? 'predefinito'} (${x.engine}${x.effort ? ` ${x.effort}` : ''})`).join(', ')}`).join(' · ');
            d.announce?.({ kind: 'agent-updated', title: `${p.name}: modelli per livello cambiati dall’Orchestrator`, detail: `${list(storedLevels(p))} · ${reason ? `richiesta: ${reason}` : 'su tua richiesta'}`,
              action: { kind: 'levels-undo', agentId: p.id, expectedRevision: p.updatedAt, levels: before as RoleLevels } });
          }
          // levels: a level the card did not have goes back to following Base ([]: a level left out would keep the new list)
          const undoValue = key === 'levels' ? old.id === 'orchestrator' ? { base: storedLevels(old).base } : { min: [], max: [], ...storedLevels(old) } : key === 'presets' ? { base: { model: old.model ?? null, ...(old.effort ? { effort: old.effort } : {}) }, ...(old.presets ? structuredClone(old.presets) : {}) } : before;
          // tools, permissions and limits change the version in use in place (ADR 0186): undo = set the old value back
          return { agentId: p.id, changed: key, before, after: field(p), version: p.activeVersion,
            undo: p.activeVersion === old.activeVersion ? { agentId: p.id, key, value: undoValue, how: 'set it back with this value (same version)' } : { agentId: p.id, version: old.activeVersion } };
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
          asked('il profilo', true);
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
