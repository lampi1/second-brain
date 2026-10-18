// The engine registry (ADR 0046): every engine the app can run a chat on, with the protocol it speaks (its kind: one
// adapter per kind, sessions.ts), how it starts and what it can do (caps). The app asks an engine's caps, never its
// name, so a new engine is one entry. Three sources, in order: the built-in Claude Code (stream-json) and Cursor
// (ACP), whose start is app code; the app's presets (Anthropic API: the Messages API on the
// user's key, ADR 0052; all off until the user turns them on); the
// brain's harness/models.json `engines` entries (an ACP CLI or an HTTP endpoint), which may add engines or change a
// preset (an id the app removed, REMOVED_ENGINES, is left out). Every engine's start definition has a fingerprint: an engine that is not built in starts only while its
// fingerprint is the one the user turned on (trust.ts), so an agent editing models.json can never make the app run
// another program or send a key to another host. Used by the chat manager, the settings schema, the CLI status and
// login (../cli.ts) and the renderer through AppInfo.engines.
import crypto from 'node:crypto';
import { ANTHROPIC_API, type EngineCaps, type EngineInfo, type EngineKind, type Harness } from '../../shared/contract';

/** How an engine starts: an ACP CLI's command, or an HTTP endpoint. Its fingerprint covers all of it. */
export interface EngineStart {
  /** ACP: the CLI's name on PATH or an absolute path */
  command?: string;
  /** ACP: the arguments that start its ACP mode (['acp']) */
  args?: string[];
  /** ACP: the flag that names the model before args (Cursor '--model'); absent = the model only through ACP */
  modelFlag?: string;
  /** the environment variable the user's API key goes into (ACP) */
  keyEnv?: string;
  /** api: the endpoint and its protocol */
  baseUrl?: string;
  protocol?: 'openai' | 'anthropic';
}

export interface EngineDef extends EngineInfo, EngineStart {
  /** the arguments of the engine's own login, run in a visible terminal (../cli.ts openLogin); empty = none */
  login: string[];
  /** on in a fresh install (built-ins only: a new engine waits for the user) */
  defaultOn: boolean;
  /** Cursor's own extras: its config folder snapshot, subagent hooks, price fallback (chats/acp.ts options) */
  cursorExtras?: boolean;
}

/** The shape of an engine id: a chat saved on an engine since removed stays readable (it cannot start). */
export const ENGINE_ID = /^[a-z][a-z0-9-]{0,30}$/;
const BUILT_IN = new Set(['claude', 'cursor', 'codex']);
/** Engines the app no longer runs (ADR 0046: Gemini CLI, 15/10): a brain entry with their id is left out and logged once,
 *  the settings saved for them are dropped on load (brain/config.ts fromSaved). */
export const REMOVED_ENGINES: ReadonlySet<string> = new Set(['gemini', 'kimi']);

const CLAUDE_CAPS: EngineCaps = {
  effort: true, liveModel: true, fork: true, warm: true, worktree: true, permissionMode: true,
  transcript: true, cost: true, usage: true, preAllow: true, tools: true,
};
const ACP_CAPS: EngineCaps = {
  effort: false, liveModel: false, fork: false, warm: false, worktree: false, permissionMode: false,
  transcript: false, cost: false, usage: false, preAllow: false, tools: true,
};
/** an HTTP model: text only (the owner, 14/10: "solo testo per ora"), the model changes between turns, its cost from the
 *  usage it returns */
const API_CAPS: EngineCaps = { ...ACP_CAPS, liveModel: true, cost: true, tools: false };
/** Codex app-server (ADR 0060): effort and model per turn, a message steers the running turn; no transcript the app
 *  reads, no cost (tokens only), no permission modes (it asks for each command outside its sandbox) */
const CODEX_CAPS: EngineCaps = { ...ACP_CAPS, effort: true, liveModel: true };
const CAPS: Record<EngineKind, EngineCaps> = { claude: CLAUDE_CAPS, acp: ACP_CAPS, codex: CODEX_CAPS, api: API_CAPS };

export type EngineEntry = Omit<EngineDef, 'caps' | 'source' | 'key' | 'runs' | 'trusted'>;

