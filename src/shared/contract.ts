// The one contract between the main process and the renderer: data shapes, invoke channels (renderer → main, with a
// result) and event channels (main → renderer). The preload exposes exactly these channels and nothing else
// (src/preload/index.ts reads INVOKE_CHANNELS / EVENT_CHANNELS); main registers a handler for every invoke channel
// (src/main/ipc.ts) and rejects senders that are not the app's own page. Change a shape here first, then both sides.
// The shapes live per area in src/shared/contract/*.ts; this file re-exports them all and assembles the maps.
import type { LogEvent } from './activity-log';
import type { AgentImages } from './agent-images';
import type { AgentCatalog } from './agents';
import type { AppUpdateState, UpdateCheckpointRequest } from './app-update';
import type { AutoCloseStatus } from './auto-close';
import type { AgentsInvokeMap } from './contract/agents';
import type { AppSourceState, CliStatus, Usage, AppInvokeMap } from './contract/app';
import type { BrainInvokeMap } from './contract/brain';
import type { BrowserEnv, BrowserHandoff, BrowserTab, PersonalState, BrowserInvokeMap } from './contract/browser';
import type { ChatItem, ChatSummary, PendingRequest, RunInfo, ChatsInvokeMap } from './contract/chats';
import type { EngineInfo, Harness, EnginesInvokeMap } from './contract/engines';
import type { FeedEvent, TasksState, FeedInvokeMap } from './contract/feed';
import type { MediaInvokeMap } from './contract/media';
import type { BudgetAlert, SettingChange, SettingProposal, Settings, SettingsInvokeMap } from './contract/settings';
import type { AnswerLater, HeldNewsState, OverlayAction, OverlayModel, SearchIndexStatus, SyncState, UiInvokeMap } from './contract/ui';
import type { ImparaState, Lesson } from './lesson';
import type { MaintenanceDone } from './maintenance-research';
import type { McpServersState } from './mcp-servers';
import type { RecState } from './recordings';
import type { RoutineRunDetail } from './routines';
import type { VoiceHeard, VoiceSpeech, VoiceState } from './voice';
import type { WorkThread } from './workflows';
export type { MorningBrief, MorningChange, MorningIdea, MorningNext, MorningOp, MorningOutcome, MorningPr, MorningRun, MorningStalled, MorningState } from './morning';
export * from './contract/engines';
export * from './contract/chats';
export * from './contract/browser';
export * from './contract/feed';
export * from './contract/app';
export * from './contract/settings';
export * from './contract/brain';
export * from './contract/ui';
export * from './contract/agents';
export * from './contract/media';

/** renderer → main. Each entry: [argument, result]. One interface per area (src/shared/contract/*.ts). */
export interface InvokeMap extends
  EnginesInvokeMap, ChatsInvokeMap, BrowserInvokeMap, FeedInvokeMap, AppInvokeMap,
  SettingsInvokeMap, BrainInvokeMap, UiInvokeMap, AgentsInvokeMap, MediaInvokeMap {}

