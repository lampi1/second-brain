// Voice in the renderer (ADR 0152). Two separate uses (owner, 2026-10-24: «il pulsante microfono già presente deve
// essere quello per sola trascrizione, la modalità voce continua invece dalle impostazioni»):
// - dictation: the mic button in the Orchestrator's and Flash's input (or Ctrl+M) writes what you say into that input,
//   nothing is sent, nothing is read aloud;
// - conversation («talk»): switched on from Settings → Voce; what you say goes to the Orchestrator as a message, its
//   reply is read aloud while it is still being written (sentence by sentence, the next one synthesized while the
//   current one plays), and talking over the app stops it at once (barge-in). Question cards registered with
//   useVoiceQuestion are read and answered by voice (parseSpokenAnswer). The app never speaks on its own initiative.
// The microphone streams 16 kHz chunks to main (voice:audio); main's voice process cuts utterances (Silero) and
// transcribes them locally (Whisper). Impara (ADR 0185) uses both halves on its own: narrate() reads a lesson's piece
// aloud with the microphone off too, and its «Rispondo a voce» is dictation into the lesson (target 'impara': the words
// go to onImparaHeard, never to a chat). Used by components/VoiceControls.tsx, ChatInput.tsx, VoiceSettings.tsx, App.tsx
// (Ctrl+M), the question cards and components/impara/.
// Push to talk (Settings → Voce «Premi per parlare», owner 2026-10-29): in the conversation the microphone counts only
// while Ctrl+Space (like Teams' press to unmute) or the bar's button is held. Pressing interrupts the voice and opens the
// turn, releasing closes it at once and sends it (LiveKit's manual turns: start_turn / end_turn / cancel_turn); Esc while
// holding drops it.
import { useEffect, useRef } from 'react';
import { VoiceTurns, type VoiceTurnTarget } from './voice-turns';
import { createStore } from '../store/createStore';
import { app, send } from '../store/store';
import { toast } from '../store/ui';
import { t } from '../i18n';
import { micAudio, onMicChange, openMicStream } from './mic';
import { VOICE_RATE, forEar, isNoise, parseSpokenAnswer, settledText, speakable, speechChunks, spokenQuestion, turnToSpeak, type SpokenAnswer, type SpokenQuestionInput, type VoiceName, type VoiceState, type VoiceHeard, type VoiceSpeech } from '@shared/voice';

export type VoiceTarget = 'orchestrator' | 'flash' | 'impara';
/** Impara's dictation target: not a chat, its words go to onImparaHeard */
export const IMPARA_TARGET = 'impara';
/** dictate = the words go into the input; talk = a spoken conversation with the Orchestrator */
export type VoiceMode = 'dictate' | 'talk';
export type VoicePhase = 'off' | 'preparing' | 'starting' | 'listening' | 'hearing' | 'transcribing' | 'speaking';
export interface VoiceUi { phase: VoicePhase; mode: VoiceMode; target: VoiceTarget; level: number; engine: VoiceState | null; error: string | null; question: string | null;
  /** narrate() is reading something aloud (Impara), whatever the microphone does */
  narrating: boolean;
  /** push to talk: on for this conversation, and the key or button held now */
  ptt?: boolean; holding?: boolean }

export const voice = createStore<VoiceUi>({ phase: 'off', mode: 'dictate', target: 'orchestrator', level: 0, engine: null, error: null, question: null, narrating: false });
export const useVoice = voice.use;
const set = (p: Partial<VoiceUi>) => voice.set(s => ({ ...s, ...p }));

let stream: MediaStream | null = null, ctx: AudioContext | null = null, proc: ScriptProcessorNode | null = null;
let captureSession: string | null = null;
let session = 0; // each start and stop; an await that comes back to another session gives up
let onSince = 0, startWhenReady = false, transcribeTimer: ReturnType<typeof setTimeout> | null = null;
/** push to talk: on in Settings (read when the conversation starts), the key or button held now, a release being closed */
let ptt = false, pttHeld = false, pttClosing = false, pttDrop = false, spaceHeld = false;
/** the release delay running (pttRelease) and whether Esc came with it */
let releasing: ReturnType<typeof setTimeout> | null = null, releaseDrop = false;
const pttOn = () => ptt && voice.get().mode === 'talk' && voice.get().phase !== 'off';

