// What wiring.ts (and the demo's demo-wiring.ts) is given and returns: Ctx, the start's window, emitter and userData,
// and Wired, every service the app runs on, read by index.ts and its IPC handler groups (src/main/ipc-handlers).
import type { BrowserWindow } from 'electron';
import type { LearningReviewService } from './brainmodel/learning-review';
import type { CliStatus, Harness } from '../shared/contract';
import type { JudgingEstimate } from '../shared/agents';
import type { AgentCatalogService } from './agents/catalog';
import type { RunFeedback } from './agents/run-feedback';
import type { createAgentPacks } from './agents/pack/wiring';
import type { SetupService } from './agents/setup';
import type { AutoCloseService } from './chats/auto-close';
import type { LifecycleApi } from './agents/lifecycle-api';
import type { MorningService } from './morning/service';
import type { MemoryService } from './rules/memory-service';
import type { EnginesApi } from './engines/service';
import type { PersonalBrowser } from './personal/browser';
import type { RecordingStore } from './recordings/store';
import type { LearnService } from './learn/service';
import type { CloudService } from './cloud/service';
import type { Emitter } from './ipc';
import type { BrainService, BrowserService, ChatService, SkillsApi, TasksApi } from './services';
import type { BrainModelService } from './brainmodel/service';
import type { ResearchService } from './brainmodel/research';
import type { McpServer } from './mcp/server';
import type { Workflows } from './workflows/service';
import type { Routines } from './routines/service';
import type { McpServersService } from './mcp-servers/service';
import type { CommandRunner } from './run/runner';
import type { CommandAsks } from './run/asks';
import type { OrchestratorWake } from './chats/orchestrator-wake';
import type { HeldNewsHub } from './chats/held-news';
import type { AppSourceService } from './update/source';
import type { AnswerLaterStore } from './later';
import type { OneShotService } from './agents/oneshot';
import type { AgentRunStore } from './agents/runs';
import type { HybridSearch } from './search/hybrid/service';
import type { UserCorrectionStore } from './brain/user-corrections';
import type { BrainQueries } from './brain/queries';
import type { LegacyArchive } from './routines/legacy';
import type { GuideService } from './guide/service';

export interface Ctx { emitter: Emitter; window: () => BrowserWindow | null; userData: string }
export interface Wired {
  /** cloud agents (ADR 0080): Cursor, Codex and Claude agents that run in their vendor's cloud */
  cloud?: CloudService;
  /** the verdicts on role runs (a parent's, a sampled Sentinel review's) and the user's Annulla on a change the app applied */
  runFeedback?: RunFeedback;
  /** the agents' "Da approvare" queue: read at /api/agents/lifecycle, decided only through agents:lifecycleDecide */
  agentLifecycle?: LifecycleApi;
  oneShot?: OneShotService;
  agentRuns?: AgentRunStore;
  /** what «Abilita controllo livello e performance» costs a day and when its last nightly batch ran (ADR 0203) */
  judging?: { estimate: (now: number) => JudgingEstimate };
  memoryReview?: MemoryService;
  learningReview?: LearningReviewService;
  /** the brain's saved queries (ADR 0124): Memoria → Script & Query, queries:* IPC */
  queries?: BrainQueries;
  /** the hybrid brain search (SPEC 23); absent in the demo (Ctrl+K then uses its own index) */
  hybrid?: HybridSearch;
  /** the user's corrections counted at chat:send (ADR 0197); absent in the demo */
  userCorrections?: UserCorrectionStore;
  workflows?: Workflows;
  routineArchive?: LegacyArchive;
  /** the Routine section's packages and runs (routines:* IPC); absent in the demo */
  routines?: Routines;
  updateChats?: { problem: () => string | null; checkpoint: () => void };
  autoClose: AutoCloseService;
  agents: AgentCatalogService;
  agentPacks: ReturnType<typeof createAgentPacks>;
  /** the Brain pages and their maintenance jobs (ADR 0077) */
  brainModel: BrainModelService;
  /** the maintenance with research (ADR 0132): maintenance:* IPC, the Proposte deck's 'research' source */
  research?: ResearchService;
  /** the morning block ("Mentre eri via", ADR 0102); absent = the channel answers "nothing to show" */
  morning?: MorningService;
  setup: SetupService;
  chats: ChatService; browser: BrowserService; brain: BrainService; tasks: TasksApi;
  /** the user's own everyday browser, the Browser page (personal/browser.ts, ADR 0133) */
  personal: PersonalBrowser;
  /** the call recordings on disk (ADR 0154, recordings/store.ts): main/index.ts records and transcribes, app_recordings reads */
  recordings: RecordingStore;
  /** Impara (ADR 0185, learn/service.ts): the user's lessons; absent = the impara:* channels say it is not available */
  learn?: LearnService;
  /** the engines of the brain, which definitions the user turned on, the API keys (ADR 0046) */
  engines: EnginesApi;
  /** the chat folders' git branches ('chat:branches'); absent = read from disk (chats/branch.ts) */
  branches?: (cwds: unknown) => Record<string, string | null>;
  /** "Skill e agenti" (ADR 0018) */
  skills: SkillsApi;
  /** The local MCP server: browser routes, /mcp/app (app control). */
  mcp: McpServer;
  /** the MCP servers the user added in Settings → Connettori, given to each chat by role (ADR 0086) */
  mcpServers?: McpServersService;
  /** code blocks run by the user's click ("Esegui"), output streamed back (run:updated) */
  runner: CommandRunner;
  /** shell blocks a chat left for the user, as open requests ("Comando da eseguire", run/asks.ts) */
  asks: CommandAsks;
  /** "Eventi all'Orchestrator": work chats' news wakes the Orchestrator (chats/orchestrator-wake.ts) */
  wake: OrchestratorWake;
  /** "N novità in attesa" (#88): what the delivery rule holds back for the Orchestrators (chats/held-news.ts) */
  heldNews?: HeldNewsHub;
  /** the Guida's «Chiedi alla Guida» and its cards «da verificare» (main/guide/service.ts, ADR 0196) */
  guide?: GuideService;
  /** "Aggiorna" from GitHub (Settings → Aggiornamenti), app_update_code, the restart notice (ADR 0074, 0075) */
  source: AppSourceService;
  /** "Rispondi dopo" (main/later.ts, ADR 0035) */
  later: AnswerLaterStore;
  cli(): Record<Harness, CliStatus> | null;
  shutdown(): Promise<void>;
  /** synchronous: kills every child process tree now (app quit, belt and braces after shutdown) */
  killNow(): void;
}
