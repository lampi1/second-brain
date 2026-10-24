// Voice mode in the renderer (ADR 0152, owner 2026-10-24): two states only, muted or on (Ctrl+M or the mic button in
// the Orchestrator's and Flash's input). On: the microphone streams 16 kHz chunks to main (voice:audio; main's voice
// process cuts them into utterances and transcribes them locally), each transcript goes to the chat the mic belongs
// to as a message, and that chat's reply to it is read aloud (shared/voice.ts replyToSpeak; never a turn the app
// started by itself). While a question card registered with useVoiceQuestion is on screen, the app reads it and the
// spoken answer counts as the click (parseSpokenAnswer). The mic is ignored while the app speaks; Esc silences it.
// Used by components/VoiceControls.tsx, ChatInput.tsx, App.tsx (Ctrl+M) and the question cards.
import { useEffect, useRef } from 'react';
import { createStore } from '../store/createStore';
import { app, send } from '../store/store';
import { toast } from '../store/ui';
import { t } from '../i18n';
import { VOICE_RATE, isNoise, parseSpokenAnswer, replyToSpeak, speakable, spokenQuestion, type SpokenAnswer, type SpokenQuestionInput, type VoiceName, type VoiceState } from '@shared/voice';

export type VoiceTarget = 'orchestrator' | 'flash';
export type VoicePhase = 'off' | 'preparing' | 'starting' | 'listening' | 'hearing' | 'transcribing' | 'speaking';
export interface VoiceUi { phase: VoicePhase; target: VoiceTarget; level: number; engine: VoiceState | null; error: string | null; question: string | null }

export const voice = createStore<VoiceUi>({ phase: 'off', target: 'orchestrator', level: 0, engine: null, error: null, question: null });
export const useVoice = voice.use;
const set = (p: Partial<VoiceUi>) => voice.set(s => ({ ...s, ...p }));

let stream: MediaStream | null = null, ctx: AudioContext | null = null, proc: ScriptProcessorNode | null = null;
let out: AudioContext | null = null, playing: AudioBufferSourceNode | null = null;
let session = 0; // each start and stop; an await that comes back to another session gives up
let onSince = 0, quietUntil = 0, startWhenReady = false, transcribeTimer: ReturnType<typeof setTimeout> | null = null;
const spoken = new Set<string>();

/** The chat a target writes to: the open Orchestrator or the open Flash chat. */
export function targetChat(target: VoiceTarget): string | null {
  const chats = Object.values(app.get().chats);
  const c = target === 'flash' ? chats.find(x => x?.quick && !x.closedAt) : chats.find(x => x?.isOrchestrator && !x.closedAt);
  return c?.id ?? null;
}

let wired = false;
/** Main's events, once (main.tsx). */
export function startVoice(): void {
  if (wired || typeof window === 'undefined' || !window.sb) return;
  wired = true;
  window.sb.on('voice:changed', st => {
    const was = voice.get().error;
    set({ engine: st, error: st.error });
    // an engine error while voice is on (Whisper missing, the addon broken): said once, not at every chunk
    if (st.error && st.error !== was && !['off', 'preparing'].includes(voice.get().phase)) toast(st.error, 'err');
    if (st.error && voice.get().phase === 'preparing') { fail(st.error); return; }
    if (startWhenReady && allReady(st)) { startWhenReady = false; void openMic(session); }
  });
  window.sb.on('voice:speech', ({ active }) => {
    const ph = voice.get().phase;
    if (ph === 'off' || ph === 'speaking' || ph === 'preparing') return;
    if (active) set({ phase: 'hearing' });
    else { set({ phase: 'transcribing' }); if (transcribeTimer) clearTimeout(transcribeTimer); transcribeTimer = setTimeout(() => { if (voice.get().phase === 'transcribing') set({ phase: 'listening' }); }, 15_000); }
  });
  window.sb.on('voice:heard', ({ text }) => heard(text));
  app.subscribe(watchReplies);
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && voice.get().phase === 'speaking') { e.preventDefault(); e.stopPropagation(); stopSpeaking(); } }, true);
  void window.sb.invoke('voice:state', undefined).then(st => set({ engine: st }), () => {});
}

const allReady = (st: VoiceState | null) => !!st && st.ready.vad && st.ready.asr && st.ready.tts;

