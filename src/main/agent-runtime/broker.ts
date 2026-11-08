// Main-owned callback broker. Launch callbacks are never serialized; API credentials and destination stay here.
// Response bodies are pulled with bounded credit, and authentication material is redacted across chunk boundaries.
import type { PreparedAdapter } from './adapter-contract';
import type { PreToolCall } from '../chats/session';
import type { CodexExecutionPolicy } from '../brain/adapters/codex-policy';
import type { ListPrice } from '../chats/api';
import { checkBaseUrl } from '../chats/api';

export interface BrokerCalls {
  brief: { input: undefined; output: boolean };
  decide: { input: PreToolCall; output: { deny: string } | null };
  turnEnded: { input: undefined; output: undefined };
  policy: { input: undefined; output: CodexExecutionPolicy | null };
  price: { input: string; output: ListPrice | null };
  open: { input: { id: string; body: string }; output: { status: number } };
  read: { input: string; output: { done: boolean; text: string } };
  abort: { input: string; output: undefined };
}
export type BrokerRequest = { [K in keyof BrokerCalls]: { method: K; input: BrokerCalls[K]['input'] } }[keyof BrokerCalls];
export type BrokerReply = BrokerCalls[keyof BrokerCalls]['output'];
type Plain<T> = Omit<T, 'briefReady' | 'preToolUse' | 'apiKey' | 'pricesOf' | 'fetchImpl' | 'authenticatedRequest' | 'executionPolicy'>;
export type WireAdapter = PreparedAdapter extends infer P ? P extends PreparedAdapter
  ? { kind: P['kind']; options: Plain<P['options']>; callbacks: { brief: boolean; preTool: boolean } } : never : never;

export function wireAdapter(launch: PreparedAdapter): WireAdapter {
  const { briefReady, preToolUse, ...rest } = launch.options;
  const data = { ...rest } as Record<string, unknown>;
  for (const name of ['apiKey', 'pricesOf', 'fetchImpl', 'authenticatedRequest', 'executionPolicy']) delete data[name];
  // Reject new function-valued options rather than silently dropping an authorization hook.
  return structuredClone({ kind: launch.kind, options: data, callbacks: { brief: !!briefReady, preTool: !!preToolUse } }) as WireAdapter;
}

interface Stream {
  ctrl: AbortController; reader?: ReadableStreamDefaultReader<Uint8Array>; key: string;
  decoder: TextDecoder; tail: string; pending: string; ended: boolean; reading: boolean;
}

export class RuntimeBroker {
  private closed = false;
  private readonly streams = new Map<string, Stream>();
  constructor(private readonly launch: PreparedAdapter) {}

  async call(request: BrokerRequest): Promise<BrokerReply> {
    if (this.closed) throw new Error('Broker generation closed');
    const launch = this.launch;
    switch (request.method) {
      case 'brief': return await launch.options.briefReady?.() ?? false;
      case 'decide': return await launch.options.preToolUse?.decide(request.input) ?? null;
      case 'turnEnded': launch.options.preToolUse?.turnEnded(); return;
      case 'policy': return launch.kind === 'codex' ? await launch.options.executionPolicy?.() ?? null : null;
      case 'price': return launch.kind === 'api' ? await launch.options.pricesOf?.(request.input) ?? null : null;
      case 'abort': {
        const stream = this.streams.get(request.input);
        stream?.ctrl.abort(); void stream?.reader?.cancel().catch(() => {});
        this.streams.delete(request.input); return;
      }
      case 'open': {
        if (launch.kind !== 'api' || this.streams.size >= 4 || this.streams.has(request.input.id)
          || Buffer.byteLength(request.input.body) > 1024 * 1024) throw new Error('API request refused');
        const opts = launch.options;
        const checked = checkBaseUrl(opts.baseUrl);
        if ('error' in checked) throw new Error('API endpoint refused');
        const key = opts.apiKey();
        if (!key) return { status: 401 };
        const stream: Stream = { ctrl: new AbortController(), key, decoder: new TextDecoder(), tail: '', pending: '', ended: false, reading: false };
        this.streams.set(request.input.id, stream);
        const anthropic = opts.protocol === 'anthropic';
        const headers: Record<string, string> = anthropic ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { authorization: `Bearer ${key}` };
        try {
          const response = await (opts.fetchImpl ?? fetch)(checked.url.href.replace(/\/+$/, '') + (anthropic ? '/messages' : '/chat/completions'), {
            method: 'POST', headers: { ...headers, 'content-type': 'application/json', accept: 'text/event-stream' },
            body: request.input.body, redirect: 'error', signal: stream.ctrl.signal,
          });
          if (this.closed || stream.ctrl.signal.aborted) { void response.body?.cancel(); throw new Error('Broker closed'); }
          stream.reader = response.body?.getReader(); stream.ended = !stream.reader;
          return { status: response.status };
        } catch {
          this.streams.delete(request.input.id); stream.ctrl.abort();
          throw new Error('Authenticated API request failed');
        }
      }
      case 'read': return this.read(request.input);
    }
  }

  dispose(): void {
    this.closed = true;
    for (const stream of this.streams.values()) { stream.ctrl.abort(); void stream.reader?.cancel().catch(() => {}); }
    this.streams.clear();
  }

  private async read(id: string): Promise<{ done: boolean; text: string }> {
    const stream = this.streams.get(id);
    if (!stream) return { done: true, text: '' };
    if (stream.reading) throw new Error('Concurrent API read refused');
    stream.reading = true;
    try {
      while (!stream.pending && !stream.ended) {
        const chunk = await stream.reader!.read();
        const text = (stream.tail + stream.decoder.decode(chunk.value, { stream: !chunk.done })).split(stream.key).join('***');
        // Keep only a suffix that could still be the beginning of the key, including split UTF-8 chunks.
        let keep = 0;
        if (!chunk.done) for (let n = 1; n < stream.key.length && n <= text.length; n++) if (text.endsWith(stream.key.slice(0, n))) keep = n;
        stream.tail = keep ? text.slice(-keep) : '';
        stream.pending = keep ? text.slice(0, -keep) : text;
        if (stream.pending.length > 1024 * 1024) throw new Error('API chunk limit exceeded');
        stream.ended = chunk.done;
      }
      let end = Math.min(stream.pending.length, 16 * 1024);
      if (end < stream.pending.length && /[\uD800-\uDBFF]/.test(stream.pending[end - 1]!)) end--;
      const text = stream.pending.slice(0, end);
      stream.pending = stream.pending.slice(text.length);
      const done = stream.ended && !stream.pending;
      if (done) this.streams.delete(id);
      return { done, text };
    } finally { stream.reading = false; }
  }
}
