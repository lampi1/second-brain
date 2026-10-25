// Local, bounded, content-free voice timing observations. No transcripts, session IDs or audio are retained/exported.
import type { VoiceDiagnostics } from '../../shared/voice';
let current: (() => VoiceDiagnostics) | undefined;
export const voiceDiagnostics = (): VoiceDiagnostics | null => current?.() ?? null;
export function registerVoiceDiagnostics(reader: () => VoiceDiagnostics): () => void { current = reader; return () => { if (current === reader) current = undefined; }; }
export class VoiceMeasurements {
  private recognition: number[] = []; private synthesis: number[] = [];
  private ended = new Map<number, number>();
  private counters = { transcripts: 0, missingEndpoints: 0, staleEvents: 0, errors: 0, timeouts: 0, cancellations: 0 };
  constructor(private readonly now: () => number = () => performance.now()) {}
  clear(): void { this.ended.clear(); }
  endpoint(utterance: number): void { if (this.ended.size < 4 && !this.ended.has(utterance)) this.ended.set(utterance, this.now()); }
  heard(utterance: number): void { this.counters.transcripts++; const end = this.ended.get(utterance); this.ended.delete(utterance); if (end === undefined) this.counters.missingEndpoints++; else this.record(this.recognition, this.now() - end); }
  synthesisStarted(): () => void { const start = this.now(); return () => this.record(this.synthesis, this.now() - start); }
  count(name: 'staleEvents' | 'errors' | 'timeouts' | 'cancellations', count = 1): void { this.counters[name] += count; }
  private record(values: number[], ms: number): void { if (Number.isFinite(ms) && ms >= 0 && ms <= 120_000) { values.push(ms); if (values.length > 100) values.shift(); } }
  snapshot(fake = false): VoiceDiagnostics {
    const stats = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return { count: values.length, meanMs: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, p95Ms: sorted.length ? sorted[Math.ceil(sorted.length * .95) - 1]! : null }; };
    return { schema: 1, fake, counters: { ...this.counters }, recognitionAfterEndpoint: stats(this.recognition), synthesisRequestToAudio: stats(this.synthesis), window: 100, coverage: ['Session-only counters; latest 100 successful phase timings.', 'Recognition starts at the host-observed end-of-speech event; synthesis ends when audio reaches the host.', 'Not microphone-to-answer latency, playback latency, word error rate or a quality score.', 'P95 is nearest-rank over the displayed sample count; small samples are not reliable population estimates.'] };
  }
}
