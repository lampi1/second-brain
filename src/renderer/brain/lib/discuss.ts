// "Discutine" / "Apri una chat" on the ideas and the AI's suggestions (Idee), on the recurring AI errors and on every
// number of Qualità and Costi (ADR 0037), and on the procedures (Procedure, ADR 0041): the ready texts (a draft for the
// Regia that quotes the topic with its source file, its numbers or its line, the first message of a dedicated work chat;
// for a procedure, a chat that follows it), the line of an idea in its file, and the "discussa" record (which chat,
// when) kept per topic in the app's own storage. The idea's state in ideas.md is never changed here: only the Regia
// changes it, when the owner asks. DOM-free and unit-tested (test/unit/brain-ui/discuss.test.ts); the buttons are
// components/Discuss.tsx.
import type { ProcedureSummary } from '@shared/contract';
import type { Idea, Reflection } from '../types';
import { short } from './text';

/** A recurring error or a number of a stats page, quoted as it is on screen: its source file and its facts (count,
 *  period, comparison). `id` keys the "discussa" record: stable across reloads (the pattern or the metric, not values). */
export interface Quote {
  id: string;
  what: 'errore' | 'numero';
  title: string;
  /** where the number comes from, as the page says it ("ai-errors.md", "costi del cervello, /api/cost") */
  source: string;
  /** one fact per line, already in plain Italian with numbers and dates */
  facts: string[];
  /** the opening question; the default one by `what` otherwise */
  question?: string;
  /** the source is a file of the brain folder (the dedicated chat can reread it); else it works from the facts */
  inBrain?: boolean;
}

/** What can be discussed: an idea of ideas.md (the owner's or the AI's), a reflection of ai-reflections.md, a quoted
 *  error pattern or number, or a procedure of the brain (its file and heading line come with it). */
export type Topic =
  | { kind: 'idea'; idea: Idea }
  | { kind: 'reflection'; reflection: Reflection }
  | { kind: 'quote'; quote: Quote }
  | { kind: 'procedure'; procedure: Pick<ProcedureSummary, 'title' | 'file' | 'line' | 'area' | 'changedAt'> };

export const IDEAS_FILE = 'ideas.md';
export const REFLECTIONS_FILE = 'ai-reflections.md';
/** The brain file that holds the topic; null for a quote (its source may be several files or the app's logs). */
export const fileOf = (t: Topic): string | null =>
  (t.kind === 'idea' ? IDEAS_FILE : t.kind === 'reflection' ? REFLECTIONS_FILE : t.kind === 'procedure' ? t.procedure.file : null);
export const titleOf = (t: Topic): string =>
  (t.kind === 'idea' ? t.idea.titolo : t.kind === 'reflection' ? t.reflection.titolo : t.kind === 'procedure' ? t.procedure.title : t.quote.title);
export const dateOf = (t: Topic): string =>
  (t.kind === 'idea' ? t.idea.data : t.kind === 'reflection' ? t.reflection.data : t.kind === 'procedure' ? (t.procedure.changedAt ?? '').slice(0, 10) : '');

/** Stable key of a topic (date + title, as the brain's live feed keys ideas; a quote by its id; a procedure: file + title). */
export const topicKey = (t: Topic): string =>
  t.kind === 'idea' ? `idea|${t.idea.data}|${t.idea.titolo}`
    : t.kind === 'reflection' ? `refl|${t.reflection.data}|${t.reflection.chat}|${t.reflection.titolo}`
      : t.kind === 'procedure' ? `proc|${t.procedure.file}|${t.procedure.title}` : `quote|${t.quote.id}`;

/** 1-based line of the topic's heading in its file: the "## …" line with its date and title, else any line with the
 *  title; null when the file does not have it (the message then names only the file). */
