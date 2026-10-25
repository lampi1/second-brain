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

/** How the Italian voice should say the English words and acronyms a reply still has (the reply itself is asked to
 *  avoid them, chats/voice-reply.ts): a small pronunciation dictionary, like the reference pronunciations of OpenAI's
 *  voice prompting guide and ElevenLabs' alias dictionaries. Spellings written for Piper's Italian phonemizer (espeak-ng):
 *  an accent marks the stress. Applied to what is spoken only, never to the chat. */
const SAY_AS: [RegExp, string][] = ([
  ['pull request', 'pul ricuèst'], ['pull requests', 'pul ricuèst'], ['github', 'ghìt-hab'], ['gitlab', 'ghìt-lab'], ['git', 'ghit'],
  ['merge', 'mèrg'], ['merged', 'mèrgiato'], ['commit', 'commìt'], ['commits', 'commìt'], ['branch', 'brànch'], ['push', 'pùsh'],
  ['bug', 'bag'], ['bugs', 'bag'], ['fix', 'fics'], ['deploy', 'diplòi'], ['release', 'rilìs'], ['build', 'bìld'], ['review', 'riviù'],
  ['issue', 'ìssiu'], ['issues', 'ìssiu'], ['feature', 'fìciur'], ['features', 'fìciur'], ['task', 'tàsk'], ['tasks', 'tàsk'],
  ['team', 'tìm'], ['teams', 'tìms'], ['meeting', 'mìting'], ['chat', 'ciàt'], ['email', 'imèil'], ['mail', 'mèil'], ['file', 'fàil'],
  ['files', 'fàil'], ['update', 'apdèit'], ['login', 'loghìn'], ['password', 'pàssuord'], ['browser', 'bràuser'],
  ['default', 'difòlt'], ['dashboard', 'dèshbord'], ['workflow', 'uòrcflou'], ['screenshot', 'scrìnsciot'], ['script', 'scrìpt'],
  ['scripts', 'scrìpt'], ['query', 'quèri'], ['backend', 'bècchend'], ['frontend', 'fròntend'], ['plugin', 'plàghin'], ['token', 'tòken'],
  ['tokens', 'tòken'], ['prompt', 'pròmpt'], ['claude', 'clòd'], ['cursor', 'kèrsor'], ['flash', 'flèsh'], ['scout', 'scàut'],
  ['windows', 'uìndous'], ['jira', 'gìra'], ['whisper', 'uìsper'], ['ok', 'okèi'], ['okay', 'okèi'], ['json', 'gèison'], ['online', 'onlàin'],
] as const).map(([w, say]) => [new RegExp(`(?<![\\p{L}\\p{N}])${w}(?![\\p{L}\\p{N}])`, 'giu'), say]);
const LETTER: Record<string, string> = { A: 'a', B: 'bi', C: 'ci', D: 'di', E: 'e', F: 'effe', G: 'gi', H: 'acca', I: 'i', J: 'i lunga', K: 'cappa', L: 'elle', M: 'emme',
  N: 'enne', O: 'o', P: 'pi', Q: 'cu', R: 'erre', S: 'esse', T: 'ti', U: 'u', V: 'vu', W: 'doppia vu', X: 'ics', Y: 'ipsilon', Z: 'zeta' };
/** acronyms said as words, not letter by letter */
const AS_WORD = new Set(['REST', 'NASA', 'FIAT', 'UE', 'ONU', 'IVA', 'INPS', 'COVID', 'RAM', 'SIM', 'LED', 'PIN', 'CAP']);

export function forEar(text: string): string {
  let s = text
    .replace(/\s*(?:→|->|=>|⇒)\s*/g, ', poi ')
    .replace(/\s*&\s*/g, ' e ')
    .replace(/(\d)\s*%/g, '$1 per cento')
    .replace(/#(\d+)/g, 'numero $1')
    .replace(/(\p{L})\/(\p{L})/gu, '$1 o $2')
    .replace(/\s*[()[\]{}]\s*/g, ', ')
    .replace(/\s*[;:]\s+/g, ', ')
    .replace(/\s+[-–—]\s+/g, ', ');
  for (const [re, say] of SAY_AS) s = s.replace(re, say);
  s = s.replace(/(?<![\p{L}\p{N}])([A-Z]{2,5})s?(?![\p{L}\p{N}])/gu, (m, a: string) => (AS_WORD.has(a) ? a.toLowerCase() : [...a].map(c => LETTER[c] ?? c).join(' ')));
  return s.replace(/\s*,\s*(?=[,.!?…])/g, '').replace(/,\s*,/g, ',').replace(/^\s*,\s*/, '').replace(/\s{2,}/g, ' ').trim();
}

/** The turn being answered, while it streams (talk mode reads it aloud sentence by sentence, not after the whole reply
 *  and all its synthesis: first audio after the first sentence, the way voice agents stream LLM text into TTS, see ADR
 *  0152). The user's own last message after `since`; the assistant text after it (a partial one included); done = the
 *  turn ended. key = the user's message, so a turn is read once. */
export function turnToSpeak(items: readonly ChatItem[] | undefined, since: number): { key: string; text: string; done: boolean } | null {
  if (!items?.length) return null;
  let u = items.length - 1;
  while (u >= 0 && items[u]!.kind !== 'user') u--;
  const user = items[u];
  if (!user || user.kind !== 'user' || user.from || user.at < since) return null;
  const after = items.slice(u + 1);
  const text = after.filter((i): i is Extract<ChatItem, { kind: 'assistant' }> => i.kind === 'assistant').map(i => i.text).join('\n\n');
  return { key: user.id, text, done: after.some(i => i.kind === 'result') };
}

/** The part of a streaming reply that is safe to say now: up to its last finished sentence, never inside an open code
 *  block; all of it once the turn is done. */
export function settledText(md: string, done: boolean): string {
  if (done) return md;
  let s = md;
  const fences = s.match(/```/g)?.length ?? 0;
  if (fences % 2) s = s.slice(0, s.lastIndexOf('```'));
  // «1.» opening a list item is not the end of a sentence
  const m = [...s.matchAll(/(?<!\d)[.!?…:](?=\s)|\n/g)].at(-1);
  return m ? s.slice(0, m.index! + 1) : '';
}

/** Spoken text cut into the pieces synthesized one by one: sentences; a long one also at a comma or a space, so the
 *  first sound never waits for a whole paragraph. */
export function speechChunks(text: string, max = 180): string[] {
  const out: string[] = [];
  for (const raw of text.split(/(?<=[.!?…])\s+/)) {
    let s = raw.trim();
    while (s.length > max) {
      const cut = Math.max(s.lastIndexOf(', ', max), s.lastIndexOf('; ', max));
      const at = cut > max / 3 ? cut + 1 : Math.max(s.lastIndexOf(' ', max), max / 2);
      out.push(s.slice(0, at).trim());
      s = s.slice(at).trim();
    }
    if (s && /[\p{L}\p{N}]/u.test(s)) out.push(s);
  }
  return out;
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
