// Opt-in main-process baseline recorder for the app-owned runtime migration. Normal runs allocate no histogram and
// retain no rows. Controlled sequential replay uses this through a test-only main-process handle, never renderer IPC.
// No prompts, payloads, keys or paths are stored. Ambiguous overlapping turns are excluded instead of misattributed.
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { RuntimeDiagnostic, RuntimePercentiles, RuntimeTimingRow, RuntimeTimingStage } from '../shared/runtime-performance';

const LIMIT = 4096;
// Cross-process milestones use the same system clock. Separate Chromium/Node performance time origins may differ
// by a fraction of a millisecond on Windows, making a valid renderer send appear to be in main's future.
// Resolution is 1 ms; event-loop histogram and CPU measurements keep their native high-resolution clocks.
const now = (): number => Date.now();
export function percentiles(values: readonly number[]): RuntimePercentiles {
  const sorted = values.filter(v => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const at = (p: number): number | null => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]! : null;
  return { n: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1) ?? null };
}

/** A bounded sample window, controlled only by main. A full window refuses new samples (visible in dropped). */
export class RuntimePerformance {
  private enabled = false;
  private rows: RuntimeTimingRow[] = [];
  private active = new Map<string, RuntimeTimingRow>();
  private ids = new Set<string>();
  private freshSessions = new Map<string, number>();
  private dropped = 0;
  private started = 0;
  private cpuStart: NodeJS.CpuUsage = { user: 0, system: 0 };
  private rssStart = 0;
  private ipcEvents = 0;
  private ipcBytes = 0;
  private histogram: ReturnType<typeof monitorEventLoopDelay> | undefined;

  constructor(private readonly clock: () => number = now) {}

  start(): void {
    this.stop();
    this.rows = []; this.active.clear(); this.ids.clear(); this.freshSessions.clear(); this.dropped = 0;
    this.ipcEvents = 0; this.ipcBytes = 0;
    this.started = this.clock(); this.cpuStart = process.cpuUsage(); this.rssStart = process.memoryUsage().rss;
    this.histogram = monitorEventLoopDelay({ resolution: 10 });
    this.histogram.enable(); this.enabled = true;
  }

  stop(): void { this.enabled = false; this.histogram?.disable(); }

  begin(chatId: string, raw: unknown): void {
    if (!this.enabled || !raw || typeof raw !== 'object') return;
    const d = raw as Partial<RuntimeDiagnostic>, at = this.clock();
    if (typeof chatId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(chatId) || typeof d.operationId !== 'string'
      || !/^[a-zA-Z0-9_-]{1,80}$/.test(d.operationId) || typeof d.sentAt !== 'number'
      || !Number.isFinite(d.sentAt) || d.sentAt > at || at - d.sentAt > 60_000) { this.dropped++; return; }
    const previous = this.active.get(chatId);
    if (previous) previous.invalid = 'overlap';
    // A duplicate cannot relabel an existing measurement; the new attempt is also an ambiguous overlap.
    if (this.ids.has(d.operationId) || this.rows.length >= LIMIT) { this.dropped++; return; }
    const row: RuntimeTimingRow = { operationId: d.operationId, chatId, uiAt: d.sentAt, marks: { main: at }, ...(previous ? { invalid: 'overlap' as const } : {}) };
    this.ids.add(d.operationId); this.rows.push(row); this.active.set(chatId, row);
  }

  sessionCreated(chatId: string): void {
    if (this.enabled && this.freshSessions.size < LIMIT) this.freshSessions.set(chatId, this.clock());
  }

  runtime(chatId: string, engine: string, warm: boolean, busy: boolean): void {
    const createdAt = this.freshSessions.get(chatId), fresh = createdAt !== undefined;
    this.freshSessions.delete(chatId);
    const row = this.current(chatId);
    if (!row) return;
    if (busy && !fresh) row.invalid = 'overlap';
    if (createdAt !== undefined) row.sessionCreatedAt = createdAt;
    row.engine = engine; row.temperature = warm && !fresh ? 'warm' : 'cold'; this.mark(chatId, 'runtime');
  }