/** The chat a target writes to: the open Orchestrator or the open Flash chat. */
export function targetChat(target: VoiceTarget): string | null {
  if (target === 'impara') return IMPARA_TARGET;
  const chats = Object.values(app.get().chats);
  const c = target === 'flash' ? chats.find(x => x?.quick && !x.closedAt) : chats.find(x => x?.isOrchestrator && !x.closedAt);
  return c?.id ?? null;
}

/** Where dictated words go (ChatInput.tsx registers its draft). */
const dictated = new Set<(chatId: string, text: string) => void>();
export const onDictated = (fn: (chatId: string, text: string) => void): (() => void) => { dictated.add(fn); return () => dictated.delete(fn); };
/** Where Impara's spoken words go (components/impara/: a command, a choice, a question, «Spiegalo tu»). */
let imparaHeard: ((text: string) => void) | null = null;
export const onImparaHeard = (fn: ((text: string) => void) | null): void => { imparaHeard = fn; };

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
    if (st.error && voice.get().phase !== 'off') { fail(st.error); return; }
    if (startWhenReady && allReady(st, voice.get().mode)) { startWhenReady = false; void openMic(session); }
  });
  window.sb.on('voice:speech', event => { if (event.session === captureSession) speech(event); });
  window.sb.on('voice:heard', event => { if (event.session === captureSession) heard(event); });
  window.sb.on('voice:committed', event => { if (event.session === captureSession) committed(); });
  app.subscribe(watchReplies);
  // «Premi per parlare» switched while the conversation is on: it applies at once
  app.subscribe(() => {
    const s = voice.get(), want = s.mode === 'talk' && app.get().settings?.voicePtt === true;
    if (s.phase === 'off' || want === ptt) return;
    if (releasing) { clearTimeout(releasing); releasing = null; }
    ptt = want; pttHeld = false; pttDrop = false;
    set({ ptt, holding: false });
    // the turn in progress (held, releasing, or a hands-free one being spoken) is closed and sent as it is
    pttClosing = true;
    void window.sb.invoke('voice:commit', { session: captureSession ?? '' }).catch(() => { pttClosing = false; });
  });
  // another microphone (chosen in Settings → Voce, plugged in, unplugged) while voice is on: reopened on it at once
  onMicChange(() => {
    if (!stream || voice.get().phase === 'off') return;
    const { mode, target } = voice.get();
    stopVoice(true); void startListening(mode, target);
  });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && pttHeld) { e.preventDefault(); e.stopPropagation(); pttRelease(true); return; }
    if (e.key === 'Escape' && voice.get().phase === 'speaking') { e.preventDefault(); e.stopPropagation(); stopSpeaking(); return; }
    // Ctrl+Space held: push to talk (only when it is on: otherwise the key does nothing here)
    if (e.code === 'Space' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && pttOn()) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) { spaceHeld = true; pttPress(); } return; }
    // Ctrl let go before Space: the Space still held types nothing and toggles nothing until it is let go
    if (e.code === 'Space' && spaceHeld) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  window.addEventListener('keyup', e => {
    if (e.code === 'Space') spaceHeld = false;
    if (pttHeld && (e.code === 'Space' || e.key === 'Control' || e.key === 'Meta')) { e.preventDefault(); pttRelease(); }
  }, true);
  window.addEventListener('blur', () => { spaceHeld = false; if (pttHeld) pttRelease(); }); // the key's release would never come
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
    if (s.mode === 'dictate' && target && target !== s.target) { stopVoice(true); await startListening('dictate', target); return; }
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
  if (!targetChat(target)) { toast(t(target === 'flash' ? 'voice.noFlash' : 'voice.noOrchestrator'), 'info'); return; }
  const no = blocked();
  if (no) { toast(no, 'info'); return; }
  // leaves «off» before the first await: a second click or Ctrl+M meanwhile turns it off instead of opening twice
  const my = ++session;
  ptt = mode === 'talk' && app.get().settings?.voicePtt === true;
  pttHeld = false; pttClosing = false; pttDrop = false;
  set({ mode, target, error: null, phase: 'starting', ptt, holding: false });
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
  dropHeld();
  endCapture();
  closeMic();
  stopSpeaking(false);
  set({ phase: 'off', level: 0, error });
  toast(error, 'err');
}

/** Ctrl+Shift+Space: the voice conversation on ↔ off (dictation on: it becomes the conversation). */
export function shortcutTalk(): void {
  const s = voice.get();
  void setTalk(!(s.mode === 'talk' && s.phase !== 'off'));
}

