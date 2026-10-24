// Voice mode (ADR 0152, owner 2026-10-24: «o microfono muto oppure modalità full»): the shapes main and the renderer
// share, and the pure text rules both sides need. Main (main/voice/) runs the local speech engine (sherpa-onnx: Silero
// VAD, Whisper, Piper Italian voices) in its own process; the renderer (lib/voice.ts) records the microphone, plays the
// spoken replies and answers app questions by voice. Pinned by test/unit/voice.test.ts.

import type { ChatItem } from './contract';

/** Whisper size: fast = small int8 (~374 MB), accurate = turbo int8 (~1 GB) */
export type VoiceAsr = 'fast' | 'accurate';
/** the Italian Piper voices offered (k2-fsa sherpa-onnx tts-models) */
export type VoiceName = 'paola' | 'miro' | 'dii';
export const VOICE_ASRS: readonly VoiceAsr[] = ['fast', 'accurate'];
export const VOICE_NAMES: readonly VoiceName[] = ['paola', 'miro', 'dii'];
/** the microphone's sample rate: Whisper and Silero both want 16 kHz mono */
export const VOICE_RATE = 16_000;

/** What is on disk and what the engine is doing now (voice:state, voice:changed). */
export interface VoiceState {
  /** each part present and checked: the VAD, the chosen Whisper, the chosen voice */
  ready: { vad: boolean; asr: boolean; tts: boolean };
  asr: VoiceAsr;
  voice: VoiceName;
  /** a download in progress: bytes done of total (total 0 = not known yet) */
  downloading: { done: number; total: number } | null;
  /** the last failure, in Italian, for the user (download, engine start) */
  error: string | null;
  /** megabytes still to download for the chosen models */
  missingMb: number;
  /** the fake engine (SB_VOICE_FAKE, the demo): no microphone needed */
  fake?: boolean;
}

/** A spoken answer to a yes/no card: yes, no, «non voglio rispondere», or free text. */
export type SpokenAnswer = { kind: 'yes' } | { kind: 'no' } | { kind: 'skip' } | { kind: 'text'; text: string };

const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const YES = new Set(['si', 'sì', 'certo', 'ok', 'okay', 'va bene', 'vai', 'procedi', 'confermo', 'esatto', 'si grazie', 'si vai', 'si procedi', 'si certo', 'yes', 'certamente', 'assolutamente si', 'daccordo', "d'accordo", 'fallo', 'si fallo']);
const NO = new Set(['no', 'no grazie', 'non ora', 'assolutamente no', 'nope', 'negativo', 'per niente', 'non farlo', 'no lascia stare', 'lascia stare', 'no no']);
const SKIP = ['non voglio rispondere', 'non rispondo', 'ci penso dopo', 'salta', 'dopo', 'piu tardi', 'passo'];

/** Reads a transcribed answer to a yes/no card. A short yes or no (a few words, starting with it) counts as the
 *  click; anything longer is the user's own answer, sent as text, like «Scrivi una risposta…». */
export function parseSpokenAnswer(raw: string): SpokenAnswer | null {
  const text = raw.trim();
  const n = norm(text);
  if (!n) return null;
  if (SKIP.some(s => n === s || n.startsWith(`${s} `))) return { kind: 'skip' };
  if (YES.has(n)) return { kind: 'yes' };
  if (NO.has(n)) return { kind: 'no' };
  const words = n.split(' ');
  if (words.length <= 4 && words[0] === 'si') return { kind: 'yes' };
  if (words.length <= 4 && words[0] === 'no') return { kind: 'no' };
  return { kind: 'text', text };
}

