// Voice in the renderer (ADR 0152). Two separate uses (owner, 2026-10-24: «il pulsante microfono già presente deve
// essere quello per sola trascrizione, la modalità voce continua invece dalle impostazioni»):
// - dictation: the mic button in the Orchestrator's and Flash's input (or Ctrl+M) writes what you say into that input,
//   nothing is sent, nothing is read aloud;
// - conversation («talk»): switched on from Settings → Voce; what you say goes to the Orchestrator as a message, its
//   reply is read aloud while it is still being written (sentence by sentence, the next one synthesized while the
//   current one plays), and talking over the app stops it at once (barge-in). Question cards registered with
//   useVoiceQuestion are read and answered by voice (parseSpokenAnswer). The app never speaks on its own initiative.
// The microphone streams 16 kHz chunks to main (voice:audio); main's voice process cuts utterances (Silero) and
// transcribes them locally (Whisper). Used by components/VoiceControls.tsx, ChatInput.tsx, VoiceSettings.tsx, App.tsx
// (Ctrl+M) and the question cards.
import { useEffect, useRef } from 'react';
import { createStore } from '../store/createStore';
import { app, send } from '../store/store';
import { toast } from '../store/ui';
import { t } from '../i18n';
import { micAudio, onMicChange, openMicStream } from './mic';
import { VOICE_RATE, isNoise, parseSpokenAnswer, settledText, speakable, speechChunks, spokenQuestion, turnToSpeak, type SpokenAnswer, type SpokenQuestionInput, type VoiceName, type VoiceState } from '@shared/voice';

export type VoiceTarget = 'orchestrator' | 'flash';
/** dictate = the words go into the input; talk = a spoken conversation with the Orchestrator */
export type VoiceMode = 'dictate' | 'talk';
export type VoicePhase = 'off' | 'preparing' | 'starting' | 'listening' | 'hearing' | 'transcribing' | 'speaking';
export interface VoiceUi { phase: VoicePhase; mode: VoiceMode; target: VoiceTarget; level: number; engine: VoiceState | null; error: string | null; question: string | null }

export const voice = createStore<VoiceUi>({ phase: 'off', mode: 'dictate', target: 'orchestrator', level: 0, engine: null, error: null, question: null });
export const useVoice = voice.use;
const set = (p: Partial<VoiceUi>) => voice.set(s => ({ ...s, ...p }));

let stream: MediaStream | null = null, ctx: AudioContext | null = null, proc: ScriptProcessorNode | null = null;
let session = 0; // each start and stop; an await that comes back to another session gives up
let onSince = 0, startWhenReady = false, transcribeTimer: ReturnType<typeof setTimeout> | null = null;

/** The chat a target writes to: the open Orchestrator or the open Flash chat. */
export function targetChat(target: VoiceTarget): string | null {
  const chats = Object.values(app.get().chats);
  const c = target === 'flash' ? chats.find(x => x?.quick && !x.closedAt) : chats.find(x => x?.isOrchestrator && !x.closedAt);
  return c?.id ?? null;
}

/** Where dictated words go (ChatInput.tsx registers its draft). */
const dictated = new Set<(chatId: string, text: string) => void>();
export const onDictated = (fn: (chatId: string, text: string) => void): (() => void) => { dictated.add(fn); return () => dictated.delete(fn); };

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
    if (startWhenReady && allReady(st, voice.get().mode)) { startWhenReady = false; void openMic(session); }
  });
  window.sb.on('voice:speech', ({ active }) => speech(active));
  window.sb.on('voice:heard', ({ text }) => heard(text));
  app.subscribe(watchReplies);
  // another microphone (chosen in Settings → Voce, plugged in, unplugged) while voice is on: reopened on it at once
  onMicChange(() => { if (stream && voice.get().phase !== 'off') { closeMic(); void openMic(session, true); } });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && voice.get().phase === 'speaking') { e.preventDefault(); e.stopPropagation(); stopSpeaking(); } }, true);
  void window.sb.invoke('voice:state', undefined).then(st => set({ engine: st }), () => {});
}

/** dictation needs only the VAD and Whisper; a conversation also the voice */
const allReady = (st: VoiceState | null, mode: VoiceMode) => !!st && st.ready.vad && st.ready.asr && (mode === 'dictate' || st.ready.tts);

/** something that keeps voice off for now (a call being recorded, lib/recorder.ts): its reason, or null */
let blocked: () => string | null = () => null;
export const blockVoiceWhile = (why: () => string | null): void => { blocked = why; };