/** Ctrl+M: on → off; off → dictation into Flash when the focus is in Flash's tile, into the lesson on screen, else into the Orchestrator. */
export function shortcutVoice(): void {
  if (voice.get().phase !== 'off') { stopVoice(); return; }
  const inFlash = !!(document.activeElement as HTMLElement | null)?.closest?.('[data-testid="tile-lampo"]');
  // a lesson's board on screen (Impara) and the focus not in the Orchestrator beside it: its «Rispondo a voce»
  const inOrch = !!(document.activeElement as HTMLElement | null)?.closest?.('[data-orchestrator-overlay]');
  const inLesson = !inFlash && !inOrch && !!document.querySelector('[data-testid="impara-player"][data-at]');
  void toggleVoice(inFlash ? 'flash' : inLesson ? 'impara' : 'orchestrator');
}

// ── the microphone ──
/** the loudest level of the last ~300 ms: talking over the app must be louder than its echo (barge-in) */
const recent: { at: number; level: number }[] = [];
const loudLately = (now = Date.now()) => recent.filter(r => now - r.at <= 300).reduce((m, r) => Math.max(m, r.level), 0);

/** reopen: another microphone while voice is on; the phase (speaking, hearing…) stays as it is */
async function openMic(my: number, reopen = false): Promise<void> {
  if (!reopen) set({ phase: 'starting' });
  const capture = crypto.randomUUID();
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
      if (my !== session || captureSession !== capture) return;
      const input = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i]! * input[i]!;
      const level = Math.min(1, Math.sqrt(sum / input.length) * 6);
      const now = Date.now();
      recent.push({ at: now, level });
      while (recent.length && now - recent[0]!.at > 400) recent.shift();
      if (Math.abs(level - voice.get().level) > 0.04) set({ level });
      if (ptt && !pttHeld) return; // push to talk: nothing counts until the key is held
      // the mic keeps listening while the app speaks (echo cancellation on, see mic.ts micAudio): that is what lets the
      // user interrupt it; the echo that gets through is filtered by speech() below
      void window.sb.invoke('voice:audio', { session: capture, samples: downsample(input, ratio) }).catch(() => {});
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
  captureSession = capture;
  recent.length = 0;
  set({ phase: 'listening' });
  try { await window.sb.invoke('voice:listen', { on: true, session: capture, talk: voice.get().mode === 'talk' }); }
  catch { if (my === session) fail(t('voice.engineDown')); return; }
  if (my === session && voice.get().mode === 'talk') sayQuestion();
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

function endCapture(): void {
  const prior = captureSession; captureSession = null;
  if (prior) void window.sb.invoke('voice:listen', { on: false, session: prior }).catch(() => {});
}

export function stopVoice(preserve = false): void {
  session++;
  endCapture();
  startWhenReady = false;
  closeMic();
  stopSpeaking(false);
  if (transcribeTimer) clearTimeout(transcribeTimer);
  pttHeld = false; pttClosing = false; pttDrop = false;
  if (releasing) { clearTimeout(releasing); releasing = null; }
  set({ phase: 'off', level: 0, holding: false });
  thoughts.reset(preserve);
  hinted = false;
  deliveredIds.clear();
  saidIds.clear(); // on again: the open questions are read again
  for (const q of questions) q.said = false;
}

// ── push to talk ──
/** Ctrl+Space down / the bar's button pressed: the voice stops, the turn opens (LiveKit's start_turn). */
export function pttPress(): void {
  if (releasing) { clearTimeout(releasing); releasing = null; releaseDrop = false; if (pttHeld) { set({ holding: true }); return; } } // pressed again within the release delay: the same turn goes on
  if (!pttOn() || pttHeld) return;
  if (speakingNow()) stopSpeaking();
  // the previous release still waiting for its end: it is settled now (sent, or dropped after Esc); its words still
  // being transcribed go with it, the new press's words make a new turn
  if (pttClosing) { if (pttDrop) thoughts.drop(); else thoughts.flush(); }
  pttHeld = true; pttClosing = false; pttDrop = false;
  set({ holding: true, phase: voice.get().phase === 'speaking' ? 'listening' : voice.get().phase });
}

/** Released: what was said is closed now and sent as soon as it is heard (end_turn); drop = Esc while holding
 *  (cancel_turn: nothing is sent). */