/** Whisper's usual output on silence or noise ("Sottotitoli a cura di…", "Grazie per la visione"): never a message. */
export function isNoise(text: string): boolean {
  const n = norm(text);
  if (n.length < 2) return true;
  return /^(sottotitoli|sottotitolato|grazie per (la visione|l'ascolto|aver guardato)|amara org|musica|applausi|silenzio)/.test(n)
    || /^[\s.!?,]*$/.test(text);
}

/** The words of a reply worth saying aloud: no code, links, tables, markdown marks or emoji; a long reply is cut at a
 *  sentence and ends with «il resto è in chat». English-only noise (file paths, ids) is left out too. */
export function speakable(md: string, max = 700): string {
  let s = md
    .replace(/```[\s\S]*?```/g, ' (codice in chat) ')
    .replace(/`([^`]{1,40})`/g, '$1')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/[*_~>#]+/g, '')
    .replace(/(?:[A-Za-z]:)?(?:[\\/][\w.-]+){2,}/g, ' ')
    .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/(\.\s*){2,}/g, '. ')
    .trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  s = end > max / 3 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
  return `${s} Il resto è in chat.`;
}

/** The reply to read aloud when a chat's turn ends: the assistant text after the user's own last message (not one a chat
 *  or the app sent: the app never speaks on its own initiative, owner 2026-10-24), only when that message came after
 *  `since` (voice mode on) and the turn ended with a result. key = the result's id, so each reply is said once. */
export function replyToSpeak(items: readonly ChatItem[] | undefined, since: number): { key: string; text: string } | null {
  if (!items?.length) return null;
  const last = items[items.length - 1]!;
  if (last.kind !== 'result' || last.isError || last.interrupted) return null;
  let u = items.length - 2;
  while (u >= 0 && items[u]!.kind !== 'user') u--;
  const user = items[u];
  if (!user || user.kind !== 'user' || user.from || user.at < since) return null;
  const text = items.slice(u + 1).filter((i): i is Extract<ChatItem, { kind: 'assistant' }> => i.kind === 'assistant').map(i => i.text).join('\n\n');
  const say = speakable(text);
  return say ? { key: last.id, text: say } : null;
}

/** What a question card gives voice mode (DecisionCard: the question, what was done, what yes and no do; who asks). */
export interface SpokenQuestionInput { question: string; done?: string; ifYes?: string; ifNo?: string; from?: string }

// labels the cards and the agents put in front of their lines: said aloud they sound like a form («Contesto: …»)
const LABEL = /^\s*(?:[-*•]\s*)?(?:contesto|context|fatto|fatti|done|domanda|question|prova|prove|evidence|nota|note|riassunto|summary|se s[iì]|se no|if yes|if no|motivo|perch[eé])\s*[:\-–—]\s*/i;
const sentence = (s: string): string => {
  const lines = s.split('\n').map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(LABEL, '').trim()).filter(Boolean);
  let one = speakable(lines.join(', '), 360).trim();
  one = one.charAt(0).toUpperCase() + one.slice(1);
  return !one ? '' : /[.!?…]$/.test(one) ? one : `${one}.`;
};
const lowerFirst = (s: string) => (/^[A-ZÀ-Ý][a-zà-ÿ]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);

/** The question as a person would say it, never as a form: who asks, what was done, the question, what yes and no do;
 *  `first` adds how to answer (once per voice session, not at every card). */
export function spokenQuestion(q: SpokenQuestionInput, first: boolean): string {
  const parts: string[] = [];
  parts.push(q.from ? `${q.from} ti chiede una cosa.` : 'Ho una domanda per te.');
  const done = q.done ? sentence(q.done) : '';
  if (done) parts.push(done);
  let ask = sentence(q.question).replace(/\.$/, '');
  if (ask && !/[?!…]$/.test(ask)) ask = `${ask}?`;
  if (ask) parts.push(ask);
  const yes = q.ifYes ? sentence(q.ifYes) : '', no = q.ifNo ? sentence(q.ifNo) : '';
  if (yes) parts.push(`Se mi dici di sì, ${lowerFirst(yes)}`);
  if (no) parts.push(`Se mi dici di no, ${lowerFirst(no)}`);
  if (first) parts.push('Puoi rispondere sì o no, oppure dirmi con parole tue cosa preferisci.');
  return parts.join(' ');
}
