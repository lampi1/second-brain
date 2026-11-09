// Main-side session projection. Commands are generation-bound RPCs; permission consumption has a separate async API.
// The synchronous answer refuses this path: the manager journals delivery only after answerConsumed acknowledges it.
import { randomUUID } from 'node:crypto';
import type { Answer, Effort, ImageAttachment, PermissionMode } from '../../shared/contract';
import type { RuntimeIdentity } from '../../shared/agent-runtime';
import type { AnswerPatch, AppAsk, ContextUsage, HarnessSession, SessionSink } from '../chats/session';
import type { RemoteControlReply } from '../chats/remote-control';
import type { RuntimeAnswerConsumer } from './adapter-contract';
import { RuntimeChannel, RuntimeReceiver, type RuntimeFrame } from './channel';
import type { AdapterCommand, AdapterEvent, AdapterResult, AdapterSnapshot, HostUpdate, HostUpdateFrame } from './host-session';
import { SemanticReceiver } from './semantic-transport';
import { receiveHostTextTime, receiveHostTransportTime } from './transport-timing';

export class RuntimeSessionProxy implements HarnessSession, RuntimeAnswerConsumer {
  private view: AdapterSnapshot = { state: 'starting', sessionId: null, pid: null, busy: true, alive: false, gone: false, startedAt: 0, canHold: false, ready: false };
  private readonly commands: RuntimeChannel<AdapterCommand, AdapterResult>;
  private readonly updates: RuntimeReceiver<HostUpdateFrame, void>;
  private readonly semantic: SemanticReceiver<HostUpdate>;
  private ended = false;
  private closing = false;
  private exitSeen = false;
  private pendingHold: Promise<AdapterResult> | null = null;
  private heldSends = 0;
  private heldBytes = 0;
  private sendEpoch = 0;
  private readyResolve!: () => void;
  readonly ready = new Promise<void>(resolve => { this.readyResolve = resolve; });
  readonly root = null;
  readonly jobHandle = null;

  constructor(readonly harness: string, identity: RuntimeIdentity, private readonly sink: SessionSink,
    postCommand: (frame: RuntimeFrame<AdapterCommand, AdapterResult>) => void,
    postUpdateAck: (frame: RuntimeFrame<HostUpdateFrame, void>) => void,
    private readonly release: () => void) {
    this.commands = new RuntimeChannel(identity, postCommand);
    this.semantic = new SemanticReceiver(update => {
      if (this.ended) return;
      if (update.providerWriteAt !== undefined) receiveHostTransportTime(identity.chatId, update.providerWriteAt);
      if (update.textAt !== undefined) receiveHostTextTime(identity.chatId, update.textAt);
      this.view = update.snapshot;
      if (this.view.ready) this.readyResolve();
      for (const event of update.events) { if (this.ended) break; this.event(event); }
    });
    this.updates = new RuntimeReceiver(identity, async frame => this.semantic.receive(frame), postUpdateAck);
  }

  get state() { return this.view.state; }
  get sessionId() { return this.view.sessionId; }
  get pid() { return this.view.pid; }
  get busy() { return this.view.busy; }
  get alive() { return this.view.alive; }
  get gone() { return this.ended || this.view.gone; }
  get startedAt() { return this.view.startedAt; }
  receiveReply(frame: unknown): boolean { return this.commands.receive(frame); }
  receiveUpdate(frame: unknown): boolean { return this.updates.receive(frame); }

