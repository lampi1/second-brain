// A short main-owned quiescence window for applying an update. This is lifecycle coordination, not a permission mode.
// Existing mutating IPC/MCP calls must finish first; new work is refused until the owning transaction releases it.
import type { InvokeChannel } from '../../shared/contract';

const READS = new Set<InvokeChannel>([
  'app:info', 'app:usage', 'app:brainCreation', 'app:inputLag', 'chat:list', 'chat:items', 'chat:pending', 'chat:commands', 'chat:handoffRead',
  'chat:autoCloseGet', 'chat:autoClosePresence', 'browser:list', 'browser:handoffs', 'browser:envList', 'views:layout', 'feed:list',
  'settings:get', 'settings:schema', 'settings:history', 'settings:pending', 'models:seen', 'routing:get', 'routing:preview',
  'overlay:model', 'overlay:size', 'overlay:focus', 'run:list', 'secrets:status', 'engines:spend', 'tasks:get', 'sync:get',
  'later:get', 'source:get', 'agents:list', 'agents:history', 'agents:metrics', 'agents:estimates', 'setup:get', 'profile:get', 'progress:get', 'headline:get', 'orchestrator:held',
]);
export class UpdateActivity {
  private active = 0;
  private owner: object | null = null;
  get frozen(): boolean { return this.owner !== null; }
  assertOpen(): void { if (this.frozen) throw new Error('Aggiornamento in corso: il lavoro viene salvato.'); }
  enter(): () => void {
    this.assertOpen(); this.active++;
    let left = false;
    return () => { if (!left) { left = true; this.active--; } };
  }
  async run<T>(fn: () => T | Promise<T>): Promise<T> {
    const leave = this.enter(); try { return await fn(); } finally { leave(); }
  }
  acquire(): () => void {
    this.assertOpen();
    if (this.active) throw new Error('Attendi che le operazioni in corso terminino prima di aggiornare.');
    const owner = {}; this.owner = owner;
    return () => { if (this.owner === owner) this.owner = null; };
  }
  tracks(channel: InvokeChannel): boolean { return !channel.startsWith('update:') && !READS.has(channel); }
}
export const updateActivity = new UpdateActivity();