/** main → renderer. */
export interface EventMap {
  'routines:progress': { subscription: string; run?: RoutineRunDetail; error?: string };
  'work:changed': WorkThread[];
  'update:state': AppUpdateState;
  'update:checkpointRequest': UpdateCheckpointRequest;
  'update:checkpointRelease': { requestId: string };
  'chat:autoCloseStatus': AutoCloseStatus[];
  'agents:changed': AgentCatalog;
  /** the "Da approvare" queue changed (a proposal, an evaluation, a decision): read /api/agents/lifecycle again */
  'agents:lifecycleChanged': null;
  /** a role's picture was set or removed: every badge on screen redraws */
  'avatars:changed': AgentImages;
  'chat:updated': ChatSummary;
  'chat:removed': { chatId: string };
  'chat:item': { chatId: string; item: ChatItem; replace?: boolean };
  'pending:added': PendingRequest;
  'pending:resolved': { chatId: string; requestId: string };
  'browser:tabs': BrowserTab[];
  'browser:handoff': BrowserHandoff;   // opened or changed state
  'browser:envs': BrowserEnv[];        // the known environments changed (tabs, session status, last login)
  'browser:pointer': { tabId: string; inside: boolean };   // the mouse entered/left a tab's page (a native view the UI cannot see)
  'personal:changed': PersonalState;
  'feed:events': FeedEvent[];
  'usage': Usage;
  /** the background CLI check at start finished (app:info had cli null until now) */
  'cli:ready': Record<Harness, CliStatus>;
  'focus:next': void;
  /** app-control MCP or a notification asks the UI to do something (switch view, focus a chat, open a page). */
  'ui:command': { action: string; value?: string };
  /** one key changed (by the user or an agent), applied live; `settings` = the full effective settings after it */
  'settings:changed': SettingChange & { settings: Settings };
  /** the engines changed (the brain's models.json, a definition turned on): the new list */
  'engines:changed': EngineInfo[];
  /** a protected change waits for the user (status pending), or was answered (accepted / rejected) */
  'settings:proposed': SettingProposal;
  'budget:alert': BudgetAlert;
  'tasks:state': TasksState;
  /** main → the layer page: the toasts to show */
  'overlay:model': OverlayModel;
  /** main → the app page: what the user did in the layer */
  'overlay:action': OverlayAction;
  /** a run started, printed more output, or ended */
  'run:updated': RunInfo;
  'source:state': AppSourceState;
  'later:changed': AnswerLater;
  'search:status': SearchIndexStatus;
  /** a skill, rule, memory file or agent link changed (a maintenance job, a rollback, the brain on disk) */
  'brainmodel:changed': void;
  /** a file under the brain's queries/ changed on disk (ADR 0124) */
  'queries:changed': void;
  /** a script of the brain or its changelog changed on disk (brain watcher): the Script and Changelog pages reload */
  'scripts:changed': void;
  /** new Log events, in small batches (main/activity/journal.ts) */
  'log:events': LogEvent[];
  /** a domain's sync status changed (ADR 0059) */
  'sync:state': SyncState;
  /** what the app holds back for the Orchestrators changed (main/chats/held-news.ts, #88) */
  'orchestrator:heldChanged': HeldNewsState;
  /** the number of open proposals changed (Memoria's badge, ADR 0123) */
  'proposals:changed': { count: number };
  /** the maintenance started, moved (cost) or ended, or one of its cards changed (ADR 0132, 0153) */
  'maintenance:changed': void;
  /** one click's maintenance is over: what it made (the end notice, ADR 0153) */
  'maintenance:done': MaintenanceDone;
  'mcpservers:changed': McpServersState;
  /** voice mode (ADR 0152): the models or the download changed; the user said something (transcribed); speech started
   *  or stopped on the microphone */
  'voice:changed': VoiceState;
  'voice:heard': VoiceHeard;
  'voice:speech': VoiceSpeech;
  /** push to talk: everything said before the release is heard */
  'voice:committed': { session: string };
  /** call recordings (ADR 0154): the list, the one running, a transcription's progress */
  'rec:changed': RecState;
  /** Impara (ADR 0185): the list changed, and the lesson that changed (whole) when there is one */
  'impara:changed': { state: ImparaState; lesson?: Lesson };
  /** a tutor answer so far, as it streams (ADR 0190); the lesson brings the whole answer when it ends */
  'impara:tutor': { lesson: string; turn: string; text: string };
}

export type InvokeChannel = keyof InvokeMap;
export type EventChannel = keyof EventMap;
export type InvokeArg<K extends InvokeChannel> = InvokeMap[K][0];
export type InvokeResult<K extends InvokeChannel> = InvokeMap[K][1];

