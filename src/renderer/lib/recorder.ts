// Call recording in the renderer (ADR 0154): «Registra call» captures the user's microphone and the PC's audio (Teams,
// Meet, anything playing: getDisplayMedia with Windows' loopback, granted by main only right after the click, the screen
// video it carries stopped at once), mixes them into one stereo stream (left = «Tu», right = «Altri»), downsamples to
// 16 kHz and sends a 16-bit chunk a second to main (rec:chunk), which appends it to the WAV and, at the stop, queues the
// local transcript. Without the PC's audio (refused, or not Windows) the call is the microphone alone. Voice mode is
// turned off while recording: it would answer the call. Imports decode an audio or video file here (WebAudio, at
// 16 kHz mono) and send it the same way. The fake engine (demo, e2e) records two tones instead of real devices.
// Used by components/RecordingsPage.tsx and the REC pill in TopBar.tsx.
import { createStore } from '../store/createStore';
import { toast } from '../store/ui';
import { t } from '../i18n';
import { downsample, stopVoice, voice } from './voice';
import { REC_IMPORT_MAX_BYTES, REC_RATE, recExtensionOk, type RecState } from '@shared/recordings';

export interface RecorderUi {
  phase: 'off' | 'starting' | 'on' | 'stopping';
  id: string | null;
  /** milliseconds of audio sent so far */
  ms: number;
  /** 0..1 loudness of each side, for the meters */
  me: number;
  others: number;
  systemAudio: boolean;
  /** imports running: file name → 0..1 */
  importing: Record<string, number>;
}
export const recorder = createStore<RecorderUi>({ phase: 'off', id: null, ms: 0, me: 0, others: 0, systemAudio: false, importing: {} });
export const recs = createStore<RecState | null>(null);
const set = (p: Partial<RecorderUi>) => recorder.set(s => ({ ...s, ...p }));

let wired = false;
/** main's list, once (on first use of the page or the pill) */
export function startRecs(): void {
  if (wired || typeof window === 'undefined' || !window.sb) return;
  wired = true;
  window.sb.on('rec:changed', s => recs.set(s));
  void window.sb.invoke('rec:state', undefined).then(s => recs.set(x => x ?? s), () => {});
}

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

let ctx: AudioContext | null = null, proc: ScriptProcessorNode | null = null;
let streams: MediaStream[] = [];
let pending: Int16Array[] = [], pendingFrames = 0, chain: Promise<unknown> = Promise.resolve();
let fakeNodes: AudioScheduledSourceNode[] = [];

const toInt16 = (x: number) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
const rms = (a: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]! * a[i]!; return Math.min(1, Math.sqrt(s / Math.max(1, a.length)) * 6); };

function flush(id: string, channels: number): void {
  if (!pendingFrames) return;
  const all = new Int16Array(pendingFrames * channels);
  let at = 0;
  for (const p of pending) { all.set(p, at); at += p.length; }
  pending = []; pendingFrames = 0;
  const pcm = new Uint8Array(all.buffer);
  chain = chain.then(() => window.sb.invoke('rec:chunk', { id, pcm }).then(ms => { if (recorder.get().id === id) set({ ms }); }, e => { if (recorder.get().id === id) { toast(`${t('rec.failed')} ${errText(e)}`, 'err'); void stopCall(); } }));
}

/** The PC's audio, if the system gives it: a stream with its audio track only (the screen video stopped at once). */
async function systemAudio(): Promise<MediaStream | null> {
  try {
    await window.sb.invoke('rec:arm', undefined);
    const got = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    got.getVideoTracks().forEach(tr => tr.stop());
    if (!got.getAudioTracks().length) { got.getTracks().forEach(tr => tr.stop()); return null; }
    return new MediaStream(got.getAudioTracks());
  } catch { return null; }
}

export async function startCall(): Promise<void> {
  if (recorder.get().phase !== 'off') return;
  set({ phase: 'starting', ms: 0, me: 0, others: 0 });
  if (voice.get().phase !== 'off') { stopVoice(); toast(t('rec.voiceOff'), 'info'); }
  const fake = !!voice.get().engine?.fake || !!(await window.sb.invoke('voice:state', undefined).catch(() => null))?.fake;
  try {
    const ac = new AudioContext();
    ctx = ac;
    const merger = ac.createChannelMerger(2);
    let sys = false;
    if (fake) {
      // two quiet tones stand in for the microphone and the call (no devices in the demo or the e2e run)
      for (const [ch, hz] of [[0, 220], [1, 330]] as const) {
        const o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = hz; g.gain.value = 0.05;
        o.connect(g).connect(merger, 0, ch); o.start();
        fakeNodes.push(o);
      }
      sys = true;
    } else {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      if (recorder.get().phase !== 'starting') { mic.getTracks().forEach(tr => tr.stop()); return; }
      streams.push(mic);
      ac.createMediaStreamSource(mic).connect(merger, 0, 0);
      mic.getAudioTracks()[0]?.addEventListener('ended', () => { if (recorder.get().phase === 'on') { toast(t('rec.micLost'), 'err'); void stopCall(); } });
      const pc = await systemAudio();
      if (recorder.get().phase !== 'starting') { pc?.getTracks().forEach(tr => tr.stop()); return; }
      if (pc) { streams.push(pc); ac.createMediaStreamSource(pc).connect(merger, 0, 1); sys = true; }
    }
    const channels = sys ? 2 : 1;
    const r = await window.sb.invoke('rec:start', { source: 'call', channels, systemAudio: sys });
    if (recorder.get().phase !== 'starting') { await window.sb.invoke('rec:remove', { id: r.id }).catch(() => {}); return; }
    proc = ac.createScriptProcessor(4096, 2, 1);
    const ratio = ac.sampleRate / REC_RATE;
    let sinceFlush = 0;
    proc.onaudioprocess = e => {
      if (recorder.get().id !== r.id) return;
      const l = downsample(e.inputBuffer.getChannelData(0), ratio);
      const rr = sys ? downsample(e.inputBuffer.getChannelData(1), ratio) : null;
      const out = new Int16Array(l.length * channels);
      for (let i = 0; i < l.length; i++) { out[i * channels] = toInt16(l[i]!); if (rr) out[i * channels + 1] = toInt16(rr[i] ?? 0); }
      pending.push(out); pendingFrames += l.length; sinceFlush += l.length;
      set({ me: rms(l), others: rr ? rms(rr) : 0 });
      if (sinceFlush >= REC_RATE) { sinceFlush = 0; flush(r.id, channels); }
    };
    merger.connect(proc);
    proc.connect(ac.destination); // silent: the processor only runs when connected
    channelsNow = channels;
    set({ phase: 'on', id: r.id, systemAudio: sys });
    if (!sys) toast(t('rec.micOnly'), 'info');
  } catch (e) {
    teardown();
    set({ phase: 'off', id: null });
    toast(`${t('rec.failed')} ${errText(e)}`, 'err');
  }
}
let channelsNow = 2;

