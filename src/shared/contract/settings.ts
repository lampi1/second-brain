// Settings (userData/config.json), budget alerts, the job ledger and the model routing table.
// One area of the IPC contract: src/shared/contract.ts re-exports it and assembles the channel maps (change a shape
// here first, then both sides).
import type { DelegationSettings, ModelTier } from '../roles';
import type { VoiceAsr, VoiceName } from '../voice';
import type { Effort } from './chats';
import type { Harness } from './engines';

// ── Settings (userData/config.json; never secrets) ─────────────────────────────────────────────────────────────────
/** Windows toasts: only urgent kinds (default), urgent + normal, or none (in-app feed only). */
export type ToastLevel = 'urgent' | 'normal' | 'off';
export type ThemeMode = 'dark' | 'light' | 'system';
/** The UI language (ADR 0057, German ADR 0117): system = Windows' language (Italian when it is Italian, German when it
 *  is German, English otherwise). 'de' is German as written in Austria (dates and numbers de-AT). */
export type LanguageMode = 'system' | 'it' | 'en' | 'de';
export type Lang = 'it' | 'en' | 'de';
/** every UI language, in the order the pickers show them */
export const LANGS: readonly Lang[] = ['it', 'en', 'de'];
export const isLang = (v: unknown): v is Lang => v === 'it' || v === 'en' || v === 'de';
/** warn = feed + toast · ask = also a 'budget:alert' the chat manager turns into a "stop or continue?" question · off */
export type BudgetMode = 'warn' | 'ask' | 'off';
export interface BudgetLimits { mode: BudgetMode; dailyUsd: number | null; perChatUsd: number | null }
export interface BudgetSettings { enabled: boolean; claude: BudgetLimits; cursor: BudgetLimits }
export interface Settings {
  jobs?: { fallback: 'auto' | 'off' };
  brainRoot: string | null;
  mcpPort: number;
  mute: Record<string, boolean>;   // feed kind → no toast (still in the feed)
  osToasts: ToastLevel;
  theme: ThemeMode;
  language: LanguageMode;
  dnd: boolean;                    // do not disturb: no toasts at all
  dndUntil: number | null;         // timed do not disturb (epoch ms): no toasts until then
  /** engines anything may start on (ADR 0046; absent = off): the user's own chats too */
  engineOn: Partial<Record<Harness, boolean>>;
  /** engines the Orchestrators may open or resume chats on (absent = off); the user's own chats are free */
  engines: Partial<Record<Harness, boolean>>;
  /** Retired transport switch: always true after loading. Kept as compatibility data for older clients. */
  messaging: { crossHarness: boolean };
  budget: BudgetSettings;
  /** context size (tokens) above which a chat's meter turns amber when its engine reports no compaction window (Cursor);
   *  a Claude chat turns amber near its own window (compactWindowTokens) instead (ADR 0031) */
  contextWarnTokens: number;
  /** the invisible continuation of cold chats (ADR 0031): an idle Claude chat with a long context writes its hand-off
   *  while the prompt cache is still warm, and a message after the cache expired goes on in a fresh session from it */
  contextHandoff: boolean;
  /** the auto-compact window of every Claude chat the app starts (passed per process, it beats a folder's own
   *  settings); 0 = whatever the user's Claude settings say (ADR 0031) */
  compactWindowTokens?: number;
  /** «Orchestrators corte» (ADR 0051): an Orchestrator whose context began on an earlier day compacts it once, the first time it is idle
   *  on a new day (same chat: its queue and the chats it follows stay); its window is compactWindowTokens as for every chat */
  orchestratorDayCompact?: boolean;
  /** ADR 0060: the brain's rules given to each Claude chat at launch (a plugin folder: skills, agents, output styles,
   *  hooks, plus the rules file); off by default */
  launchRulesClaude?: boolean;
  /** ADR 0060: the brain's rules given to each Codex chat at launch (developer instructions + skill folders); on by default */
  launchRulesCodex?: boolean;
  /** Explicit repository/worktree roots where Codex uses never + workspace-write. Empty = on-request everywhere.
   *  Each chat gets only its matching root; sibling repositories and worktrees require their own entry. */
  codexAutonomyRoots?: string[];
  /** limits of delegation between role chats (Impostazioni → Ruoli e deleghe; shared/roles.ts DELEGATION_DEFAULTS) */
  delegation: DelegationSettings;
  /** the model each tier means on an engine (engine id → tier → model id; '' or absent = the brain's registry) */
  modelTiers: Partial<Record<Harness, Partial<Record<ModelTier, string>>>>;
  /** minutes an idle long Claude chat waits before writing its hand-off for the invisible continuation (the cache lasts
   *  ~60 min since the last call) */
  coldHandoffMin?: number;
  /** the chats the Orchestrator opens (app_create_chat without harness/model) and where the "Nuova chat" dialog starts:
   *  engine, model per engine ('' = the CLI default), Claude effort ('' = the CLI default); Cursor reasoning and fast
   *  apply to every Cursor chat */
  orchestratorChats: OrchestratorChatDefaults;
  /** minutes a finished work chat stays on the grid before it closes by itself (archived, reopenable); 0 = never */
  autoCloseMin: number;
  /** minutes an idle chat keeps its engine process (with its MCP servers and shells); then the process ends and the
   *  chat stays on the grid, resumed by itself on the next message (ADR 0026); 0 = never. Orchestrators are never released. */
  engineIdleMin?: number;
  /** Task page: read by the brain's devops-me.mjs (no AI, no tokens), on a timer only when the user turns it on */
  tasks: { enabled: boolean; everyMin: number; /** a short sound with a DevOps alert (a mention, a change on my items) */ sound: boolean };
  /** the Orchestrator overlay's opacity in %, 40-100 (fully opaque while hovered or focused; ADR 0021) */
  orchestratorOpacity: number;
  /** "Eventi all'Orchestrator": a work chat that finishes, fails, waits for the user or leaves a command wakes the Orchestrator with a
   *  short app message (main/chats/orchestrator-wake.ts) */
  orchestratorEvents: boolean;
  /** "Esito alla chat": when a run of Esegui ends, the chat that proposed the block gets the exit code and the output's
   *  tail as an app message (main/run/results.ts) */
  runResults: boolean;
  /** the Agenti page's «Abilita controllo livello e performance» (agents/judge-sample.ts): every finished root run gets an
   *  independent Sentinel review; judgingSince = when it was turned on (ms, 0 = never: runs ended before are skipped) */
  judging: boolean;
  judgingSince: number;
  /** the folder of the app's own code (a git repo) that "Aggiorna" updates; null = the one the running release was built from */
  appRepo: string | null;
  /** the folder that holds the owner's projects (their git repos): asked by the first-run setup only when the app
   *  cannot find it by itself (main/brain/projects-folder.ts); null = not known yet */
  projectsRoot?: string | null;
  /** "Coda per carico" (ADR 0036): an agent's new chat or turn waits while CPU is over loadQueueCpu % or free RAM under
   *  loadQueueRam %; the user's own messages never wait */
  loadQueue: boolean;
  loadQueueCpu: number;
  loadQueueRam: number;
  /** the chat composer's inline suggestion (ADR 0118; local sources only since ADR 0201): on or off */
  suggestOn?: boolean;
  /** voice mode (ADR 0152): which Whisper transcribes (fast = small, accurate = turbo) and which Italian voice speaks */
  voiceAsr?: VoiceAsr;
  voiceName?: VoiceName;
  /** the voice conversation is push to talk: the microphone counts only while Ctrl+Space or the bar's button is held */
  voicePtt?: boolean;
  /** «Modalità notte» (ADR 0191): the user is away; no questions reach them, every agent goes on with the recommended
   *  choice until the job is done; production, secrets, permissions and messages to people wait for their return */
  awayMode?: boolean;
  /** fields forced by the environment (SB_BRAIN, SB_MCP_PORT): shown read-only, never saved */
  locked?: ('brainRoot' | 'mcpPort')[];
}
export interface OrchestratorChatDefaults {
  harness: Harness; claudeModel: string; cursorModel: string; claudeEffort: Effort | '';
  /** reasoning of every Cursor chat (ACP session config option of category thought_level), '' = the model's default */
  cursorReasoning: CursorReasoning | '';
  /** Cursor's "fast" option for every Cursor chat (faster, spends more usage) */
  cursorFast: boolean;
}
export type CursorReasoning = 'low' | 'medium' | 'high' | 'xhigh';
export type SettingsPatch = Partial<Omit<Settings, 'budget' | 'locked' | 'engineOn' | 'engines' | 'messaging' | 'orchestratorChats' | 'tasks' | 'delegation' | 'modelTiers'>> & {
  delegation?: Partial<DelegationSettings>;
  modelTiers?: Partial<Record<Harness, Partial<Record<ModelTier, string>>>>;
  engines?: Partial<Settings['engines']>;
  tasks?: Partial<Settings['tasks']>;
  engineOn?: Partial<Settings['engineOn']>;
  messaging?: Partial<Settings['messaging']>;
  orchestratorChats?: Partial<OrchestratorChatDefaults>;
  budget?: { enabled?: boolean; claude?: Partial<BudgetLimits>; cursor?: Partial<BudgetLimits> };
};