// Runtime lists (the preload allow-list). Kept in sync with the maps by the compile-time checks below.
export const INVOKE_CHANNELS = [
  'routines:list', 'routines:import', 'routines:export', 'routines:setSecrets', 'routines:watch', 'routines:unwatch', 'routines:convert',
  'routines:image',
  'routines:archive',
  'work:lessons', 'work:lessonDecide', 'work:list', 'work:decide',
  'connectors:list', 'connectors:login', 'connectors:cancelLogin', 'connectors:probe', 'connectors:select', 'connectors:disconnect', 'connectors:useToken',
  'mcpservers:state', 'mcpservers:save', 'mcpservers:remove', 'mcpservers:setSecret', 'mcpservers:deleteSecret', 'mcpservers:setAccess', 'mcpservers:test', 'mcpservers:importScan', 'mcpservers:importApply', 'mcpservers:undo',
  'update:get', 'update:apply', 'update:checkpointAnswer', 'update:recovery', 'update:recoveryAck',
  'app:createBrain', 'app:projectsFolder', 'app:pickProjects',
  'chat:autoCloseGet', 'chat:autoClosePresence', 'chat:autoCloseKeep',
  'chat:synthesize', 'memory:reviewList', 'memory:retract', 'memory:delete', 'learning:evidence', 'learning:state', 'learning:import', 'learning:replay', 'learning:saveCandidate', 'learning:promote', 'learning:compare', 'proposals:list', 'proposals:count', 'proposals:decide',
  'maintenance:run', 'maintenance:status', 'maintenance:stop',
  'agents:list', 'agents:undo', 'agents:save', 'agents:reset', 'agents:history', 'agents:metrics', 'agents:estimates', 'agents:judgingEstimate', 'run:outcome', 'agents:restoreVersion', 'avatars:get', 'avatars:set', 'avatars:reset', 'setup:get', 'setup:save', 'profile:get', 'profile:save',
  'app:info', 'app:usage', 'cli:status', 'cli:login', 'app:pickBrain', 'app:pickRepo', 'app:showInFolder', 'app:copyFile', 'app:readFile', 'app:readFileDiff', 'app:askImage', 'chat:list', 'chat:items', 'chat:pending', 'chat:create', 'chat:createRouted', 'chat:send', 'chat:answer', 'chat:plan', 'chat:stop',
  'brain:share', 'brainmodel:state', 'brainmodel:maintain', 'brainmodel:rollback', 'queries:list', 'queries:get', 'queries:delete', 'brainmodel:noise', 'brainmodel:link', 'brainmodel:remove', 'classifiers:state', 'morning:brief', 'agents:trialDecide', 'agents:lifecycleDecide',
  'chat:stopAll', 'chat:close', 'chat:archive', 'chat:reopen', 'chat:admitNow', 'chat:prewarm', 'chat:set', 'chat:handoff', 'chat:handoffRead', 'chat:continue', 'chat:undoTurn', 'browser:list', 'browser:open', 'browser:navigate', 'browser:go',
  'browser:close', 'views:layout', 'feed:list', 'settings:get', 'settings:set', 'settings:schema', 'settings:history',
  'settings:undo', 'settings:propose', 'settings:pending', 'settings:confirm', 'estimate:record', 'brain:api',
  'tasks:get', 'tasks:refresh', 'tasks:markRead', 'chat:branches',
  'learn:act', 'models:seen',
  'browser:handoffs', 'browser:handoffResolve', 'browser:handoffCopy', 'browser:envList',
  'personal:state', 'personal:open', 'personal:navigate', 'personal:go', 'personal:select', 'personal:close', 'personal:restore', 'personal:bookmarkAdd', 'personal:bookmarkRemove',
  'personal:sessionSave', 'personal:sessionOpen', 'personal:sessionRemove', 'personal:historyClear', 'personal:loginFill', 'personal:loginSave', 'personal:loginRemove', 'personal:loginCopy', 'personal:loginImport', 'personal:lend', 'personal:reclaim', 'personal:onScreen',
  'credentials:list', 'credentials:copy', 'overlay:model', 'overlay:size', 'overlay:action', 'overlay:focus',
  'run:start', 'run:stop', 'run:list', 'run:dismiss', 'app:inputLag', 'skills:list', 'skills:read', 'skills:save', 'skills:delete', 'chat:commands', 'source:get', 'source:dismissLaunch', 'source:check', 'source:updateNow',
  'clipboard:image',
  'orchestrator:ensure',
  'search:query', 'search:status', 'search:retryModel', 'later:set', 'secrets:status', 'secrets:set', 'secrets:delete', 'engines:trust', 'engines:spend',
  'sync:get', 'sync:now', 'sync:resolve', 'log:list',
  'voice:state', 'voice:prepare', 'voice:listen', 'voice:audio', 'voice:commit', 'voice:speak', 'voice:cancelSpeech',
  'rec:state', 'rec:arm', 'rec:start', 'rec:chunk', 'rec:stop', 'rec:transcribe', 'rec:rename', 'rec:remove', 'rec:transcript', 'rec:find', 'rec:readFound', 'rec:open',
  'impara:state', 'impara:get', 'impara:start', 'impara:move', 'impara:ask', 'impara:answer', 'impara:explain', 'impara:retry', 'impara:clarify', 'impara:topics', 'impara:remove', 'impara:queue', 'impara:grade', 'impara:subject', 'impara:tutor', 'impara:tutorWarm', 'impara:studio',
  'orchestrator:held', 'orchestrator:heldSeen',
  'log:renderer',
  'proposals:shown', 'proposals:undoAuto',
  'guide:ask', 'guide:stale',
  'usecount:add', 'usecount:report',
] as const satisfies readonly InvokeChannel[];
export const EVENT_CHANNELS = [
  'routines:progress', 'work:changed',
  'proposals:changed', 'maintenance:changed', 'maintenance:done',
  'update:state', 'update:checkpointRequest', 'update:checkpointRelease',
  'chat:autoCloseStatus',
  'agents:changed', 'agents:lifecycleChanged', 'avatars:changed',
  'chat:updated', 'chat:removed', 'chat:item', 'pending:added', 'pending:resolved', 'browser:tabs', 'feed:events', 'usage', 'cli:ready', 'focus:next', 'ui:command',
  'settings:changed', 'engines:changed', 'settings:proposed', 'budget:alert', 'tasks:state', 'browser:handoff', 'browser:envs', 'browser:pointer', 'overlay:model', 'overlay:action', 'run:updated', 'source:state', 'later:changed', 'search:status', 'brainmodel:changed', 'queries:changed', 'sync:state',
  'mcpservers:changed',
  'orchestrator:heldChanged',
  'scripts:changed',
  'log:events',
  'personal:changed',
  'voice:changed', 'voice:heard', 'voice:speech', 'voice:committed',
  'rec:changed',
  'impara:changed', 'impara:tutor',
] as const satisfies readonly EventChannel[];

type Missing<All, Listed> = Exclude<All, Listed>;
// Compile error if a channel is added to a map but not to its runtime list.
const _invokeComplete: Missing<InvokeChannel, (typeof INVOKE_CHANNELS)[number]> extends never ? true : never = true;
const _eventComplete: Missing<EventChannel, (typeof EVENT_CHANNELS)[number]> extends never ? true : never = true;
void _invokeComplete; void _eventComplete;

/** What the preload exposes as window.sb. */
export interface Bridge {
  invoke<K extends InvokeChannel>(channel: K, arg: InvokeArg<K>): Promise<InvokeResult<K>>;
  on<K extends EventChannel>(channel: K, fn: (payload: EventMap[K]) => void): () => void;
}