/** The mic button / Ctrl+M: dictation into `target`'s input, on ↔ off. Anything on (a conversation too) goes off. */
export async function toggleVoice(target?: VoiceTarget): Promise<void> {
  const s = voice.get();
  if (s.phase !== 'off') {
    if (s.mode === 'dictate' && target && target !== s.target) { set({ target }); return; }
    stopVoice();
    if (s.mode === 'dictate' || !target) return; // the mic button during a conversation: from talking to dictating
  }
  await startListening('dictate', target ?? s.target);
}

/** Settings → Voce «Conversazione a voce»: the spoken conversation with the Orchestrator, on or off. */
export async function setTalk(on: boolean): Promise<void> {
  const s = voice.get();
  if (!on) { if (s.mode === 'talk' && s.phase !== 'off') stopVoice(); return; }
  if (s.phase !== 'off') { if (s.mode === 'talk') return; stopVoice(); }
  await startListening('talk', 'orchestrator');
}

async function startListening(mode: VoiceMode, target: VoiceTarget): Promise<void> {
  const no = blocked();
  if (no) { toast(no, 'info'); return; }
  // leaves «off» before the first await: a second click or Ctrl+M meanwhile turns it off instead of opening twice
  const my = ++session;
  set({ mode, target, error: null, phase: 'starting' });
  const st = await window.sb.invoke('voice:state', undefined).catch(() => null);
  if (my !== session) return;
  set({ engine: st });
  if (!st) { fail(t('voice.engineDown')); return; }
  if (!allReady(st, mode)) {
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
  stopSpeaking(false);
  set({ phase: 'off', level: 0, error });
  toast(error, 'err');
}

/** Ctrl+M: on → off; off → dictation into Flash when the focus is in Flash's tile, else into the Orchestrator. */
export function shortcutVoice(): void {
  if (voice.get().phase !== 'off') { stopVoice(); return; }
  const inFlash = !!(document.activeElement as HTMLElement | null)?.closest?.('[data-testid="tile-lampo"]');
  void toggleVoice(inFlash ? 'flash' : 'orchestrator');
}

// ── the microphone ──
/** the loudest level of the last ~300 ms: talking over the app must be louder than its echo (barge-in) */
const recent: { at: number; level: number }[] = [];
const loudLately = (now = Date.now()) => recent.filter(r => now - r.at <= 300).reduce((m, r) => Math.max(m, r.level), 0);

/** reopen: another microphone while voice is on; the phase (speaking, hearing…) stays as it is */
async function openMic(my: number, reopen = false): Promise<void> {
  if (!reopen) set({ phase: 'starting' });
  const fake = !!voice.get().engine?.fake;
  let got: MediaStream | null = null;
  try {
    const want = JSON.stringify(micAudio().deviceId ?? null);
    got = await openMicStream();
    // another microphone was chosen or plugged in while this one was opening: open that one instead
    if (my === session && JSON.stringify(micAudio().deviceId ?? null) !== want) { got.getTracks().forEach(tr => tr.stop()); got = null; await openMic(my, reopen); return; }
    // turned off (or started again) while the permission or the device was pending: this stream is never used
    if (my !== session) { got.getTracks().forEach(tr => tr.stop()); return; }
    stream = got;
    ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    proc = ctx.createScriptProcessor(2048, 1, 1);
    const ratio = ctx.sampleRate / VOICE_RATE;
    proc.onaudioprocess = e => {
      if (my !== session) return;
      const input = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i]! * input[i]!;
      const level = Math.min(1, Math.sqrt(sum / input.length) * 6);
      const now = Date.now();
      recent.push({ at: now, level });
      while (recent.length && now - recent[0]!.at > 400) recent.shift();
      if (Math.abs(level - voice.get().level) > 0.04) set({ level });
      // the mic keeps listening while the app speaks (echo cancellation on, see mic.ts micAudio): that is what lets the
      // user interrupt it; the echo that gets through is filtered by speech() below
      void window.sb.invoke('voice:audio', { samples: downsample(input, ratio) }).catch(() => {});
    };
    src.connect(proc);
    proc.connect(ctx.destination); // a ScriptProcessor runs only while connected; its output stays silent
  } catch (e) {
    if (my !== session) { got?.getTracks().forEach(tr => tr.stop()); return; }
    closeMic();
    if (!fake) { fail(t('voice.noMic', { error: e instanceof Error ? e.message : String(e) })); return; }
  }
  if (my !== session || reopen) return;
  onSince = Date.now();
  set({ phase: 'listening' });
  await window.sb.invoke('voice:listen', { on: true, talk: voice.get().mode === 'talk' }).catch(() => {});
  if (voice.get().mode === 'talk') sayQuestion();
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
  stopSpeaking(false);
  if (transcribeTimer) clearTimeout(transcribeTimer);
  if (holdTimer) clearTimeout(holdTimer);
  held = '';
  set({ phase: 'off', level: 0 });
  hinted = false;
  saidIds.clear(); // on again: the open questions are read again
  for (const q of questions) q.said = false;
  void window.sb.invoke('voice:listen', { on: false }).catch(() => {});
}