/** Every setting is one dot key ("theme", "budget.claude.dailyUsd", "mute.idea"): the unit of validation, history,
 *  undo and agent permissions. The schema (settings:schema) gives type, default, Italian label and description. */
export type SettingKey =
  | 'jobs.fallback' | 'brainRoot' | 'mcpPort' | 'theme' | 'language' | 'autoCloseMin' | 'engineIdleMin' | 'contextWarnTokens' | 'contextHandoff' | 'compactWindowTokens' | 'orchestratorDayCompact' | 'launchRulesClaude' | 'launchRulesCodex' | 'coldHandoffMin' | 'osToasts' | 'dnd' | 'dndUntil' | `engineOn.${Harness}` | `engines.${Harness}` | 'messaging.crossHarness' | 'tasks.enabled' | 'tasks.everyMin' | 'tasks.sound' | 'budget.enabled'
  | `budget.${Harness}.${'mode' | 'dailyUsd' | 'perChatUsd'}` | `mute.${string}`
  | `orchestratorChats.${keyof OrchestratorChatDefaults}` | 'orchestratorOpacity' | 'orchestratorEvents' | 'runResults' | 'judging' | 'judgingSince' | 'appRepo' | 'projectsRoot' | 'loadQueue' | 'loadQueueCpu' | 'loadQueueRam' | 'codexAutonomyRoots'
  | 'suggestOn' | 'voiceAsr' | 'voiceName' | 'voicePtt' | 'awayMode'
  | `delegation.${keyof DelegationSettings}` | `modelTiers.${Harness}.${ModelTier}`;