function teardown(): void {
  try { proc?.disconnect(); } catch { /* gone */ }
  for (const n of fakeNodes) { try { n.stop(); } catch { /* stopped */ } }
  fakeNodes = [];
  streams.forEach(s => s.getTracks().forEach(tr => tr.stop()));
  streams = [];
  void ctx?.close().catch(() => {});
  ctx = null; proc = null;
}

export async function stopCall(): Promise<void> {
  const { id, phase } = recorder.get();
  if (phase === 'starting') { set({ phase: 'off' }); teardown(); return; }
  if (!id || phase !== 'on') return;
  set({ phase: 'stopping' });
  if (proc) proc.onaudioprocess = null;
  flush(id, channelsNow);
  teardown();
  await chain.catch(() => {});
  const r = await window.sb.invoke('rec:stop', { id }).catch(e => { toast(`${t('rec.failed')} ${errText(e)}`, 'err'); return null; });
  set({ phase: 'off', id: null, me: 0, others: 0 });
  toast(r ? t('rec.saved') : t('rec.tooShort'), r ? 'ok' : 'info');
}

export const toggleCall = (): Promise<void> => (recorder.get().phase === 'off' ? startCall() : stopCall());

// ── import ──
const CHUNK = REC_RATE * 30;

/** Decodes an audio or video file (its first audio track) at 16 kHz mono and stores it as a recording. */
export async function importAudio(name: string, bytes: ArrayBuffer, fromPath?: string): Promise<void> {
  if (!recExtensionOk(name)) { toast(t('rec.badType'), 'err'); return; }
  if (bytes.byteLength > REC_IMPORT_MAX_BYTES) { toast(t('rec.tooBig'), 'err'); return; }
  const mark = (p: number | null) => recorder.set(s => { const importing = { ...s.importing }; if (p === null) delete importing[name]; else importing[name] = p; return { ...s, importing }; });
  mark(0);
  let id: string | null = null;
  try {
    const off = new OfflineAudioContext(1, 1, REC_RATE);
    const buf = await off.decodeAudioData(bytes);
    const n = buf.length, chs = buf.numberOfChannels;
    const r = await window.sb.invoke('rec:start', { source: 'file', channels: 1, from: name, ...(fromPath ? { fromPath } : {}) });
    id = r.id;
    const data = Array.from({ length: chs }, (_, c) => buf.getChannelData(c));
    for (let at = 0; at < n; at += CHUNK) {
      const len = Math.min(CHUNK, n - at), out = new Int16Array(len);
      for (let i = 0; i < len; i++) { let v = 0; for (const d of data) v += d[at + i]!; out[i] = toInt16(v / chs); }
      await window.sb.invoke('rec:chunk', { id, pcm: new Uint8Array(out.buffer) });
      mark((at + len) / n);
    }
    await window.sb.invoke('rec:stop', { id });
    toast(t('rec.imported', { name }), 'ok');
  } catch (e) {
    if (id) await window.sb.invoke('rec:remove', { id }).catch(() => {});
    toast(`${t('rec.importFailed', { name })} ${errText(e)}`, 'err');
  } finally { mark(null); }
}

export async function importFile(f: File): Promise<void> { await importAudio(f.name, await f.arrayBuffer()); }

/** A file «Trovate sul PC» listed (or the Orchestrator asked for, ui:command recImport): main reads it, we decode it. */
export async function importFound(p: string): Promise<void> {
  const name = p.split(/[\\/]/).pop() ?? p;
  try {
    const list = await window.sb.invoke('rec:find', undefined);
    if (!list.some(f => f.path === p)) { toast(t('rec.notFound', { name }), 'err'); return; }
    const bytes = await window.sb.invoke('rec:readFound', { path: p });
    await importAudio(name, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, p);
  } catch (e) { toast(`${t('rec.importFailed', { name })} ${errText(e)}`, 'err'); }
}