// ── what was heard ──
/** loud enough to be the user, not the app's own voice coming back (the VAD already wants 250 ms of speech: like
 *  the voice agents that yield only to sustained speech) */
export const BARGE_LEVEL = 0.18;

/** an utterance the VAD opened on the app's own voice: dropped when its transcript comes */
let echo = false;
function speech(active: boolean): void {
  const s = voice.get();
  if (s.phase === 'off' || s.phase === 'preparing' || s.phase === 'starting') return;
  if (active) {
    echo = false;
    if (speakingNow() || Date.now() < quietUntil) {
      // the app hearing itself (the fake engine has no microphone: what it «hears» is always the user)
      if (loudLately() < BARGE_LEVEL && !s.engine?.fake) { echo = true; return; }
      stopSpeaking(); // barge-in: the user talks over the app, it stops at once
    }
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } // still the same thought: what was heard waits for the rest
    set({ phase: 'hearing' });
    return;
  }
  if (s.phase !== 'hearing') return;
  set({ phase: 'transcribing' });
  if (transcribeTimer) clearTimeout(transcribeTimer);
  transcribeTimer = setTimeout(() => { if (voice.get().phase === 'transcribing') set({ phase: 'listening' }); }, 15_000);
}

/** A conversation sends a thought, not each pause: what was heard waits HOLD_MS for more speech before it goes (the
 *  VAD closes an utterance after 0.5 s of silence; a pause to think must not cut the message in two). */
const HOLD_MS = 700;
let turn: { key: string; said: string; cut: boolean } | null = null;
let held = '', holdTimer: ReturnType<typeof setTimeout> | null = null;

function heard(raw: string): void {
  const s = voice.get();
  if (s.phase === 'off') return;
  if (s.phase !== 'speaking' && s.phase !== 'hearing') set({ phase: 'listening' });
  if (echo) { echo = false; return; }
  if (isNoise(raw)) return;
  const text = raw.trim();
  const chatId = targetChat(s.target);
  if (!chatId) { toast(t(s.target === 'flash' ? 'voice.noFlash' : 'voice.noOrchestrator'), 'info'); return; }
  if (s.mode === 'dictate') { for (const fn of dictated) fn(chatId, text); return; }
  const q = questions.at(-1);
  if (q && !held) {
    const a = parseSpokenAnswer(text);
    if (a) { q.onAnswer(a); return; }
  }
  held = held ? `${held} ${text}` : text;
  if (holdTimer) clearTimeout(holdTimer);
  const my = session;
  holdTimer = setTimeout(() => {
    holdTimer = null;
    if (my !== session || !held) return;
    if (voice.get().phase === 'hearing') return; // more is coming: sent with the next piece
    const all = held;
    held = '';
    send(chatId, all);
  }, HOLD_MS);
}

// ── speaking ──
/** The sentences of the reply being read: synthesized one ahead of the one playing, played back to back. */
interface Line { text: string; audio: Promise<{ samples: Float32Array; rate: number; error?: string } | null> | null }
let lines: Line[] = [];
let speakN = 0; // each stop; a synthesis or a play that comes back to another one gives up
let out: AudioContext | null = null, playing: AudioBufferSourceNode | null = null, pumping = false;
/** the echo of the last words can reach the mic just after the voice stops */
let quietUntil = 0;
const speakingNow = () => !!playing || lines.length > 0 || pumping;

function synth(text: string, voiceName?: VoiceName): NonNullable<Line['audio']> {
  return window.sb.invoke('voice:speak', { text, ...(voiceName ? { voice: voiceName } : {}) }).catch(() => null);
}

/** Queues text to be said; raw: already written to be heard (a question): no markdown cleanup, no length cut. */
export function say(text: string, raw = false): void {
  const clean = raw ? text.trim() : speakable(text);
  for (const c of speechChunks(clean)) queueLine(c);
}

function queueLine(text: string): void {
  // synthesis starts now for the first two lines; the others when their turn is near (pump), so a stop wastes little
  lines.push({ text, audio: lines.length < 2 ? synth(text) : null });
  void pump();
}