export interface SettingDef {
  key: SettingKey;            // 'mute.*' stands for every feed kind
  type: 'path' | 'int' | 'boolean' | 'enum' | 'usd' | 'model' | 'repo-paths';
  default: unknown;
  nullable?: boolean;
  values?: readonly string[]; // enum
  min?: number; max?: number; // int
  label: string;              // Italian
  description: string;        // Italian, one or two sentences
  /** protected: an agent can only propose it; the user confirms with a click (engines, spending limits, notifications
   *  off, security: brain folder, MCP port) */
  protected: boolean;
}
export type ChangeBy = 'user' | 'agent';
/** One applied change (userData/changes.jsonl). An undo is a new change with undoOf; the original gets undone: true. */
export interface SettingChange {
  id: string; at: number; by: ChangeBy; chatId?: string;
  key: SettingKey; before: unknown; after: unknown;
  undone?: boolean; undoOf?: string;
  proposalId?: string;        // applied because the user accepted this agent proposal
}
/** A protected change asked by an agent, waiting for the user's click (settings:confirm). */
export interface SettingProposal {
  id: string; at: number; by: 'agent'; chatId?: string; reason?: string;
  key: SettingKey; label: string; before: unknown; after: unknown;
  status: 'pending' | 'accepted' | 'rejected';
}
/** What an agent's request became: applied at once (non-protected), a proposal (protected), or refused (invalid). */
export type SettingRequestResult = { applied: SettingChange } | { proposal: SettingProposal } | { error: string };