const APP_ENGINES: readonly EngineEntry[] = [
  { id: 'claude', label: 'Claude', name: 'Claude Code', kind: 'claude', login: ['auth', 'login'], defaultOn: true },
  { id: 'cursor', label: 'Cursor', name: 'Cursor', kind: 'acp', command: 'agent', args: ['acp'], modelFlag: '--model', login: ['login'], defaultOn: true, cursorExtras: true },
  { id: 'codex', label: 'Codex', name: 'Codex CLI', kind: 'codex', command: 'codex', args: ['app-server'], keyEnv: 'CODEX_API_KEY', login: ['login'], defaultOn: true },
  { id: ANTHROPIC_API, label: 'Anthropic API', name: 'Anthropic API', kind: 'api', baseUrl: 'https://api.anthropic.com/v1', protocol: 'anthropic', login: [], defaultOn: false },
];

/** The fingerprint of an engine's start definition, its login command included (16 hex). */
export function fingerprint(e: Pick<EngineDef, 'kind' | 'login'> & EngineStart): string {
  const parts = [e.kind, e.command ?? '', e.args ?? [], e.modelFlag ?? '', e.keyEnv ?? '', e.baseUrl ?? '', e.protocol ?? '', e.login];
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

/** What Settings shows of how an engine starts ("agent acp", the URL): what the user turns on is what they see. */
const runsOf = (e: EngineEntry): string => (e.kind === 'api' ? `${e.baseUrl ?? ''} (${e.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI'})`
  : e.kind === 'claude' ? 'Claude Code (incorporato)'
  : [e.command ?? '', ...(e.args ?? [])].join(' ') + (e.login.length ? ` · accesso: ${[e.command ?? '', ...e.login].join(' ')}` : ''));

// ── the brain's entries ──
const LABEL = /^[\p{L}\p{N} ._-]{1,30}$/u;
const COMMAND = /^(?:[A-Za-z0-9._-]{1,64}|(?:[A-Za-z]:)?[\\/][^"'`$%;&|<>\r\n]{1,300})$/;
const ARG = /^[\w.:@/=,-]{1,100}$/;
const KEY_ENV = /^[A-Z][A-Z0-9_]{0,60}_(?:KEY|TOKEN)$/;

/** An https endpoint (http only on this machine), no credentials, no query: where a key may be sent. */
export function safeBaseUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 300) return null;
  try {
    const u = new URL(v);
    const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
    if (u.username || u.password || u.search || u.hash) return null;
    return u.toString().replace(/\/+$/, '');
  } catch { return null; }
}

/** One models.json `engines` entry → an engine, or why not (the caller logs it). Built-ins are never redefined. */
export function brainEngine(id: string, v: unknown): EngineEntry | string {
  if (!ENGINE_ID.test(id)) return 'id non valido';
  if (BUILT_IN.has(id)) return 'motore incorporato: si avvia solo come lo avvia l’app';
  if (REMOVED_ENGINES.has(id)) return 'motore tolto dall’app: la voce è ignorata';
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  if (!o) return 'oggetto atteso';
  const preset = APP_ENGINES.find(e => e.id === id);
  const label = typeof o.label === 'string' ? o.label.trim() : preset?.label ?? '';
  if (!LABEL.test(label)) return 'label mancante o non valido';
  const name = typeof o.name === 'string' && LABEL.test(o.name.trim()) ? o.name.trim() : preset?.name ?? label;
  if (o.kind === 'acp') {
    const command = o.command ?? preset?.command;
    if (typeof command !== 'string' || !COMMAND.test(command)) return 'command mancante o non valido';
    const args = o.args ?? preset?.args ?? [];
    if (!Array.isArray(args) || args.length > 10 || !args.every(a => typeof a === 'string' && ARG.test(a))) return 'args non validi';
    const modelFlag = o.modelFlag ?? preset?.modelFlag;
    if (modelFlag !== undefined && (typeof modelFlag !== 'string' || !/^-{1,2}[a-z][a-z-]{0,20}$/.test(modelFlag))) return 'modelFlag non valido';
    const keyEnv = o.keyEnv ?? preset?.keyEnv;
    if (keyEnv !== undefined && (typeof keyEnv !== 'string' || !KEY_ENV.test(keyEnv))) return 'keyEnv non valido (NOME_KEY o NOME_TOKEN)';
    const login = o.login ?? preset?.login ?? [];
    if (!Array.isArray(login) || login.length > 5 || !login.every(a => typeof a === 'string' && ARG.test(a))) return 'login non valido';
    return { id, label, name, kind: 'acp', command, args: args as string[], ...(modelFlag ? { modelFlag } : {}), ...(keyEnv ? { keyEnv } : {}), login: login as string[], defaultOn: false };
  }
  if (o.kind === 'api') {
    const baseUrl = safeBaseUrl(o.baseUrl);
    if (!baseUrl) return 'baseUrl non valido (https, senza credenziali né query)';
    if (o.protocol !== 'openai' && o.protocol !== 'anthropic') return 'protocol: openai o anthropic';
    return { id, label, name, kind: 'api', baseUrl, protocol: o.protocol, login: [], defaultOn: false };
  }
  return 'kind: acp o api';
}

// ── the registry in force ──
let fromBrain: EngineEntry[] = [];
let trust: Readonly<Record<string, string>> = {};
let list: EngineDef[] = [];
const listeners = new Set<() => void>();

function build(): void {
  const brainIds = new Set(fromBrain.map(e => e.id));
  list = [...APP_ENGINES.filter(e => !brainIds.has(e.id)), ...fromBrain].map(e => {
    const source = brainIds.has(e.id) ? 'brain' : 'app';
    return {
      ...e,
      caps: CAPS[e.kind],
      source,
      key: e.kind === 'api' ? 'required' : e.keyEnv ? 'optional' : 'none',
      runs: runsOf(e),
      trusted: BUILT_IN.has(e.id) || trust[e.id] === fingerprint(e),
    };
  });
  for (const fn of listeners) fn();
}
build();

/** The brain's valid `engines` entries (brain/engines.ts reads models.json and leaves the invalid ones out). */
export function setBrainEngines(entries: EngineEntry[]): void { fromBrain = entries.filter(e => !REMOVED_ENGINES.has(e.id)); build(); }

/** The fingerprints the user turned on (trust.ts). */
export function setTrust(t: Readonly<Record<string, string>>): void { trust = t; build(); }

/** Called whenever the engines or their trust change (the renderer gets the new list). */
export function onEnginesChanged(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** Every engine, in display order. */
export const engines = (): readonly EngineDef[] => list;

/** The engine with this id, or null. */
export const engineOf = (id: Harness): EngineDef | null => list.find(e => e.id === id) ?? null;

/** The engine with this id; an unknown id is an error the user reads. */
export function engineOrThrow(id: Harness): EngineDef {
  const e = engineOf(id);
  if (!e) throw new Error(`Motore sconosciuto: ${id}`);
  return e;
}

/** The Anthropic API engine (ADR 0052) when the registry has it as an Anthropic Messages endpoint, else null. */
export function anthropicApi(): EngineDef | null {
  const e = engineOf(ANTHROPIC_API);
  return e?.kind === 'api' && e.protocol === 'anthropic' ? e : null;
}

/** The engines whose rows in the brain's price table an engine's models are: its own, and for an Anthropic Messages
 *  endpoint also Claude's (the same models at the same list prices; ADR 0052). */
export function priceEnginesOf(e: Pick<EngineDef, 'id' | 'kind' | 'protocol'>): string[] {
  return e.kind === 'api' && e.protocol === 'anthropic' ? [e.id, 'claude'] : [e.id];
}

/** "Claude", "Cursor": an engine's short name (its id when unknown). */
export const engineLabel = (id: Harness): string => engineOf(id)?.label ?? id;

/** The engines as the renderer sees them (of the start, only what Settings shows). */
export const engineInfos = (): EngineInfo[] => list.filter(e => ['claude', 'codex', 'cursor'].includes(e.id)).map(({ id, label, name, kind, caps, source, key, runs, trusted }) => ({ id, label, name, kind, caps, source, key, runs, trusted }));

/** Per engine, the command override in the environment: SB_<ID>_PATH (SB_CLAUDE_PATH, SB_CURSOR_PATH: the tests'
 *  fakes; a dash in the id becomes an underscore). */
export function enginePathsFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<Record<Harness, string>> {
  return Object.fromEntries(list.flatMap(e => {
    const v = env[`SB_${e.id.toUpperCase().replace(/-/g, '_')}_PATH`];
    return v ? [[e.id, v]] : [];
  }));
}