export function pttRelease(drop = false): void {
  if (!pttHeld) return;
  if (releasing) { releaseDrop ||= drop; return; } // Esc right after letting go still cancels
  releaseDrop = drop;
  set({ holding: false });
  const capture = captureSession, my = session;
  // the last syllable is still in the audio pipeline (one ScriptProcessor block is ~43 ms): it gets a moment, like a
  // push-to-talk release delay (Discord's default is 20 ms; ours covers the block)
  releasing = setTimeout(() => {
    releasing = null;
    if (my !== session || !capture || capture !== captureSession) return;
    pttHeld = false; pttClosing = true; pttDrop = releaseDrop;
    void window.sb.invoke('voice:commit', { session: capture }).catch(() => { pttClosing = false; });
  }, 120);
}

function committed(): void {
  if (!pttClosing) return;
  pttClosing = false;
  if (pttDrop) { pttDrop = false; thoughts.drop(); } else thoughts.flush();
  if (['hearing', 'transcribing'].includes(voice.get().phase)) set({ phase: speakingNow() ? 'speaking' : 'listening' });
}

// ── what was heard ──
/** loud enough to be the user, not the app's own voice coming back (the VAD already wants 250 ms of speech: like
 *  the voice agents that yield only to sustained speech) */
export const BARGE_LEVEL = 0.18;

/** Route once, when the utterance starts. A late transcript cannot answer a newly displayed question. */
const questionVersion = (q: VoiceQuestion): string => JSON.stringify(q.speak);
function targetNow(): VoiceTurnTarget | null {
  const s = voice.get(), chatId = targetChat(s.target), q = s.mode === 'talk' ? questions.at(-1) : undefined;
  return chatId ? { chatId, mode: s.mode, questionId: q?.id ?? null,
    questionVersion: q ? questionVersion(q) : null, answerable: !q || deliveredIds.get(q.id) === questionVersion(q) } : null;
}
function preserveDraft(target: VoiceTurnTarget, text: string): void {
  if (target.chatId === IMPARA_TARGET) { imparaHeard?.(text); return; }
  const q = questions.at(-1);
  const now = targetNow();
  const same = !!q && now?.chatId === target.chatId && now.mode === target.mode && q.id === target.questionId && questionVersion(q) === target.questionVersion;
  if (same && voice.get().phase !== 'off' && parseSpokenAnswer(text)?.kind === 'text') { q.onAnswer({ kind: 'text', text }); return; }
  for (const fn of dictated) fn(target.chatId, text);
  if (target.mode === 'talk') {
    toast(t('voice.contextChanged'), 'info');
    // An interrupted prompt must not leave its question permanently unanswerable.
    if (same && voice.get().phase !== 'off' && deliveredIds.get(q.id) !== questionVersion(q)) replayQuestion();
  }
}
const thoughts = new VoiceTurns({
  manual: () => ptt,
  current: target => {
    const now = targetNow();
    return !!now && now.chatId === target.chatId && now.mode === target.mode && now.questionId === target.questionId && now.questionVersion === target.questionVersion;
  },
  draft: preserveDraft,
  deliver: (target, text) => {
    if (target.questionId) {
      const q = questions.at(-1), answer = parseSpokenAnswer(text);
      if (q?.id === target.questionId && questionVersion(q) === target.questionVersion && answer) q.onAnswer(answer);
      else preserveDraft(target, text);
    } else send(target.chatId, text, [], { voice: true });
  },
});
let turn: { key: string; said: string; cut: boolean } | null = null;
function dropHeld(): void { thoughts.reset(); }
function speech({ active, utterance }: VoiceSpeech): void {
  const s = voice.get();
  if (['off', 'preparing', 'starting'].includes(s.phase)) return;
  if (active) {
    const target = targetNow();
    if (!target) { toast(t(s.target === 'flash' ? 'voice.noFlash' : 'voice.noOrchestrator'), 'info'); stopVoice(true); return; }
    if (ptt && !pttHeld && !pttClosing) return; // push to talk: what the engine heard outside a press does not count
    // a press is the user's own turn: never the app's echo
    const echo = !ptt && (speakingNow() || Date.now() < quietUntil) && loudLately() < BARGE_LEVEL && !s.engine?.fake;
    if (!thoughts.start(utterance, target, echo) || echo) return;
    if (speakingNow()) stopSpeaking();
    set({ phase: 'hearing' });
    return;
  }
  if (s.phase !== 'hearing') return;
  set({ phase: 'transcribing' });
  if (transcribeTimer) clearTimeout(transcribeTimer);
  transcribeTimer = setTimeout(() => { if (voice.get().phase === 'transcribing') set({ phase: 'listening' }); }, 15_000);
}
function heard({ text: raw, utterance }: VoiceHeard): void {
  const s = voice.get();
  if (['off', 'preparing', 'starting'].includes(s.phase)) return;
  if (s.phase !== 'speaking' && s.phase !== 'hearing') set({ phase: speakingNow() ? 'speaking' : 'listening' });
  const text = raw.trim();
  thoughts.finish(utterance, isNoise(text) ? '' : text);
}

