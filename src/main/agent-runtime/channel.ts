// One generation-scoped RPC channel for main/utility transport. Bounded, single-dispatch and fail-closed:
// missing replies mean uncertainty, never a reason to execute the command again. Transport is injected for tests.
import { randomUUID } from 'node:crypto';
import { sameRuntimeIdentity, type RuntimeEnvelope, type RuntimeIdentity, type RuntimeOutcome } from '../../shared/agent-runtime';

export type RuntimeReply<T> = { kind: 'reply'; ok: true; value: T }
  | { kind: 'reply'; ok: false; outcome: 'rejected' | 'uncertain'; error: string };
export type RuntimeRequest<T> = { kind: 'request'; value: T };
export type RuntimeFrame<I, O> = RuntimeEnvelope<RuntimeRequest<I> | RuntimeReply<O>>;

export class RuntimeOperationError extends Error {
  constructor(readonly outcome: RuntimeOutcome, readonly operationId: string, message: string) {
    super(message); this.name = 'RuntimeOperationError';
  }
}

type Pending<O> = {
  sequence: number;
  bytes: number;
  resolve(value: O): void;
  reject(error: RuntimeOperationError): void;
  detach(): void;
};

/** Per-request bounds. timeoutMs null = no reply deadline (a long-lived stream read): the request still ends with
 *  its generation (close) or its signal, both as uncertainty. Undefined = the channel's default deadline. */
export interface RuntimeRequestOptions { timeoutMs?: number | null; signal?: AbortSignal }

export class RuntimeChannel<I, O> {
  private nextSequence = 0;
  private readonly pending = new Map<string, Pending<O>>();
  private closed = false;
  private pendingBytes = 0;

  constructor(readonly identity: Readonly<RuntimeIdentity>, private readonly post: (frame: RuntimeFrame<I, O>) => void,
    private readonly timeoutMs = 30_000, private readonly limit = 256, private readonly maxBytes = 64 * 1024 * 1024) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1)
      throw new Error('Invalid runtime channel bounds');
    this.identity = Object.freeze({ ...identity });
  }

  get outstanding(): number { return this.pending.size; }

  request(value: I, options: RuntimeRequestOptions = {}): Promise<O> {
    const operationId = randomUUID();
    const timeoutMs = options.timeoutMs === undefined ? this.timeoutMs : options.timeoutMs;
    if (timeoutMs !== null && (!Number.isFinite(timeoutMs) || timeoutMs <= 0))
      return Promise.reject(new RuntimeOperationError('not-dispatched', operationId, 'Invalid runtime request deadline'));
    if (options.signal?.aborted) return Promise.reject(new RuntimeOperationError('not-dispatched', operationId, 'Runtime request cancelled'));
    if (this.closed || this.pending.size >= this.limit)
      return Promise.reject(new RuntimeOperationError('not-dispatched', operationId, this.closed ? 'Runtime closed' : 'Runtime queue full'));
    let bytes: number;
    try { bytes = Buffer.byteLength(JSON.stringify({ value })) + 512; }
    catch { return Promise.reject(new RuntimeOperationError('not-dispatched', operationId, 'Runtime request is not serializable')); }
    if (bytes + this.pendingBytes > this.maxBytes)
      return Promise.reject(new RuntimeOperationError('not-dispatched', operationId, 'Runtime byte budget exhausted'));
    const sequence = ++this.nextSequence;
    return new Promise<O>((resolve, reject) => {
      // Local abandonment only: a late reply is dropped as unknown, and the command is never sent again.
      const abandon = (message: string): void => {
        const p = this.pending.get(operationId);
        if (!p) return;
        p.detach(); this.pending.delete(operationId); this.pendingBytes -= bytes;
        reject(new RuntimeOperationError('uncertain', operationId, message));
      };
      const onAbort = (): void => abandon('Runtime request cancelled; not retried');
      const timer = timeoutMs === null ? undefined : setTimeout(() => abandon('Runtime reply deadline expired; not retried'), timeoutMs);
      timer?.unref?.();
      const detach = (): void => { clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort); };
      this.pendingBytes += bytes;
      this.pending.set(operationId, { sequence, bytes, resolve, reject, detach });
      options.signal?.addEventListener('abort', onAbort, { once: true });
      // A throwing post may already have sent the frame. Conservatively uncertain, never a safe-to-retry claim.
      try { this.post({ ...this.identity, operationId, sequence, payload: { kind: 'request', value } }); }
      catch { abandon('Runtime transport failed; not retried'); }
    });
  }

  receive(frame: unknown): boolean {
    if (this.closed || !sameRuntimeIdentity(frame, this.identity)) return false;
    const f = frame as RuntimeFrame<I, O>;
    if (typeof f.operationId !== 'string' || !Number.isSafeInteger(f.sequence) || !f.payload || f.payload.kind !== 'reply') return false;
    const p = this.pending.get(f.operationId);
    if (!p || p.sequence !== f.sequence || typeof f.payload.ok !== 'boolean') return false;
    if (!f.payload.ok && (typeof f.payload.error !== 'string' || !['rejected', 'uncertain'].includes(f.payload.outcome))) return false;
    p.detach(); this.pending.delete(f.operationId);
    this.pendingBytes -= p.bytes;
    if (f.payload.ok) p.resolve(f.payload.value);
    else p.reject(new RuntimeOperationError(f.payload.outcome, f.operationId, f.payload.error));
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [id, p] of this.pending) {
      p.detach();
      p.reject(new RuntimeOperationError('uncertain', id, 'Runtime generation ended; not retried'));
    }
    this.pending.clear();
    this.pendingBytes = 0;
  }
}

