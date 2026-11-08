// Generation-scoped execution owner used by the utility entry and deterministic transport tests.
// Adapter calls happen exactly once; lost replies are uncertainty, never automatic resubmission.
import type { HarnessSession, SessionSink } from '../chats/session';
import { RuntimeBatcher } from './batcher';
import { RuntimeChannel, RuntimeReceiver, type RuntimeFrame } from './channel';
import type { RuntimeIdentity } from '../../shared/agent-runtime';
import { SemanticSender, type SemanticFrame } from './semantic-transport';

type Methods = Pick<HarnessSession, 'start' | 'send' | 'answer' | 'interrupt' | 'setModel' | 'setPermissionMode' | 'setEffort' | 'rename' | 'contextUsage' | 'usage' | 'close' | 'killNow'>
  & Required<Pick<HarnessSession, 'noRetry' | 'askUser' | 'setRemoteControl'>>;
export type AdapterCommand = { [K in keyof Methods]: { method: K; args: Parameters<Methods[K]> } }[keyof Methods]
  | { method: 'hold'; token: string } | { method: 'release'; token: string };
export type AdapterResult = void | boolean | Awaited<ReturnType<Methods[keyof Methods]>>;
export type AdapterEvent = { [K in keyof SessionSink]-?: { method: K; args: Parameters<NonNullable<SessionSink[K]>> } }[keyof SessionSink];
export interface AdapterSnapshot {
  state: HarnessSession['state']; sessionId: string | null; pid: number | null;
  busy: boolean; alive: boolean; gone: boolean; startedAt: number; canHold: boolean; ready: boolean;
}
export interface HostUpdate { events: AdapterEvent[]; snapshot: AdapterSnapshot; providerWriteAt?: number; textAt?: number }
export type HostUpdateFrame = SemanticFrame<HostUpdate>;

export class HostSession {
  readonly adapter: HarnessSession;
  private readonly receiver: RuntimeReceiver<AdapterCommand, AdapterResult>;
  private readonly updates: RuntimeChannel<HostUpdateFrame, void>;
  private readonly semantic: SemanticSender<HostUpdate>;
  private readonly batcher: RuntimeBatcher;
  private readonly barriers = new Map<string, () => void>();
  private closed = false;
  private ready = false;
  private constructing = true;
  private initialEvents: AdapterEvent[] = [];

  constructor(identity: RuntimeIdentity, create: (sink: SessionSink) => HarnessSession,
    commandReply: (frame: RuntimeFrame<AdapterCommand, AdapterResult>) => void,
    updatePost: (frame: RuntimeFrame<HostUpdateFrame, void>) => void,
    private readonly failed: () => void,
    private readonly beforeCommand: (command: AdapterCommand) => Promise<void> = async () => {},
    private readonly supportsWrites = true) {
    this.updates = new RuntimeChannel(identity, updatePost);
    this.semantic = new SemanticSender(frame => this.updates.request(frame), () => this.fail());
    this.batcher = new RuntimeBatcher(items => this.emit(items.map(({ item, replace }) => ({ method: 'item', args: [item, replace] }))),
      { intervalMs: 16, maxItems: 64, maxBytes: 128 * 1024 }, 16 * 1024 * 1024 - 4096);
    const event = (value: AdapterEvent): void => { this.batcher.boundary(); this.emit([value]); };
    this.adapter = create({
      item: (item, replace) => { try { this.batcher.item(item, replace); } catch { this.fail(); } },
      changed: patch => event({ method: 'changed', args: [patch] }),
      pending: request => event({ method: 'pending', args: [request] }),
      resolved: id => event({ method: 'resolved', args: [id] }),
      exit: info => event({ method: 'exit', args: [info] }),
      rateLimit: value => event({ method: 'rateLimit', args: [value] }),
      models: value => event({ method: 'models', args: [value] }),
      commands: value => event({ method: 'commands', args: [value] }),
      children: value => event({ method: 'children', args: [value] }),
      childrenCoverage: (value, reason) => event({ method: 'childrenCoverage', args: [value, reason] }),
    });
    this.receiver = new RuntimeReceiver(identity, command => this.execute(command), commandReply);
    this.constructing = false;
    queueMicrotask(() => {
      const events = this.initialEvents; this.initialEvents = [];
      if (events.length) this.emit(events);
    });
  }