/** A spending threshold crossed (80 % or 100 %). The brain module only reports: it never stops or interrupts anything;
 *  with mode 'ask' the chat manager asks the user "stop or continue". scope: day / one chat / the plan's 5 h or 7 d window. */
export interface BudgetAlert {
  id: string;
  at: number;
  harness: Harness;
  scope: 'day' | 'chat' | 'fiveHour' | 'week';
  chatId?: string;            // the CLI session id (Claude transcript uuid) for scope 'chat'
  chatTitle?: string;
  pct: number;                // 0-100+
  threshold: 80 | 100;
  usd: number | null;         // null for plan windows (they are percentages)
  limitUsd: number | null;
  mode: Exclude<BudgetMode, 'off'>;
  text: string;               // Italian, one line
}

// ── Job ledger: real cost and time of a job, kept for the brain's routing table (ADR 0053 dropped the estimate shown
// to the user: measured on 178 chats it held only 47% of the time with a bigger median error than the median cost) ──
/** minutesKind 'work' = effective work time (running, never waiting for the user's answers: the app since 2026-10-11, the
 *  same figure the chat tile shows); without it the minutes are a chat's span or the CLI's turn time and only $ count. */
export interface JobActual { usd: number; minutes: number | null; minutesKind?: 'work'; turns: number | null }
/** Record (or update: same id, last wins) one job in the ledger. The prompt text is never stored: only its length and kind. */
export interface JobRecordInput {
  id?: string;
  harness: Harness;
  model: string | null;
  effort: Effort | null;
  prompt?: string;
  kind?: TaskKind;
  actual?: JobActual | null;
}

// ── Model routing: which harness, model and effort a chat opened by an agent gets (ADR 0032) ─────────────────────────
/** The kinds of work the routing table decides on: the one taxonomy (shared/work-concepts.ts, ADR 0186). */
export { WORK_KINDS as TASK_KINDS, type TaskKind } from '../work-concepts';
import type { TaskKind } from '../work-concepts';
/** One row of the brain's model registry and price table (harness/models.json): USD per million tokens. */
export interface RegistryModel {
  id: string; harness: Harness; provider: string; aliases?: string[];
  /** auto = the routing table may pick it; manual = only when named */
  routing: 'auto' | 'manual'; tier?: string;
  price: { input: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number; output: number };
  longPrompt?: { over: number; price: RegistryModel['price'] };
  fastFactor?: number; noGeo?: boolean;
  efforts: Effort[]; defaultEffort: Effort | null;
}
export interface ModelRegistry {
  harnesses: Partial<Record<Harness, { routing: 'auto' | 'manual'; note?: string }>>;
  defaultModel: string;
  models: RegistryModel[];
  modifiers?: { usGeo?: number; webSearchPerRequest?: number };
  /** the only model and effort a row for the app's chats may name (the user, 2026-10-14: "i lavori sull'app sempre in
   *  opus medio"); other models never reach them. Absent = no such rule. */
  appChats?: { model: string; effort: Effort | null };
}
/** A row of the routing table: kind '*' = any; area = the title's label ("IT", "Pers · App"), one or several; no area = any. */
export interface RoutingRow {
  kind: TaskKind | '*'; area?: string | string[];
  harness: Harness; model: string; effort: Effort | null;
  why: string; since: string; evidence: string;
  /** the user's switch for the writing rows «Sui crediti API» (ADR 0052): on = its chats run on the Anthropic API engine
   *  with the same model, while that engine is on, has a key and may be used; else on the row's harness. Absent = off;
   *  only the user turns it on or off */
  onApi?: boolean;
  /** the user's switch «L'AI può cambiarla» off: an agent may neither change nor remove this row (absent = it may) */
  locked?: boolean;
}
/** The table in force: <brain>/ops/state/improve/routing/v<version>.json, current.json says which (versioned: every save
 *  is a new version + a line in audit.jsonl; old versions stay for rollback). */