/** Ctrl+M / the mic button: muted ↔ on. `target` = where the words go (the button's input; Ctrl+M keeps the last). */
export async function toggleVoice(target?: VoiceTarget): Promise<void> {
  const s = voice.get();
  if (s.phase !== 'off') { if (target && target !== s.target) { set({ target }); return; } stopVoice(); return; }
  // leaves «off» before the first await: a second click or Ctrl+M meanwhile turns it off instead of opening twice
  const my = ++session;
  set({ target: target ?? s.target, error: null, phase: 'starting' });
  const st = await window.sb.invoke('voice:state', undefined).catch(() => null);
  if (my !== session) return;
  set({ engine: st });
  if (!st) { fail(t('voice.engineDown')); return; }
  if (!allReady(st)) {
    // the first time: the models download (once), then the mic opens by itself
    startWhenReady = true;
    set({ phase: 'preparing' });
    const next = await window.sb.invoke('voice:prepare', undefined).catch(() => st);
    if (my === session) set({ engine: next });
    return;
  }
  await openMic(my);
}

/** Voice could not start or broke: off, the reason in the bar's place (a toast) and in Settings → Voce. */
function fail(error: string): void {
  session++;
  startWhenReady = false;
  closeMic();
  set({ phase: 'off', level: 0, error });
  toast(error, 'err');
}

/** Ctrl+M: on → off; off → on for Flash when the focus is in Flash's tile, else for the Orchestrator. */
export function shortcutVoice(): void {
  if (voice.get().phase !== 'off') { stopVoice(); return; }
  const inFlash = !!(document.activeElement as HTMLElement | null)?.closest?.('[data-testid="tile-lampo"]');
  void toggleVoice(inFlash ? 'flash' : 'orchestrator');
}

async function openMic(my: number): Promise<void> {
  set({ phase: 'starting' });
  const fake = !!voice.get().engine?.fake;
  let got: MediaStream | null = null;
  try {
    got = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    // turned off (or started again) while the permission or the device was pending: this stream is never used
    if (my !== session) { got.getTracks().forEach(tr => tr.stop()); return; }
    stream = got;
    ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    proc = ctx.createScriptProcessor(4096, 1, 1);
    const ratio = ctx.sampleRate / VOICE_RATE;
    proc.onaudioprocess = e => {
      if (my !== session) return;
      const input = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i]! * input[i]!;
      const level = Math.min(1, Math.sqrt(sum / input.length) * 6);
      if (Math.abs(level - voice.get().level) > 0.04) set({ level });
      if (voice.get().phase === 'speaking' || Date.now() < quietUntil) return; // the app's own voice is never transcribed
      void window.sb.invoke('voice:audio', { samples: downsample(input, ratio) }).catch(() => {});
    };
    src.connect(proc);
    proc.connect(ctx.destination); // a ScriptProcessor runs only while connected; its output stays silent
  } catch (e) {
    if (my !== session) { got?.getTracks().forEach(tr => tr.stop()); return; }
    closeMic();
    if (!fake) { fail(t('voice.noMic', { error: e instanceof Error ? e.message : String(e) })); return; }
  }
  if (my !== session) return;
  onSince = Date.now();
  set({ phase: 'listening' });
  await window.sb.invoke('voice:listen', { on: true }).catch(() => {});
  sayQuestion();
}

/** Averages each 16 kHz sample over the input samples it covers (enough for speech; the mic's own filter did the rest). */
export function downsample(input: Float32Array, ratio: number): Float32Array {
  if (ratio <= 1) return input.slice();
  const n = Math.floor(input.length / ratio), outp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio), b = Math.min(input.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let k = a; k < b; k++) s += input[k]!;
    outp[i] = s / Math.max(1, b - a);
  }
  return outp;
}

function closeMic(): void {
  try { proc?.disconnect(); } catch { /* gone */ }
  stream?.getTracks().forEach(tr => tr.stop());
  void ctx?.close().catch(() => {});
  proc = null; stream = null; ctx = null;
}

export function stopVoice(): void {
  session++;
  startWhenReady = false;
  closeMic();
  stopSpeaking();
  if (transcribeTimer) clearTimeout(transcribeTimer);
  set({ phase: 'off', level: 0 });
  hinted = false;
  for (const q of questions) q.said = false; // on again: the open questions are read again
  void window.sb.invoke('voice:listen', { on: false }).catch(() => {});
}

// ── what was heard ──
function heard(raw: string): void {
  const s = voice.get();
  if (s.phase === 'off') return;
  set({ phase: s.phase === 'speaking' ? 'speaking' : 'listening' });
  if (isNoise(raw)) return;
  const q = questions.at(-1);
  if (q) {
    const a = parseSpokenAnswer(raw);
    if (a) { q.onAnswer(a); return; }
  }
  const chatId = targetChat(s.target);
  if (!chatId) { toast(t(s.target === 'flash' ? 'voice.noFlash' : 'voice.noOrchestrator'), 'info'); return; }
  send(chatId, raw.trim());
}