  receiveCommand(frame: unknown): boolean { return this.receiver.receive(frame); }
  receiveUpdateAck(frame: unknown): boolean { return this.updates.receive(frame); }
  providerWrite(at: number): void { this.batcher.boundary(); this.emit([], at); }

  snapshot(): AdapterSnapshot {
    const a = this.adapter;
    return { state: a.state, sessionId: a.sessionId, pid: a.pid, busy: a.busy, alive: a.alive,
      gone: a.gone ?? false, startedAt: a.startedAt ?? 0, canHold: this.ready && this.supportsWrites && !!a.holdWrites, ready: this.ready };
  }

  /** Called on parent disconnect, replacement or shutdown; never releases a blocked write into a live adapter. */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.semantic.close();
    this.receiver.close(); this.updates.close();
    this.adapter.killNow();
    this.barriers.clear();
    this.batcher.close();
  }

  private async execute(command: AdapterCommand): Promise<AdapterResult> {
    if (this.closed) throw new Error('Runtime session closed');
    await this.beforeCommand(command);
    if (this.closed) throw new Error('Runtime session closed');
    const a = this.adapter;
    switch (command.method) {
      case 'hold': {
        if (!this.ready || !a.holdWrites || this.barriers.has(command.token) || this.barriers.size >= 256) return false;
        let release!: () => void;
        const until = new Promise<void>(resolve => { release = resolve; });
        if (!a.holdWrites(until)) return false;
        this.barriers.set(command.token, release); return true;
      }
      case 'release': {
        const release = this.barriers.get(command.token);
        this.barriers.delete(command.token); release?.(); return;
      }
      case 'start':
        a.start();
        // Acknowledge dispatch, not native readiness: ACP resume alone may legitimately take 120 seconds.
        // Native adapters own their startup deadlines. Readiness arrives separately with its ordered snapshot.
        void Promise.resolve(a.ready).then(() => {
          if (this.closed) return;
          this.ready = true; this.emit([]);
        }).catch(() => this.fail());
        return;
      case 'send': a.send(...command.args); break;
      case 'answer': return a.answer(...command.args);
      case 'interrupt': await a.interrupt(...command.args); break;
      case 'setModel': await a.setModel(...command.args); break;
      case 'setPermissionMode': await a.setPermissionMode(...command.args); break;
      case 'setEffort': await a.setEffort(...command.args); break;
      case 'rename': await a.rename(...command.args); break;
      case 'contextUsage': return a.contextUsage();
      case 'usage': return a.usage();
      case 'close': await a.close(...command.args); await this.semantic.drain(); break;
      case 'killNow': a.killNow(); break;
      case 'noRetry': a.noRetry?.(); break;
      case 'askUser': return a.askUser ? a.askUser(...command.args) : 'This engine cannot ask questions.';
      case 'setRemoteControl': return a.setRemoteControl ? a.setRemoteControl(...command.args) : null;
    }
    this.batcher.boundary(); this.emit([]);
  }

  private emit(events: AdapterEvent[], providerWriteAt?: number): void {
    if (this.closed) return;
    if (this.constructing) {
      this.initialEvents.push(...events);
      if (this.initialEvents.length > 256 || Buffer.byteLength(JSON.stringify(this.initialEvents)) > 256 * 1024)
        throw new Error('Adapter constructor event limit exceeded');
      return;
    }
    const textAt = process.env.SB_TEST === '1' && process.env.SB_RUNTIME_PERF === '1'
      && events.some(event => event.method === 'item' && event.args[0].kind === 'assistant' && !!event.args[0].text) ? Date.now() : undefined;
    const update = { events, snapshot: this.snapshot(), ...(providerWriteAt === undefined ? {} : { providerWriteAt }), ...(textAt === undefined ? {} : { textAt }) };
    this.semantic.send(update);
  }

  private fail(): void { if (!this.closed) { this.dispose(); this.failed(); } }
}