export interface RoutingTable {
  /** exploration: the share of chats that once tried a little-sampled model; read and kept, used by nothing (ADR 0186) */
  version: number; appliedAt: string | null; by: string | null; exploration: number; routes: RoutingRow[];
  /** how much cost weighs against quality when the loop compares models: 0 = only quality, 10 = only cost (the user's
   *  λ, 7 on 2026-10-14; like OpenRouter's cost_quality_tradeoff); only the user changes it */
  costWeight: number;
}
/** One change of the table (a line of <brain>/ops/state/improve/audit.jsonl, domain routing): who, when, why, with what
 *  data; stored = its v<to>.json is still on disk (it can be restored). */
export interface RoutingChange { at: string; from: number | null; to: number; by: string; reason: string | null; evidence: string | null; exploration?: { from: number; to: number }; costWeight?: { from: number; to: number }; stored: boolean }
/** routing:get → the table (null: never applied), the registry (null: the brain has no harness/models.json) and why not;
 *  history = its last changes, newest first (the user's page and the agents both write it, ADR 0032). */
export interface RoutingInfo { table: RoutingTable | null; registry: ModelRegistry | null; kinds: readonly TaskKind[]; error: string | null; history: RoutingChange[] }
/** How a chat's engine was chosen: agent = the catalog agent's profile (engine, model, effort; a profile with no model
 *  takes the table row's as a default, never an override: ADR 0078); table = its row; default = no row, the user's
 *  "Chat aperte dall'Orchestrator"; override = the agent named something else, with a reason. */
export interface RouteDecision {
  policy: 'routing'; version: number | null; source: 'table' | 'default' | 'override' | 'explore' | 'agent';
  reason: string | null; kind: TaskKind; area: string; at: number;
  /** source agent: which agent, who picked it (the Orchestrator by agentId, the classifier, a worker for its sub-agent,
   *  Generale as the fallback) and, when the classifier ranked it, its score against the threshold in force (ADR 0078) */
  agent?: RouteAgent;
  /** a chat that continues a routed one ("Riprendi"): the ledger id of the first chat, so one job keeps one outcome */
  ledgerId?: string;
  /** how many hand-offs led to this chat */
  handoffs?: number;
}
/** The role a routed chat runs: who launched it, its model tier, and where its model came from (the role's own model,
 *  its tier on the engine, or the engine's default). */
export interface RouteAgent { id: string; version: number; chosenBy: 'orchestrator' | 'parent' | 'app'; tier?: ModelTier; modelFrom?: 'role' | 'tier' | 'table' | 'engine' }

/** renderer → main, settings: each entry [argument, result]. Part of InvokeMap (src/shared/contract.ts). */
export interface SettingsInvokeMap {
  'settings:get': [void, Settings];
  /** The user's own change from the UI (each key logged as a change by 'user'); all keys validated first, all or none */
  'settings:set': [SettingsPatch, Settings];
  'settings:schema': [void, SettingDef[]];
  'settings:history': [{ limit?: number }, SettingChange[]];      // newest first
  'settings:undo': [{ changeId: string }, SettingChange];         // the new change that restores the old value
  /** an agent's request relayed by the UI: non-protected keys apply at once, protected ones become a proposal */
  'settings:propose': [{ key: string; value: unknown; chatId?: string; reason?: string }, SettingRequestResult];
  'settings:pending': [void, SettingProposal[]];
  'settings:confirm': [{ proposalId: string; accept: boolean }, { change: SettingChange | null }];
  /** the job's actual cost and time, for the brain's ledger (jobs.jsonl: routing reads it, ADR 0053) */
  'estimate:record': [JobRecordInput, { id: string }];
  /** the routing table and the model registry (Impostazioni → «Instradamento modelli») */
  'routing:get': [void, RoutingInfo];
  /** the user saves the table from the settings page: checked against the hard rules, written as a new version
   *  (a table's stored exploration rate is kept as it is: no chat explores since ADR 0186) */
  'routing:save': [{ routes: RoutingRow[]; reason?: string; costWeight?: number; baseVersion?: number }, RoutingInfo];
}
