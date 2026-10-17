// Engine-agnostic binding for the fixed right column. Reading never starts a model; ensure is single-flight.
// ChatManager owns migration/singleton enforcement, including legacy create and replacement entry points.
import type { ChatSummary, Harness } from '../../shared/contract';
import type { ChatService } from '../services';

export class OrchestratorService {
  private pending: Promise<ChatSummary> | null = null;
  constructor(private readonly chats: Pick<ChatService, 'list' | 'create'>, private readonly brainRoot: () => string | null) {}

  get(): ChatSummary | null {
    return this.chats.list().find(c => c.isRegia && c.orchestrator && !c.closedAt) ?? null;
  }

  ensure(choice: { harness: Harness; model?: string }): Promise<ChatSummary> {
    const existing = this.get();
    if (existing) return Promise.resolve(existing);
    if (this.pending) return this.pending;
    const cwd = this.brainRoot();
    if (!cwd) return Promise.reject(new Error('Collega prima la cartella del brain nelle Impostazioni.'));
    this.pending = this.chats.create({ ...choice, cwd, title: 'Orchestrator', regia: true, regiaName: 'Orchestrator' })
      .finally(() => { this.pending = null; });
    return this.pending;
  }
}
