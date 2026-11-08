// Main owns the lifetime and narrow callback broker of a reusable Electron utility host.
// It is explicitly opt-in until manager permission receipts await the host's consumption acknowledgement.
import { app, utilityProcess, type UtilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RUNTIME_PROTOCOL_VERSION, sameRuntimeIdentity, type RuntimeIdentity } from '../../shared/agent-runtime';
import { jobGuard } from '../chats/jobguard';
import { RuntimeBroker, wireAdapter, type BrokerReply, type BrokerRequest } from './broker';
import { RuntimeReceiver } from './channel';
import { setRuntimeFactory, type PreparedAdapter } from './adapter-contract';
import type { SessionSink } from '../chats/session';
import type { RuntimePacket } from './packets';
import { RuntimeSessionProxy } from './proxy';

export class RuntimeSupervisor {
  private process: UtilityProcess | null = null;
  private epoch = '';
  private generation = 0;
  private stopped = false;
  private readonly sessions = new Map<string, {
    identity: RuntimeIdentity; proxy: RuntimeSessionProxy; broker: RuntimeBroker; receiver: RuntimeReceiver<BrokerRequest, BrokerReply>;
  }>();

  get pid(): number | null { return this.process?.pid ?? null; }

  create(launch: PreparedAdapter, sink: SessionSink): RuntimeSessionProxy {
    if (this.stopped) throw new Error('Runtime is shutting down');
    const spec = wireAdapter(launch);
    const child = this.ensureProcess();
    const identity: RuntimeIdentity = { protocolVersion: RUNTIME_PROTOCOL_VERSION, hostEpoch: this.epoch,
      chatId: launch.options.chatId, sessionGeneration: ++this.generation };
    this.sessions.get(identity.chatId)?.proxy.hostDied();
    const post = (packet: RuntimePacket): void => { if (child !== this.process) throw new Error('Runtime generation lost'); child.postMessage(packet); };
    const broker = new RuntimeBroker(launch);
    const receiver = new RuntimeReceiver<BrokerRequest, BrokerReply>(identity, request => broker.call(request), frame => post({ kind: 'broker', frame }));
    const proxy = new RuntimeSessionProxy(launch.kind === 'claude' ? 'claude' : launch.options.engineId, identity, sink,
      frame => post({ kind: 'command', frame }), frame => post({ kind: 'update', frame }), () => {
        receiver.close(); broker.dispose();
        if (this.sessions.get(identity.chatId)?.proxy !== proxy) return;
        this.sessions.delete(identity.chatId);
        if (child === this.process) { try { post({ kind: 'release', identity }); } catch { /* host already disconnected */ } }
      });
    this.sessions.set(identity.chatId, { identity, proxy, broker, receiver });
    post({ kind: 'launch', identity, launch: spec });
    return proxy;
  }

  shutdown(): void {
    if (this.stopped) return;
    this.stopped = true;
    const child = this.process; this.process = null;
    for (const session of this.sessions.values()) session.proxy.hostDied();
    this.sessions.clear();
    child?.kill();
  }

  private ensureProcess(): UtilityProcess {
    if (this.process) return this.process;
    this.epoch = randomUUID();
    const child = utilityProcess.fork(fileURLToPath(new URL('./agent-runtime.js', import.meta.url)), [], {
      serviceName: 'second-brain-agent-runtime', stdio: 'ignore',
    });
    this.process = child;
    child.once('spawn', () => { if (child.pid) void jobGuard.add(child.pid, 'agent-runtime'); });
    child.on('message', (packet: RuntimePacket) => {
      if (child !== this.process || !packet || !('frame' in packet || 'identity' in packet)) return;
      const identity = 'frame' in packet ? packet.frame : packet.identity;
      const session = this.sessions.get(identity.chatId);
      if (!session || !sameRuntimeIdentity(identity, session.identity)) return;
      switch (packet.kind) {
        case 'command': session.proxy.receiveReply(packet.frame); break;
        case 'update': session.proxy.receiveUpdate(packet.frame); break;
        case 'broker': session.receiver.receive(packet.frame); break;
        case 'failed': session.proxy.hostDied(); break;
      }
    });
    child.once('exit', () => {
      if (child !== this.process) return;
      this.process = null;
      for (const session of this.sessions.values()) session.proxy.hostDied();
      this.sessions.clear();
    });
    return child;
  }
}

export function configureRuntimeHost(): RuntimeSupervisor | null {
  if (process.env.SB_AGENT_RUNTIME_HOST !== '1') return null;
  const supervisor = new RuntimeSupervisor();
  setRuntimeFactory((launch, sink) => supervisor.create(launch, sink));
  app.once('will-quit', () => supervisor.shutdown());
  process.once('exit', () => supervisor.shutdown());
  return supervisor;
}