// ── speaking ──
/** The sentences of the reply being read: synthesized one ahead of the one playing, played back to back. */
interface Line { done?: () => void; start?: () => void; text: string; voice?: VoiceName; audio: Promise<{ samples: Float32Array; rate: number; error?: string } | null> | null }
let lines: Line[] = [];
let speakN = 0; // each stop; a synthesis or a play that comes back to another one gives up
let out: AudioContext | null = null, playing: AudioBufferSourceNode | null = null, pumping = false;
/** the echo of the last words can reach the mic just after the voice stops */
let quietUntil = 0;
/** narrate() is on: the lines play with the microphone off too */
let narrating = false;
const speakingNow = () => !!playing || lines.length > 0 || pumping;

function synth(text: string, voiceName?: VoiceName): NonNullable<Line['audio']> {
  // English words and acronyms respelled for the Italian voice (forEar): the speech only, the chat keeps the text
  return window.sb.invoke('voice:speak', { text: forEar(text), ...(voiceName ? { voice: voiceName } : {}) }).catch(() => null);
}

/** Queues text to be said; raw: already written to be heard (a question): no markdown cleanup, no length cut. */
export function say(text: string, raw = false): void {
  const clean = raw ? text.trim() : speakable(text);
  for (const c of speechChunks(clean)) queueLine(c);
}

function queueLine(text: string, voiceName?: VoiceName): void {
  // synthesis starts now for the first two lines; the others when their turn is near (pump), so a stop wastes little
  lines.push({ text, ...(voiceName ? { voice: voiceName } : {}), audio: lines.length < 2 ? synth(text, voiceName) : null });
  void pump();
}

async function pump(): Promise<void> {
  if (pumping || playing) return;
  const n = speakN;
  const line = lines[0];
  if (!line) { endNarration(); if (voice.get().phase === 'speaking') set({ phase: 'listening' }); return; }
  pumping = true;
  if (voice.get().phase !== 'off') set({ phase: 'speaking' });
  line.audio ??= synth(line.text, line.voice);
  if (lines[1] && !lines[1].audio) lines[1].audio = synth(lines[1].text, lines[1].voice); // the next one while this one plays
  const r = await line.audio;
  if (n !== speakN) return; // stopped meanwhile: `pumping` belongs to whoever runs now
  pumping = false;
  if (voice.get().phase === 'off' && !narrating) return;
  lines.shift();
  if (!r || r.error || !r.samples.length) {
    line.start?.(); // a beat that cannot sound still moves its board
    if (r?.error) { set({ error: r.error }); toast(t('voice.speakFailed', { error: r.error }), 'err'); silentRest(line, lines, n); lines = []; }
    void pump();
    return;
  }
  const src = play(r.samples, r.rate);
  playing = src;
  line.start?.();
  src.onended = () => { if (playing !== src) return; playing = null; line.done?.(); quietUntil = Date.now() + 400; void pump(); };
}

/** The voice failed: the lines still waiting are not said, but their beats move the board at reading pace (as Impara
 *  does without the voice), and the last one's `done` still comes; a stop or a new narration cancels them. */
