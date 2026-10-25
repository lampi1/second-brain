// Voice observations use real phase boundaries, bounded samples and explicit missing data, never transcript content.
import { describe, expect, it } from 'vitest';
import { registerVoiceDiagnostics, VoiceMeasurements, voiceDiagnostics } from '../../src/main/voice/diagnostics';
describe('content-free voice diagnostics', () => {
  it('keeps empty timing values unknown and measures only observed boundaries', () => {
    let now = 0; const m = new VoiceMeasurements(() => now);
    expect(m.snapshot().recognitionAfterEndpoint).toEqual({ count: 0, meanMs: null, p95Ms: null });
    m.heard(1); expect(m.snapshot().counters.missingEndpoints).toBe(1); expect(m.snapshot().recognitionAfterEndpoint.count).toBe(0);
    m.endpoint(2); now = 400; m.heard(2); expect(m.snapshot().recognitionAfterEndpoint.meanMs).toBe(400);
    const finish = m.synthesisStarted(); now = 460; finish(); expect(m.snapshot().synthesisRequestToAudio.meanMs).toBe(60);
  });
  it('clears old session endpoints and bounds rolling samples', () => {
    let now = 0; const m = new VoiceMeasurements(() => now);
    m.endpoint(1); m.clear(); now = 999; m.heard(1); expect(m.snapshot().recognitionAfterEndpoint.count).toBe(0);
    for (let i = 1; i <= 110; i++) { m.endpoint(i); now += i; m.heard(i); }
    const snapshot = m.snapshot(); expect(snapshot.recognitionAfterEndpoint.count).toBe(100); expect(snapshot.recognitionAfterEndpoint.p95Ms).toBe(105);
    expect(snapshot.counters.transcripts).toBe(111); expect(JSON.stringify(snapshot)).not.toContain('sessionId');
  });
  it('counts failure categories without timing cancelled work or clearing a newer reader', () => {
    const old = new VoiceMeasurements(), current = new VoiceMeasurements(); old.synthesisStarted(); old.count('cancellations');
    expect(old.snapshot().synthesisRequestToAudio.count).toBe(0);
    const releaseOld = registerVoiceDiagnostics(() => old.snapshot()), releaseCurrent = registerVoiceDiagnostics(() => current.snapshot(true));
    releaseOld(); expect(voiceDiagnostics()?.fake).toBe(true); releaseCurrent(); expect(voiceDiagnostics()).toBeNull();
  });
});
