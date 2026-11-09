// App-owned utility process: adapter execution, stream decoding/assembly and API history persistence live here.
// Parent disconnect ends every session. There is no listener, daemon, restart or uncertain-effect replay.
import { randomUUID } from 'node:crypto';
import { AcpSession } from '../chats/acp';
import { ApiSession, FIRST_BYTE_MS } from '../chats/api';
import { ClaudeSession } from '../chats/claude';
import { CodexSession } from '../chats/codex';
import { RuntimeChannel, type RuntimeRequestOptions } from './channel';
import { HostSession } from './host-session';
import { setTransportTimingForwarder } from './transport-timing';
import type { BrokerCalls, BrokerReply, BrokerRequest } from './broker';
import type { RuntimePacket } from './packets';
import { RUNTIME_PROTOCOL_VERSION, sameRuntimeIdentity, type RuntimeIdentity } from '../../shared/agent-runtime';

const port = process.parentPort;
if (!port) throw new Error('Agent runtime requires an app-owned utility parent');
const sessions = new Map<string, { identity: RuntimeIdentity; host: HostSession; broker: RuntimeChannel<BrokerRequest, BrokerReply> }>();
const generations = new Map<string, number>();
let epoch: string | null = null;
const post = (packet: RuntimePacket): void => port.postMessage(packet);
if (process.env.SB_TEST === '1' && process.env.SB_RUNTIME_PERF === '1')
  setTransportTimingForwarder((chatId, at) => sessions.get(chatId)?.host.providerWrite(at));

/** False = refused: the caller reports it at once (main ignores a failure for an identity it no longer holds). */
function launch(packet: Extract<RuntimePacket, { kind: 'launch' }>): boolean {
  const { identity, launch: spec } = packet;
  if (identity.protocolVersion !== RUNTIME_PROTOCOL_VERSION || !Number.isSafeInteger(identity.sessionGeneration)
    || identity.sessionGeneration <= (generations.get(identity.chatId) ?? 0)
    || sessions.size >= 64 && !sessions.has(identity.chatId)
    || epoch !== null && identity.hostEpoch !== epoch) return false;
  epoch = identity.hostEpoch;
  const old = sessions.get(identity.chatId);
  old?.host.dispose(); old?.broker.close();
  generations.set(identity.chatId, identity.sessionGeneration);
  const broker = new RuntimeChannel<BrokerRequest, BrokerReply>(identity, frame => post({ kind: 'broker', frame }));
  const call = async <K extends keyof BrokerCalls>(method: K, input: BrokerCalls[K]['input'], options?: RuntimeRequestOptions): Promise<BrokerCalls[K]['output']> =>
    await broker.request({ method, input } as BrokerRequest, options) as BrokerCalls[K]['output'];
  // Deadlines per command (review M1): the API adapter owns its first-byte timer and aborts the signal on expiry, so
  // open outlives it as a backstop, and a read waits for the next chunk as long as the stream lives (no idle limit
  // in-process either). Both end with their signal or this generation.
  const openMs = Math.max(30_000, (spec.kind === 'api' ? spec.options.firstByteMs ?? FIRST_BYTE_MS : FIRST_BYTE_MS) + 5_000);
  const fail = (): void => {
    const current = sessions.get(identity.chatId);
    if (!current || !sameRuntimeIdentity(current.identity, identity)) return;
    current.host.dispose(); broker.close();
    post({ kind: 'failed', identity });
  };
  const host = new HostSession(identity, sink => {
    const common = {
      ...(spec.callbacks.brief ? { briefReady: () => call('brief', undefined) } : {}),
      ...(spec.callbacks.preTool ? { preToolUse: {
        decide: (input: BrokerCalls['decide']['input']) => call('decide', input),
        turnEnded: () => { void call('turnEnded', undefined).catch(fail); },
      } } : {}),
    };
    switch (spec.kind) {
      case 'claude': return new ClaudeSession({ ...spec.options, ...common }, sink);
      case 'acp': return new AcpSession({ ...spec.options, ...common }, sink);
      case 'codex': return new CodexSession({ ...spec.options, ...common, executionPolicy: async () => {
        const policy = await call('policy', undefined);
        if (!policy) throw new Error('Execution policy not acknowledged');
        return policy;
      } }, sink);
      case 'api': return new ApiSession({ ...spec.options, ...common, apiKey: () => null,
        pricesOf: model => call('price', model).catch(() => null),
        authenticatedRequest: async (body, signal) => {
          const id = randomUUID();
          let aborted = false;
          const abort = () => { if (aborted) return; aborted = true; void call('abort', id).catch(() => {}); };
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) { signal.removeEventListener('abort', abort); throw new Error('API request cancelled'); }
          try {
            const result = await call('open', { id, body }, { timeoutMs: openMs, signal });
            if (signal.aborted) { abort(); throw new Error('API request cancelled'); }
            const stream = new ReadableStream<Uint8Array>({
              async pull(controller) {
                try {
                  const chunk = await call('read', id, { timeoutMs: null, signal });
                  if (chunk.text) controller.enqueue(new TextEncoder().encode(chunk.text));
                  if (chunk.done) { signal.removeEventListener('abort', abort); controller.close(); }
                } catch (error) { signal.removeEventListener('abort', abort); abort(); controller.error(error); }
              },
              cancel() { signal.removeEventListener('abort', abort); abort(); },
            });
            return new Response(stream, { status: result.status });
          } catch (error) { signal.removeEventListener('abort', abort); abort(); throw error; }
        },
      }, sink);
    }
  }, frame => post({ kind: 'command', frame }), frame => post({ kind: 'update', frame }), fail, undefined, spec.kind === 'claude' && !spec.options.readOnly);
  sessions.set(identity.chatId, { identity, host, broker });
  return true;
}

function shutdown(): void {
  for (const session of sessions.values()) { session.host.dispose(); session.broker.close(); }
  sessions.clear();
  process.exit(0);
}

port.on('message', event => {
  const packet = event.data as RuntimePacket;
  if (packet.kind === 'shutdown') return shutdown();
  if (packet.kind === 'launch') {
    let launched = false;
    try { launched = launch(packet); } catch { /* reported below */ }
    if (!launched) post({ kind: 'failed', identity: packet.identity });
    return;
  }
  const identity = 'frame' in packet ? packet.frame : packet.identity;
  const session = sessions.get(identity.chatId);
  if (!session || !sameRuntimeIdentity(identity, session.identity)) return;
  switch (packet.kind) {
    case 'command': session.host.receiveCommand(packet.frame); break;
    case 'update': session.host.receiveUpdateAck(packet.frame); break;
    case 'broker': session.broker.receive(packet.frame); break;
    case 'release': session.host.dispose(); session.broker.close(); sessions.delete(identity.chatId); break;
  }
});
process.once('disconnect', shutdown);
