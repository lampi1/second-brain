// What the IPC handler groups (src/main/ipc-handlers/*.ts) are given: the wired services and the objects index.ts builds
// around them at start (the layer, search, voice, recordings, …). index.ts fills it once and spreads every group into
// one Handlers object (ipc.ts), which the type keeps complete: a channel without a handler does not compile.
import type { BrowserWindow } from 'electron';
import type { DefaultBrain } from '../../modules/ai-first/default-brain';
import type { createAppConnectors } from '../../modules/onboarding/app-host';
import type { Emitter, Handlers } from '../ipc';
import type { Wired } from '../wiring-types';
import type { attachActivity } from '../activity/wiring';
import type { RendererErrors } from '../renderer-errors';
import type { OverlayLayer } from '../overlay';
import type { Shell } from '../open-path';
import type { clipReader } from '../clipboard-image';
import type { SearchService } from '../search/service';
import type { Routines } from '../routines/service';
import type { ProfileService } from '../brain/profile';
import type { AgentImageStore } from '../agents/agent-images';
import type { createAppUpdates } from '../update/wiring';
import type { OrchestratorService } from '../chats/orchestrator-service';
import type { ProposalsService } from '../proposals/service';
import type { Workflows } from '../workflows/service';
import type { VoiceService } from '../voice/service';
import type { RecordingService } from '../recordings/service';

/** The handlers of every channel whose name starts with one of these prefixes ('chat' → 'chat:list', 'chat:send', …). */
export type HandlersOf<P extends string> = Pick<Handlers, Extract<keyof Handlers, `${P}:${string}`>>;

export interface HandlerContext {
  s: Wired;
  /** the app window now (null once closed) */
  win: () => BrowserWindow | null;
  emitter: Emitter;
  /** SB_DEMO=1: fake data, no model calls */
  demo: boolean;
  /** the built app's folder (out/) */
  outDir: string;
  activity: ReturnType<typeof attachActivity>;
  overlay: OverlayLayer;
  profile: ProfileService;
  agentImages: AgentImageStore;
  defaultBrain: DefaultBrain;
  updates: ReturnType<typeof createAppUpdates>;
  workflows: Workflows;
  orchestrator: OrchestratorService;
  voice: VoiceService;
  recordings: RecordingService;
  mcpServers: () => NonNullable<Wired['mcpServers']>;
  connectors: ReturnType<typeof createAppConnectors>;
  research: () => NonNullable<Wired['research']>;
  learn: () => NonNullable<Wired['learn']>;
  routinesOf: () => Routines;
  /** throws when the brain changed since the review page read it */
  requireReviewRoot: (expected: unknown) => void;
  search: SearchService;
  clip: ReturnType<typeof clipReader>;
  /** what a hidden run (SB_HIDDEN) uses instead of Explorer */
  hiddenShell: Shell;
  /** Memoria → Proposte, built after the handlers (it calls them) */
  proposals: () => ProposalsService;
  /** the user chose a brain folder (a pending default-brain creation must not overwrite the choice) */
  bumpBrainChoice: () => void;
  rendererErrors: RendererErrors;
}
