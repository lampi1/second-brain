// Engine-agnostic binding for the fixed right column. Reading never starts a model; ensure is single-flight.
// ChatManager enforces the single Orchestrator, including the replacement entry points (Ricomincia, Cambia motore).
// ensure routes like every Orchestrator (chats/routed.ts, kind 'orchestrator'): the engine the user picked beats the row;
// the model and effort come from the Orchestrator's role card when it is on that engine (agents/catalog.ts resolve; the
// Settings' «Chat aperte dall'Orchestrator» models moved onto the card, 2026-11-23), else the engine's default.
import type { ChatSummary, Harness } from '../../shared/contract';
import type { ChatService } from '../services';
import { createRoutedChat, type RoutedChatDeps } from './routed';
import { ORCHESTRATOR_TITLE } from '../../shared/orchestrator';

export type OrchestratorRouting = Omit<RoutedChatDeps, 'create'>;

export class OrchestratorService {
  private pending: Promise<ChatSummary> | null = null;
  constructor(private readonly chats: Pick<ChatService, 'list' | 'create'>, private readonly brainRoot: () => string | null,
    private readonly routing?: OrchestratorRouting) {}

  get(): ChatSummary | null {
    return this.chats.list().find(c => c.isOrchestrator && !c.closedAt) ?? null;
  }

  ensure(choice: { harness: Harness; model?: string }): Promise<ChatSummary> {
    const existing = this.get();
    if (existing) return Promise.resolve(existing);
    if (this.pending) return this.pending;
    const cwd = this.brainRoot();
    if (!cwd) return Promise.reject(new Error('Collega prima la cartella del brain nelle Impostazioni.'));
    this.pending = this.create(choice, cwd).finally(() => { this.pending = null; });
    return this.pending;
  }

  private create(choice: { harness: Harness; model?: string }, cwd: string): Promise<ChatSummary> {
    const base = { cwd, title: ORCHESTRATOR_TITLE, orchestrator: true };
    if (!this.routing) return this.chats.create({ ...choice, ...base });
    const { route, engineOn, agentsMayOpen } = this.routing;
    return createRoutedChat({ route, engineOn, agentsMayOpen, create: r => this.chats.create(r) }, {
      ...base, prompt: '',
      defaults: { harness: choice.harness },
      ask: { harness: choice.harness, ...(choice.model ? { model: choice.model } : {}), reason: 'motore scelto dall’utente' },
    }, { byUser: true });
  }
}