export function lineOf(fileText: string, t: Topic): number | null {
  if (t.kind === 'procedure') return t.procedure.line || null;
  const title = titleOf(t).trim();
  if (!fileText || !title) return null;
  const lines = fileText.split(/\r?\n/);
  const date = dateOf(t);
  const head = lines.findIndex(l => /^#{2,4}\s/.test(l) && l.includes(title) && (!date || l.includes(date)));
  if (head >= 0) return head + 1;
  const any = lines.findIndex(l => /^#{2,4}\s/.test(l) && l.includes(title));
  if (any >= 0) return any + 1;
  const loose = lines.findIndex(l => l.includes(title));
  return loose >= 0 ? loose + 1 : null;
}

const where = (t: Topic, line: number | null) => (t.kind === 'quote' ? t.quote.source : `${fileOf(t)}${line ? `, riga ${line}` : ''}`);
const ddmm = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? `${m[3]}/${m[2]}` : iso; };
const field = (label: string, v: string, max = 280) => (v.trim() ? `- ${label}: ${short(v.trim().replace(/\s+/g, ' '), max)}` : '');
const STATE_RULE = 'Non cambiare lo stato in ideas.md: lo decido io dopo averne parlato.';

export const ERROR_QUESTION = 'Perché succede e come lo evitiamo? Proponi una cosa sola: una regola più chiara o un controllo automatico.';
export const NUMBER_QUESTION = 'Cosa ci dice questo numero? Se c\'è qualcosa da cambiare, dammi il primo passo piccolo.';
/** The first question that opens the discussion, by kind and state (a quote: its own, else by error or number). */
export function openingQuestion(t: Topic): string {
  if (t.kind === 'procedure') return 'È ancora giusta così? Cosa manca, cosa è cambiato, quale passo si può semplificare?';
  if (t.kind === 'quote') return t.quote.question ?? (t.quote.what === 'errore' ? ERROR_QUESTION : NUMBER_QUESTION);
  if (t.kind === 'reflection') return 'Sei ancora d\'accordo con te stessa? Cosa cambieresti, in concreto, nel modo in cui lavoriamo?';
  const i = t.idea;
  if (i.stato === 'fatta') return 'Ha funzionato come volevamo? Cosa terresti e cosa cambieresti?';
  if (i.stato === 'scartata') return 'L\'avevamo scartata: è cambiato qualcosa che la rende utile adesso?';
  if (i.stato === 'in corso') return 'A che punto è? Qual è il prossimo passo piccolo?';
  if (i.chi === 'IA') return 'Sei ancora convinta? Dammi pro, contro e il primo passo piccolo per provarla.';
  return 'Ha ancora senso? Dammi pro, contro e il primo passo piccolo per provarla.';
}

/** The draft for the Regia ("Discutine"): quotes the topic with file and line, ends with the opening question. */
export function discussText(t: Topic, line: number | null): string {
  if (t.kind === 'procedure') {
    return blocks([`Parliamo della procedura «${t.procedure.title}» (${where(t, line)}, area ${t.procedure.area}).`], [`${openingQuestion(t)} Non cambiare il file: prima ne parliamo.`]);
  }
  if (t.kind === 'quote') {
    const q = t.quote;
    return blocks(
      [`Discutiamo ${q.what === 'errore' ? 'l\'errore che si ripete' : 'il numero'} «${q.title}» (fonte: ${q.source}).`],
      q.facts.map(f => (f.trim() ? `- ${short(f.trim().replace(/\s+/g, ' '), 300)}` : '')),
      [openingQuestion(t)],
    );
  }
  if (t.kind === 'reflection') {
    const r = t.reflection;
    return blocks(
      [`Discutiamo la tua riflessione «${r.titolo}» (${where(t, line)}, del ${ddmm(r.data)}, chat ${r.chat}).`],
      [field('Hai notato', r.notato), field('Pensi', r.penso), field('Sicurezza', r.sicurezza, 80), field('Non sai', r.nonso)],
      [openingQuestion(t)],
    );
  }
  const i = t.idea;
  const whose = i.chi === 'IA' ? `lo spunto dell'IA` : 'la mia idea';
  return blocks(
    [`Discutiamo ${whose} «${i.titolo}» (${where(t, line)}, del ${ddmm(i.data)}, stato ${i.stato || 'aperta'}).`],
    [field('In breve', i.idea), field('Perché', i.perche), field('Come', i.come),
      field('Ha notato', i.notato), field('Pensa', i.penso), field('Non sa', i.nonso),
      i.fonte ? field('Nata in', i.fonte.replace(/^IA\s*·\s*/, ''), 120) : ''],
    [`${openingQuestion(t)} ${STATE_RULE}`],
  );
}
/** Paragraphs of non-empty lines, separated by one blank line; an empty paragraph disappears. */
const blocks = (...ps: string[][]): string => ps.map(p => p.filter(Boolean).join('\n')).filter(Boolean).join('\n\n');

/** Title of the dedicated work chat ("Idea · <titolo>", short enough for a tile). */
export const chatTitle = (t: Topic): string =>
  `${t.kind === 'idea' ? 'Idea' : t.kind === 'reflection' ? 'Riflessione' : t.kind === 'procedure' ? 'Procedura' : t.quote.what === 'errore' ? 'Errore' : 'Numero'} · ${short(titleOf(t), 44)}`;

/** First message of the dedicated work chat ("Apri una chat"): read the topic, propose before touching anything. */
export function chatPrompt(t: Topic, line: number | null): string {
  if (t.kind === 'procedure') {
    return [
      `Seguiamo la procedura «${t.procedure.title}» (${where(t, line)} nella cartella del cervello).`,
      `Leggila per intero${line ? ` dalla riga ${line}` : ''}, poi dimmi in 5 righe cosa ti serve da me (dati, ambiente, ok) prima del primo passo.`,
      'Ogni comando o query di produzione me lo proponi e lo eseguo io; i segreti non li scrivi mai in chat.',
    ].join('\n');
  }
  if (t.kind === 'quote') {
    const q = t.quote;
    return [
      `Lavoriamo ${q.what === 'errore' ? 'sull\'errore che si ripete' : 'sul numero'} «${q.title}» (fonte: ${q.source}${q.inBrain ? ', nella cartella del cervello' : ''}).`,
      ...q.facts.filter(f => f.trim()).map(f => `- ${short(f.trim().replace(/\s+/g, ' '), 300)}`),
      `${q.inBrain ? 'Rileggi la fonte' : 'Parti dai numeri qui sopra'}, poi in 5 righe: ${q.what === 'errore' ? 'perché succede e una sola proposta per evitarlo' : 'cosa ci dice il numero e cosa faresti'}, prima di toccare qualcosa.`,
    ].join('\n');
  }
  const what = t.kind === 'idea' ? `sull'idea «${t.idea.titolo}»` : `sulla riflessione dell'IA «${t.reflection.titolo}»`;
  return [
    `Lavoriamo ${what} (${where(t, line)} nella cartella del cervello).`,
    `Leggila per intero${line ? ` dalla riga ${line}` : ''}, poi proponimi in 5 righe come partire e il primo passo, prima di toccare qualcosa.`,
    'Lo stato dell\'idea in ideas.md lo cambia solo la Regia, quando te lo chiedo.',
  ].join('\n');
}

// ── the "discussa" record ───────────────────────────────────────────────────────────────────────────────────────────
/** One discussion: with the Regia (the draft was sent) or in a dedicated work chat. */
export interface Discussed { via: 'regia' | 'chat'; chatId: string; chatTitle: string; at: number }
export type DiscussedMap = Record<string, Discussed[]>;
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

const KEY = 'sb.discussed.v1';
const MAX_KEYS = 400;

export function readDiscussed(kv: KV | null): DiscussedMap {
  try {
    const raw = JSON.parse(kv?.getItem(KEY) ?? 'null') as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: DiscussedMap = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue;
      const list = v.filter((d): d is Discussed => !!d && typeof d === 'object' && (d.via === 'regia' || d.via === 'chat') && typeof d.chatId === 'string' && typeof d.at === 'number')
        .map(d => ({ via: d.via, chatId: d.chatId, chatTitle: typeof d.chatTitle === 'string' ? d.chatTitle : '', at: d.at }));
      if (list.length) out[k] = list;
    }
    return out;
  } catch { return {}; }
}

/** Add a discussion (newest first, at most 5 per topic, the oldest topics dropped past MAX_KEYS). */
export function addDiscussed(m: DiscussedMap, key: string, d: Discussed): DiscussedMap {
  const list = [d, ...(m[key] ?? []).filter(x => !(x.chatId === d.chatId && x.via === d.via))].slice(0, 5);
  const next: DiscussedMap = { ...m, [key]: list };
  const keys = Object.keys(next);
  if (keys.length > MAX_KEYS) {
    const byAge = keys.sort((a, b) => (next[a]![0]!.at) - (next[b]![0]!.at));
    for (const k of byAge.slice(0, keys.length - MAX_KEYS)) delete next[k];
  }
  return next;
}

export function writeDiscussed(kv: KV | null, m: DiscussedMap): void {
  try { kv?.setItem(KEY, JSON.stringify(m)); } catch { /* storage off: the mark lives until the app restarts */ }
}