  /** Means bytes submitted to the adapter's transport, NOT remote acceptance or inference start. */
  providerWrite(chatId: string): void {
    if (this.current(chatId)?.marks.runtime !== undefined) this.mark(chatId, 'providerWrite');
  }

  item(chatId: string, kind: string, hasText: boolean, replaying: boolean): void {
    if (replaying || this.current(chatId)?.marks.providerWrite === undefined) return;
    if (kind === 'assistant' && hasText) this.mark(chatId, 'firstText');
    if (kind === 'result') { this.mark(chatId, 'result'); this.active.delete(chatId); }
  }

  fail(chatId: string): void {
    const row = this.current(chatId);
    if (row) row.invalid = 'failed';
    this.active.delete(chatId);
  }

  /** Call only after an actual webContents.send. Serializing for byte accounting is opt-in diagnostic overhead. */
  ipc(payload: unknown, chatId?: string, firstText = false): void {
    if (!this.enabled) return;
    this.ipcEvents++;
    try { this.ipcBytes += Buffer.byteLength(JSON.stringify(payload) ?? ''); } catch { /* diagnostics never break delivery */ }
    if (chatId && firstText && this.current(chatId)?.marks.firstText !== undefined) this.mark(chatId, 'firstTextIpc');
  }

  snapshot() {
    const elapsedMs = this.clock() - this.started, cpu = process.cpuUsage(this.cpuStart), h = this.histogram;
    const rows = this.rows.map(r => ({ ...r, marks: { ...r.marks }, ...(!r.invalid && r.marks.result === undefined ? { invalid: 'incomplete' as const } : {}) }));
    const good = rows.filter(r => !r.invalid);
    const groups = [...new Set(good.map(r => `${r.engine}/${r.temperature}`))].map(key => {
      const group = good.filter(r => `${r.engine}/${r.temperature}` === key);
      const duration = (from: 'uiAt' | RuntimeTimingStage, to: RuntimeTimingStage) => percentiles(group.flatMap(r => {
        const a = from === 'uiAt' ? r.uiAt : r.marks[from], b = r.marks[to];
        return a !== undefined && b !== undefined ? [b - a] : [];
      }));
      return { key, uiToMainMs: duration('uiAt', 'main'), sendToRuntimeMs: duration('uiAt', 'runtime'),
        sendToProviderWriteMs: duration('uiAt', 'providerWrite'), sendToFirstTextMs: duration('uiAt', 'firstText'),
        firstTextToIpcMs: duration('firstText', 'firstTextIpc'),
        coldSessionToFirstTextMs: percentiles(group.flatMap(r => r.sessionCreatedAt !== undefined && r.marks.firstText !== undefined ? [r.marks.firstText - r.sessionCreatedAt] : [])) };
    });
    const count = h?.count ?? 0;
    return { elapsedMs, dropped: this.dropped, rows, groups,
      eventLoopMs: { n: count, p50: count ? h!.percentile(50) / 1e6 : null, p95: count ? h!.percentile(95) / 1e6 : null,
        p99: count ? h!.percentile(99) / 1e6 : null, max: count ? h!.max / 1e6 : null },
      cpuMs: { user: cpu.user / 1000, system: cpu.system / 1000 }, rssBytes: { start: this.rssStart, end: process.memoryUsage().rss },
      ipc: { events: this.ipcEvents, jsonBytes: this.ipcBytes, eventsPerSecond: elapsedMs > 0 ? this.ipcEvents * 1000 / elapsedMs : 0,
        jsonBytesPerSecond: elapsedMs > 0 ? this.ipcBytes * 1000 / elapsedMs : 0 } };
  }

  private current(chatId: string): RuntimeTimingRow | undefined { return this.enabled ? this.active.get(chatId) : undefined; }
  private mark(chatId: string, stage: RuntimeTimingStage): void {
    const row = this.current(chatId);
    if (row && row.marks[stage] === undefined) row.marks[stage] = this.clock();
  }
}

export const runtimePerformance = new RuntimePerformance();