async function pump(): Promise<void> {
  if (pumping || playing) return;
  const n = speakN;
  const line = lines[0];
  if (!line) { if (voice.get().phase === 'speaking') set({ phase: 'listening' }); return; }
  pumping = true;
  if (voice.get().phase !== 'off') set({ phase: 'speaking' });
  line.audio ??= synth(line.text);
  if (lines[1] && !lines[1].audio) lines[1].audio = synth(lines[1].text); // the next one while this one plays
  const r = await line.audio;
  pumping = false;
  if (n !== speakN || voice.get().phase === 'off') return;
  lines.shift();
  if (!r || r.error || !r.samples.length) {
    if (r?.error) { set({ error: r.error }); toast(t('voice.speakFailed', { error: r.error }), 'err'); lines = []; }
    void pump();
    return;
  }
  const src = play(r.samples, r.rate);
  playing = src;
  src.onended = () => { if (playing !== src) return; playing = null; quietUntil = Date.now() + 400; void pump(); };
}

function play(samples: Float32Array, rate: number): AudioBufferSourceNode {
  out ??= new AudioContext();
  void out.resume().catch(() => {}); // never left suspended (a context made before any click starts suspended)
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
  const r = await synth(t('voice.sample'), name);
  if (!r || r.error || !r.samples.length) return r?.error ?? t('voice.engineDown');
  stopSpeaking(false);
  playing = play(r.samples, r.rate);
  playing.onended = () => { playing = null; };
  return null;
}

/** Esc, «zitto», or the user talking over it: the voice stops and what was still to be said is dropped. */
export function stopSpeaking(back = true): void {
  speakN++;
  lines = [];
  pumping = false;
  const p = playing;
  playing = null;
  try { p?.stop(); } catch { /* ended */ }
  if (p) quietUntil = Date.now() + 400;
  if (turn) turn.cut = true; // the rest of that reply stays in the chat
  if (back && voice.get().phase === 'speaking') set({ phase: 'listening' });
}

/** The reply to the user's own spoken message, read while it streams: each settled sentence once. */
const MAX_SAID = 700;
function watchReplies(): void {
  const s = voice.get();
  if (s.mode !== 'talk' || s.phase === 'off' || s.phase === 'preparing') return;
  const chatId = targetChat(s.target);
  if (!chatId) return;
  const r = turnToSpeak(app.get().items[chatId], onSince);
  if (!r) return;
  if (turn?.key !== r.key) turn = { key: r.key, said: '', cut: false };
  if (turn.cut || questions.length) return; // a question is waiting: it goes first, the reply stays in the chat
  const now = speakable(settledText(r.text, r.done), Number.MAX_SAFE_INTEGER);
  if (!now.startsWith(turn.said)) { turn.said = now; return; } // the text above changed (an edit): never said twice
  let fresh = now.slice(turn.said.length).trim();
  if (!fresh) return;
  if (turn.said.length + fresh.length > MAX_SAID) {
    // a long reply: up to the last whole sentence that fits, then «il resto è in chat»
    turn.cut = true;
    fresh = speakable(fresh, Math.max(60, MAX_SAID - turn.said.length)); // ends with «Il resto è in chat.»
  }
  turn.said = now;
  for (const c of speechChunks(fresh)) queueLine(c);
}

// ── questions read aloud and answered by voice ──
interface VoiceQuestion { id: string; speak: SpokenQuestionInput; onAnswer: (a: SpokenAnswer) => void; said: boolean }
let hinted = false; // «puoi rispondere sì o no…» once per voice session
const questions: VoiceQuestion[] = [];

/** the questions read since voice went on, by id: the same request drawn twice is read once, whichever copy closes */
const saidIds = new Set<string>();
function sayQuestion(): void {
  const q = questions.at(-1);
  set({ question: q?.id ?? null });
  if (q && saidIds.has(q.id)) q.said = true;
  if (!q || q.said || voice.get().mode !== 'talk' || ['off', 'preparing', 'starting'].includes(voice.get().phase)) return;
  q.said = true;
  saidIds.add(q.id);
  stopSpeaking(false);
  say(spokenQuestion(q.speak, !hinted), true);
  hinted = true;
}

/** A question card on screen: in a conversation the app reads it as a sentence (shared/voice.ts spokenQuestion) and
 *  the spoken answer calls onAnswer, as the click would. */
export function useVoiceQuestion(id: string | null, speak: SpokenQuestionInput, onAnswer: (a: SpokenAnswer) => void): void {
  const mine = useRef<VoiceQuestion | null>(null);
  useEffect(() => {
    if (!id) return;
    // the same request drawn twice (its chat strip and the questions window) is read once
    const q: VoiceQuestion = { id, speak, onAnswer, said: saidIds.has(id) };
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