function silentRest(failed: Line, rest: readonly Line[], n: number): void {
  const readMs = (text: string) => Math.min(6500, Math.max(2200, text.split(/\s+/).length * 330));
  let at = readMs(failed.text);
  for (const l of rest) {
    const { start, done } = l;
    if (start) setTimeout(() => { if (n === speakN) start(); }, at);
    at += readMs(l.text);
    if (done) setTimeout(() => { if (n === speakN) done(); }, at);
  }
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

function endNarration(): void { if (narrating) { narrating = false; set({ narrating: false }); } }

/** Impara: reads `text` aloud now (what was being said stops), with or without the microphone; `done` when it ends. */
export function narrate(text: string, done?: () => void): void {
  stopSpeaking(false);
  const chunks = speechChunks(speakable(text, Number.MAX_SAFE_INTEGER));
  if (!chunks.length) { done?.(); return; }
  narrating = true;
  set({ narrating: true });
  for (const c of chunks) queueLine(c);
  const last = lines.at(-1);
  if (last && done) last.done = done;
}

/** Impara's beats (ADR 0188): each text read in turn, `onStart(i)` the moment beat i starts to sound (the board moves
 *  to its part then), `done` when the last ends. A beat whose synthesis fails is skipped, its start still called. */
export function narrateBeats(texts: readonly string[], onStart: (i: number) => void, done?: () => void): void {
  stopSpeaking(false);
  let any = false;
  texts.forEach((text, i) => {
    const chunks = speechChunks(speakable(text, Number.MAX_SAFE_INTEGER));
    chunks.forEach((c, k) => { queueLine(c); if (k === 0) lines.at(-1)!.start = () => onStart(i); });
    any ||= chunks.length > 0;
  });
  if (!any) { done?.(); return; }
  narrating = true;
  set({ narrating: true });
  const last = lines.at(-1);
  if (last && done) last.done = done;
}

/** Impara's podcast (ADR 0205): lines read in turn, each in its own voice (absent = the chosen one); `onStart(i)` when
 *  line i starts to sound, `done` after the last. Only voices already on disk are passed (none is downloaded here). */
export function narrateLines(items: readonly { text: string; voice?: VoiceName }[], onStart: (i: number) => void, done?: () => void): void {
  stopSpeaking(false);
  let any = false;
  items.forEach((it, i) => {
    const chunks = speechChunks(speakable(it.text, Number.MAX_SAFE_INTEGER));
    chunks.forEach((c, k) => { queueLine(c, it.voice); if (k === 0) lines.at(-1)!.start = () => onStart(i); });
    any ||= chunks.length > 0;
  });
  if (!any) { done?.(); return; }
  narrating = true;
  set({ narrating: true });
  const last = lines.at(-1);
  if (last && done) last.done = done;
}

/** Settings → Voce «Prova»: a short sentence in that voice (downloaded first if missing). Returns an error, or null. */
export async function previewVoice(name: VoiceName): Promise<string | null> {
  const r = await synth(t('voice.sample'), name);
  if (!r || r.error || !r.samples.length) return r?.error ?? t('voice.engineDown');
  stopSpeaking(false);
  playing = play(r.samples, r.rate);
  const src = playing;
  src.onended = () => { if (playing !== src) return; playing = null; void pump(); };
  return null;
}

/** Esc, «zitto», or the user talking over it: the voice stops and what was still to be said is dropped. */
export function stopSpeaking(back = true): void {
  void window.sb.invoke('voice:cancelSpeech', undefined).catch(() => {});
  speakN++;
  lines = [];
  pumping = false;
  const p = playing;
  playing = null;
  try { p?.stop(); } catch { /* ended */ }
  if (p) quietUntil = Date.now() + 400;
  if (turn) turn.cut = true; // the rest of that reply stays in the chat
  endNarration();
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
const deliveredIds = new Map<string, string>();
export function replayQuestion(): void {
  const q = questions.at(-1);
  if (!q) return;
  q.said = false; saidIds.delete(q.id); deliveredIds.delete(q.id);
  sayQuestion();
}
function sayQuestion(): void {
  const q = questions.at(-1);
  set({ question: q?.id ?? null });
  if (q && saidIds.has(q.id)) q.said = true;
  if (!q || q.said || voice.get().mode !== 'talk' || ['off', 'preparing', 'starting'].includes(voice.get().phase)) return;
  q.said = true;
  saidIds.add(q.id);
  stopSpeaking(false);
  const version = questionVersion(q);
  say(spokenQuestion(q.speak, !hinted), true);
  const last = lines.at(-1);
  if (last) last.done = () => { if (questions.some(item => item.id === q.id && questionVersion(item) === version)) deliveredIds.set(q.id, version); };
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
  useEffect(() => {
    const q = mine.current;
    if (!q) return;
    const changed = questionVersion(q) !== JSON.stringify(speak);
    q.onAnswer = onAnswer; q.speak = speak;
    if (changed) { q.said = false; saidIds.delete(q.id); deliveredIds.delete(q.id); if (questions.at(-1) === q) sayQuestion(); }
  });
}