  start(): void { this.fire({ method: 'start', args: [] }); }
  send(text: string, images?: readonly ImageAttachment[]): void {
    if (!this.pendingHold) { this.fire({ method: 'send', args: [text, images] }); return; }
    const bytes = Buffer.byteLength(JSON.stringify([text, images]));
    if (this.heldSends >= 256 || this.heldBytes + bytes > 64 * 1024 * 1024) throw new Error('Runtime pending send budget exhausted; message not dispatched');
    this.heldSends++; this.heldBytes += bytes;
    const epoch = this.sendEpoch;
    void this.pendingHold.then(ok => {
      if (epoch !== this.sendEpoch || this.ended) return;
      if (ok === true && !this.ended) this.fire({ method: 'send', args: [text, images] });
      else this.hostDied();
    }, () => this.hostDied()).finally(() => { this.heldSends--; this.heldBytes -= bytes; });
  }
  answer(_id: string, _answer: Answer, _patch?: AnswerPatch): boolean {
    throw new Error('Runtime answers require await session.answerConsumed(); synchronous consumption is disabled.');
  }
  async answerConsumed(id: string, answer: Answer, patch?: AnswerPatch): Promise<boolean> {
    return await this.call({ method: 'answer', args: [id, answer, patch] }) === true;
  }
  holdWrites(until: Promise<unknown>): boolean {
    if (this.ended || !this.view.canHold) return false;
    const token = randomUUID();
    const held = this.call({ method: 'hold', token });
    this.pendingHold = held;
    void held.then(ok => { if (ok !== true) this.hostDied(); }, () => this.hostDied());
    // The hold command is posted before send; release cannot overtake its host acknowledgement.
    void Promise.all([held, until.catch(() => undefined)]).then(([ok]) => {
      if (ok === true && !this.ended) this.fire({ method: 'release', token });
    }, () => this.hostDied());
    return true;
  }
  async interrupt(opts?: { keepQueued?: boolean; byUser?: boolean }): Promise<void> {
    if (!opts?.keepQueued) this.sendEpoch++;
    await this.call({ method: 'interrupt', args: [opts] });
  }
  noRetry(): void { this.fire({ method: 'noRetry', args: [] }); }
  async askUser(q: AppAsk): Promise<string | null> { return await this.call({ method: 'askUser', args: [q] }) as string | null; }
  async setModel(model: string | null): Promise<void> { await this.call({ method: 'setModel', args: [model] }); }
  async setPermissionMode(mode: PermissionMode): Promise<void> { await this.call({ method: 'setPermissionMode', args: [mode] }); }
  async setEffort(effort: Effort | null): Promise<void> { await this.call({ method: 'setEffort', args: [effort] }); }
  async rename(title: string): Promise<void> { await this.call({ method: 'rename', args: [title] }); }
  async setRemoteControl(enabled: boolean, opts?: { name?: string; reattach?: string | null }): Promise<RemoteControlReply | null> {
    return await this.call({ method: 'setRemoteControl', args: [enabled, opts] }) as RemoteControlReply | null;
  }
  async contextUsage(): Promise<ContextUsage | null> { return await this.call({ method: 'contextUsage', args: [] }) as ContextUsage | null; }
  async usage(): Promise<unknown> { return this.call({ method: 'usage', args: [] }); }
  async close(graceMs?: number, keepChildren?: boolean): Promise<void> {
    this.closing = true;
    this.sendEpoch++;
    try { await this.call({ method: 'close', args: [graceMs, keepChildren] }); }
    finally { this.dispose(); }
  }
  killNow(): void { this.sendEpoch++; this.fire({ method: 'killNow', args: [] }); }

  hostDied(): void {
    if (this.ended) return;
    this.view = { ...this.view, state: 'error', busy: false, alive: false, gone: true, canHold: false };
    this.dispose();
    this.sink.changed({ state: 'error' });
    if (!this.exitSeen) this.sink.exit({ code: null, error: 'Host di esecuzione terminato: esito delle operazioni incerte, nessuna azione ripetuta.' });
  }

  private call(command: AdapterCommand): Promise<AdapterResult> { return this.commands.request(command); }
  private fire(command: AdapterCommand): void { void this.call(command).catch(() => this.hostDied()); }
  private dispose(): void {
    if (this.ended) return;
    this.ended = true; this.commands.close(); this.updates.close(); this.semantic.close(); this.readyResolve(); this.release();
  }
  private event(event: AdapterEvent): void {
    switch (event.method) {
      case 'item': this.sink.item(...event.args); break;
      case 'changed': this.sink.changed(...event.args); break;
      case 'pending': this.sink.pending(...event.args); break;
      case 'resolved': this.sink.resolved(...event.args); break;
      case 'exit':
        this.exitSeen = true;
        this.sink.exit(...event.args);
        // A native exit otherwise leaves a host slot behind forever. A requested close retains its RPC
        // until the host acknowledges completion; retiring earlier would falsely make that close uncertain.
        if (!this.closing) this.dispose();
        break;
      case 'rateLimit': this.sink.rateLimit?.(...event.args); break;
      case 'models': this.sink.models?.(...event.args); break;
      case 'commands': this.sink.commands?.(...event.args); break;
      case 'children': this.sink.children?.(...event.args); break;
      case 'childrenCoverage': this.sink.childrenCoverage?.(...event.args); break;
    }
  }
}