// ── speaking ──
let speakN = 0;
/** raw: already written to be heard (a question): no markdown cleanup, no length cut */
export async function say(text: string, raw = false): Promise<void> {
  const clean = raw ? text.trim() : speakable(text);
  if (!clean) return;
  const n = ++speakN;
  stopSpeaking(false);
  const prev = voice.get().phase;
  set({ phase: 'speaking' });
  const r = await window.sb.invoke('voice:speak', { text: clean }).catch(() => null);
  if (n !== speakN || voice.get().phase === 'off') return;
  if (!r || r.error || !r.samples.length) {
    if (r?.error) { set({ error: r.error }); toast(t('voice.speakFailed', { error: r.error }), 'err'); }
    set({ phase: prev === 'speaking' ? 'listening' : prev });
    return;
  }
  const src = play(r.samples, r.rate);
  playing = src;
  src.onended = () => { if (playing !== src) return; playing = null; quietUntil = Date.now() + 400; if (voice.get().phase === 'speaking') set({ phase: 'listening' }); };
}

function play(samples: Float32Array, rate: number): AudioBufferSourceNode {
  out ??= new AudioContext();
  const buf = out.createBuffer(1, samples.length, rate);
  buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const src = out.createBufferSource();
  src.buffer = buf;
  src.connect(out.destination);
  src.start();
  return src;
}

/** Settings → Voce «Prova»: a short sentence in that voice (downloaded first if missing). Returns an error, or null. */
export async function previewVoice(name: VoiceName): Promise<string | null> {
  const r = await window.sb.invoke('voice:speak', { text: t('voice.sample'), voice: name }).catch((e: unknown) => ({ samples: new Float32Array(0), rate: 0, error: e instanceof Error ? e.message : String(e) }));
  if (r.error || !r.samples.length) return r.error ?? t('voice.engineDown');
  stopSpeaking(false);
  playing = play(r.samples, r.rate);
  return null;
}

export function stopSpeaking(back = true): void {
  speakN++;
  const p = playing;
  playing = null;
  try { p?.stop(); } catch { /* ended */ }
  quietUntil = Date.now() + 300;
  if (back && voice.get().phase === 'speaking') set({ phase: 'listening' });
}

/** A turn of the target chat ended after the user's own message: its reply is read aloud, once. */
function watchReplies(): void {
  const s = voice.get();
  if (s.phase === 'off' || s.phase === 'preparing') return;
  const chatId = targetChat(s.target);
  if (!chatId) return;
  const r = replyToSpeak(app.get().items[chatId], onSince);
  if (!r || spoken.has(r.key)) return;
  spoken.add(r.key);
  if (questions.length) return; // a question is waiting: it goes first, the reply stays in the chat
  void say(r.text);
}

// ── questions read aloud and answered by voice ──
interface VoiceQuestion { id: string; speak: SpokenQuestionInput; onAnswer: (a: SpokenAnswer) => void; said: boolean }
let hinted = false; // «puoi rispondere sì o no…» once per voice session
const questions: VoiceQuestion[] = [];

function sayQuestion(): void {
  const q = questions.at(-1);
  set({ question: q?.id ?? null });
  if (!q || q.said || voice.get().phase === 'off' || voice.get().phase === 'preparing' || voice.get().phase === 'starting') return;
  q.said = true;
  void say(spokenQuestion(q.speak, !hinted), true);
  hinted = true;
}

/** A question card on screen: in voice mode the app reads it as a sentence (shared/voice.ts spokenQuestion) and the
 *  spoken answer calls onAnswer, as the click would. */
export function useVoiceQuestion(id: string | null, speak: SpokenQuestionInput, onAnswer: (a: SpokenAnswer) => void): void {
  const mine = useRef<VoiceQuestion | null>(null);
  useEffect(() => {
    if (!id) return;
    // the same request drawn twice (its chat strip and the questions window) is read once
    const q: VoiceQuestion = { id, speak, onAnswer, said: questions.some(x => x.id === id && x.said) };
    mine.current = q;
    questions.push(q);
    sayQuestion();
    return () => {
      mine.current = null;
      const i = questions.indexOf(q);
      if (i >= 0) questions.splice(i, 1);
      if (voice.get().question === id) sayQuestion(); // the next open question, if any, is read now
    };
    // speak and onAnswer are read when the answer comes: a new closure each render must not re-read the question
  }, [id]);
  useEffect(() => { if (mine.current) mine.current.onAnswer = onAnswer; });
}