/** Receiver-side monotonic admission: identities and sequence are checked before execute. No result cache or
 *  automatic replay: a duplicate, a gap or a backwards sequence is rejected even when its earlier reply was lost.
 *  Concurrent commands may finish out of order (interrupt must not wait behind a blocked permission call). */
export class RuntimeReceiver<I, O> {
  private sequence = 0;
  private inFlight = 0;
  private closed = false;
  private readonly ids = new Set<string>();

  constructor(readonly identity: Readonly<RuntimeIdentity>, private readonly execute: (input: I) => Promise<O>,
    private readonly post: (frame: RuntimeFrame<I, O>) => void, private readonly limit = 256,
    private readonly operationLimit = 65_536) {
    this.identity = Object.freeze({ ...identity });
  }

  receive(frame: unknown): boolean {
    if (this.closed || !sameRuntimeIdentity(frame, this.identity)) return false;
    const f = frame as RuntimeFrame<I, O>;
    if (typeof f.operationId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(f.operationId)
      || !Number.isSafeInteger(f.sequence) || f.sequence !== this.sequence + 1
      || !f.payload || f.payload.kind !== 'request' || this.ids.has(f.operationId)) return false;
    this.sequence = f.sequence;
    // Never evict deduplication identities within a generation: eviction would make old effects replayable.
    if (this.ids.size >= this.operationLimit) { this.reply(f, { kind: 'reply', ok: false, outcome: 'rejected', error: 'Runtime generation operation limit reached' }); this.close(); return true; }
    this.ids.add(f.operationId);
    if (this.inFlight >= this.limit) { this.reply(f, { kind: 'reply', ok: false, outcome: 'rejected', error: 'Runtime queue full' }); return true; }
    this.inFlight++;
    // Capture synchronous adapter failures as rejections too, without leaking provider payloads or keys.
    void Promise.resolve().then(() => {
      if (this.closed) throw new Error('closed');
      return this.execute((f.payload as RuntimeRequest<I>).value);
    }).then(value => this.reply(f, { kind: 'reply', ok: true, value }),
      () => this.reply(f, { kind: 'reply', ok: false, outcome: 'uncertain', error: 'Runtime command failed after admission; not retried' }))
      .finally(() => { this.inFlight--; });
    return true;
  }

  close(): void { this.closed = true; }
  private reply(request: RuntimeEnvelope<unknown>, payload: RuntimeReply<O>): void {
    if (this.closed) return;
    try { this.post({ ...this.identity, operationId: request.operationId, sequence: request.sequence, payload }); }
    catch { this.close(); } // a lost reply never causes execute() to run a second time
  }
}
