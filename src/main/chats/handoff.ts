// Hand-off notes ("passaggio di consegne") of the app's chats, and the context-size helpers around them. Why: most of
// the spend of a long chat is the history it re-reads at every step (the user's costs, 07-10/10/2026: 80 % context
// re-reads, ~30 % in chats over 200k tokens). A chat that is finished, or too long, writes a short hand-off (state,
// files and worktree, decisions, what was tried and dropped, next step); "Riprendi" then opens a NEW chat on the same
// engine and folder that starts from it, instead of re-reading the old history. Engine-neutral: the chat answers with
// the note between two markers in plain text (no file tool, no permission), and the app saves it as
// <userData>/handoffs/<chatId>.md. When the chat cannot be asked (not running and not to be started, or no answer in
// the format) a token-free note is built from what the app saw (files, commands, last messages) and marked as such.
// Cold chats (ADR 0031): coldAsk / coldRoute are the rules of the invisible continuation (an idle long Claude chat
// writes its note while the prompt cache is warm; a message after the cache expired goes on in a fresh session of the
// same chat, from coldPrompt). Used by manager.ts (ChatManager.handoff / continueChat / the cold sweep) and its tests.
import fs from 'node:fs';
import path from 'node:path';
import type { ChatItem, ChatSummary, HandoffInfo } from '../../shared/contract';
import { errText, log } from '../log';
import { cut } from './session';

export const HANDOFF_START = '<<<PASSAGGIO';
export const HANDOFF_END = 'PASSAGGIO>>>';
/** the hand-off is short by design: anything longer is cut (the new chat reads it at every step too) */
const MAX_CHARS = 6000;

/** The message that asks a chat for its hand-off. memTool = the brain's mem.mjs (its now.md line), when there is one. */
export function handoffRequest(opts: { title: string; reason: 'manual' | 'threshold' | 'finished' | 'continue' | 'cold'; contextTokens?: number | null; memTool?: string | null }): string {
  const cold = opts.reason === 'cold';
  const why = cold ? 'Questa chat è ferma da un po’: se riprende, continuerà in una sessione nuova che parte solo da questo passaggio (rileggere tutta la storia a cache scaduta costa molto).'
    : opts.reason === 'threshold'
    ? `Il contesto di questa chat è arrivato a ${tokensLabel(opts.contextTokens ?? 0)} token: ogni messaggio lo rilegge tutto.`
    : opts.reason === 'continue' ? 'Il lavoro continua in una chat nuova che parte solo da questo passaggio.'
      : opts.reason === 'finished' ? 'Questa chat ha finito e verrà chiusa.' : 'Mi serve il punto della situazione.';
  return [
    `[Messaggio dell'app second-brain, non scritto dall'utente] ${why}`,
    'Scrivi il passaggio di consegne per chi riprende questo lavoro in una chat nuova, che non vedrà nulla di questa conversazione.',
    ...(opts.memTool ? [`Se in now.md c'è una riga di questa chat, prima aggiornala (stato e prossimo passo): node ${opts.memTool} now me --label "${safeLabel(opts.title)}" --text "<dove · stato · prossimo>".`] : []),
    'Poi rispondi SOLO con il passaggio, breve (al massimo 40 righe), in italiano, tra queste due righe esatte:',
    HANDOFF_START,
    '## Stato',
    '(cosa è fatto, cosa no; verificato come)',
    '## File e worktree',
    '(percorsi assoluti, branch, commit; cosa non è committato)',
    '## Decisioni prese',
    "(e da chi: l'utente o tu)",
    '## Provato e scartato',
    '(cosa non rifare, e perché)',
    '## Prossimo passo',
    '(il primo comando o la prima azione concreta)',
    ...(cold ? ['## In corso', '(lavori in background, monitor, attese della posta o di altre chat da far ripartire: il comando esatto; "nessuno" se non ce ne sono)'] : []),
    HANDOFF_END,
    'Non fare altro in questo turno.',
  ].join('\n');
}

/** A chat title inside a shell command the chat runs: letters, digits and plain punctuation only (a title may come
 *  from an agent: no $(…), backticks, quotes or redirections). */
export const safeLabel = (title: string): string => title.replace(/[^\p{L}\p{N} .,·:()_+-]/gu, '').trim() || 'chat';

/** The hand-off inside a chat's answer (between both markers: a cut answer is not one); a whole answer with the
 *  headings is accepted too. */
export function extractHandoff(text: string): string | null {
  const a = text.lastIndexOf(HANDOFF_START);
  if (a >= 0) {
    const b = text.indexOf(HANDOFF_END, a + HANDOFF_START.length);
    if (b < 0) return null;
    const body = text.slice(a + HANDOFF_START.length, b).trim();
    // the request itself, echoed back, is not a hand-off
    return body && !/^## Stato\s*\n\(cosa è fatto/.test(body) ? clip(body) : null;
  }
  return /##\s*Stato/i.test(text) && /##\s*Prossimo passo/i.test(text) ? clip(text.trim()) : null;
}

const clip = (s: string): string => (s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}\n…(tagliato)` : s);

/** A token-free hand-off from what the app saw: last messages, files touched, commands run. Marked as automatic. */
export function autoHandoff(chat: Pick<ChatSummary, 'title' | 'cwd' | 'harness' | 'lastText'>, items: readonly ChatItem[]): string {
  const users = items.filter((i): i is Extract<ChatItem, { kind: 'user' }> => i.kind === 'user' && !!i.text.trim() && !i.text.includes(HANDOFF_START));
  const first = users[0]?.text ?? '';
  const lastUsers = users.slice(-3).filter(u => u.text !== first);
  const lastA = [...items].reverse().find((i): i is Extract<ChatItem, { kind: 'assistant' }> => i.kind === 'assistant' && !!i.text.trim());
  const files = new Map<string, { added: number; removed: number }>();
  const cmds: string[] = [];
  for (const i of items) {
    if (i.kind !== 'tool') continue;
    for (const d of i.diff ?? []) { const f = files.get(d.path) ?? { added: 0, removed: 0 }; f.added += d.added; f.removed += d.removed; files.set(d.path, f); }
    const cmd = (i.input as { command?: unknown } | null)?.command;
    if (typeof cmd === 'string' && cmd.trim()) cmds.push(`${i.status === 'error' ? '✗' : '✓'} ${cut(cmd, 140)}`);
  }
  const lines = [
    '> Passaggio automatico: costruito dall’app senza chiedere alla chat (nessun token speso). Decisioni e cose scartate',
    '> non ci sono: se servono, leggile nella chat precedente.',
    '',
    '## Stato',
    `Chat «${chat.title}» (${chat.harness === 'cursor' ? 'Cursor' : 'Claude'}) nella cartella ${chat.cwd}.`,
    ...(lastA ? ['Ultima risposta:', ...quote(cut(lastA.text, 1200))] : chat.lastText ? [`Ultima riga: ${chat.lastText}`] : []),
    '',
    '## Richiesta iniziale',
    ...(first ? quote(cut(first, 1200)) : ['(non disponibile)']),
    ...(lastUsers.length ? ['', '## Ultime richieste', ...lastUsers.map(u => `- ${cut(u.text, 300)}`)] : []),
    '',
    '## File e worktree',
    ...(files.size ? [...files].slice(-25).map(([p, d]) => `- ${p} (+${d.added} −${d.removed})`) : ['(nessuna modifica vista dall’app)']),
    ...(cmds.length ? ['', '## Comandi eseguiti (ultimi)', ...cmds.slice(-10).map(c => `- ${c}`)] : []),
    '',
    '## Prossimo passo',
    'Verifica lo stato reale (git status nella cartella) prima di agire, poi riparti dalla richiesta.',
  ];
  return clip(lines.join('\n'));
}

const quote = (s: string): string[] => s.split(/\r?\n/).map(l => `> ${l}`);

/** The first message of the chat that continues the work. */
export function continuePrompt(from: { title: string; harness: string; cwd: string; inWorktree?: boolean }, h: HandoffInfo): string {
  return [
    `Riprendi un lavoro da una chat precedente, «${from.title}», ora chiusa (resta consultabile nell'app). Cartella: ${from.cwd}.`,
    ...(from.inWorktree ? [`La chat precedente lavorava in un worktree separato creato da Claude (sotto ${path.join(from.cwd, '.claude', 'worktrees')}): trovalo (git worktree list) e lavora lì, mai nel checkout principale.`] : []),
    `Questo è il suo passaggio di consegne${h.source === 'auto' ? ' (automatico: senza decisioni né cose scartate)' : ''}, salvato in ${h.path}:`,
    '',
    h.text,
    '',
    'Prima di agire verifica lo stato reale (file, git status, test) invece di fidarti solo del passaggio; non rifare ciò che è indicato come scartato. Poi continua dal prossimo passo.',
  ].join('\n');
}

// ---- cold chats (ADR 0031) ----

/** the first line of a cold continuation's first message: the transcript shows only the user's part after COLD_SEP */
export const COLD_MARK = '[second-brain · continuazione]';
export const COLD_SEP = '--- messaggio ---';
/** the prompt cache lives 1 h from its last use: past this a message re-writes the whole context */
export const CACHE_TTL_MS = 55 * 60_000;
/** below this a cold re-write costs less than a hand-off and a fresh start */
export const COLD_MIN_TOKENS = 100_000;
/** calls counted as "after" a continuation or a compaction (ADR 0031 counters) */
export const AFTER_CALLS = 5;

/** What the cold rules look at in a chat. noteAt = its cold note (0 = none); lastCallAt = its last API call. */
export interface ColdView {
  harness: string; isRegia: boolean; appRegia?: boolean; continuedBy?: unknown;
  state: string; pending: number; busy: boolean; alive: boolean; handoffTurn: boolean;
  contextTokens: number; lastTurnAt: number; noteAt: number; lastCallAt: number;
  /** the lastTurnAt the note was already asked for (once per idle stretch, even if it failed) */
  askedFor?: number | undefined;
}

const coldChat = (v: Pick<ColdView, 'harness' | 'isRegia' | 'appRegia' | 'continuedBy'>): boolean => v.harness === 'claude' && !v.isRegia && !v.appRegia && !v.continuedBy;

/** Ask for the note now: idle, nothing pending, live engine, a long context, no fresh note, and the cache still warm
 *  but about to expire (idleMs after the last call, before CACHE_TTL_MS). */
export function coldAsk(v: ColdView, now: number, idleMs: number, ttlMs = CACHE_TTL_MS): boolean {
  if (!coldChat(v) || v.state !== 'idle' || v.pending > 0 || v.busy || !v.alive || v.handoffTurn) return false;
  if (v.contextTokens < COLD_MIN_TOKENS || !v.lastTurnAt || v.noteAt >= v.lastTurnAt || v.askedFor === v.lastTurnAt) return false;
  const idle = now - v.lastCallAt;
  return idle >= idleMs && idle < ttlMs;
}

/** The chat still waits for its note (its engine must not be released before it). */
export function coldArmed(v: ColdView, now: number, ttlMs = CACHE_TTL_MS): boolean {
  return coldChat(v) && v.contextTokens >= COLD_MIN_TOKENS && !!v.lastTurnAt && v.noteAt < v.lastTurnAt
    && v.askedFor !== v.lastTurnAt && now - v.lastCallAt < ttlMs;
}

/** A message now goes to a fresh session: a note newer than the last turn, the cache expired, nothing in flight. */
export function coldRoute(v: Omit<ColdView, 'alive' | 'state'>, now: number, ttlMs = CACHE_TTL_MS): boolean {
  if (!coldChat(v) || v.busy || v.pending > 0 || v.handoffTurn) return false;
  return v.noteAt > 0 && v.noteAt >= v.lastTurnAt && now - v.lastCallAt > ttlMs;
}

/** The first message of the fresh session: the note, then the user's message (after COLD_SEP). */
export function coldPrompt(from: { title: string; cwd: string; inWorktree?: boolean }, h: HandoffInfo, message: string): string {
  return [
    COLD_MARK,
    `Questa chat («${from.title}», cartella ${from.cwd}) continua in una sessione nuova: la precedente era ferma da più di un'ora e rileggerla tutta sarebbe costato molto. Parti da questo passaggio di consegne, scritto dalla sessione precedente (salvato in ${h.path}):`,
    ...(from.inWorktree ? [`Si lavora in un worktree separato creato da Claude (sotto ${path.join(from.cwd, '.claude', 'worktrees')}): trovalo (git worktree list) e lavora lì, mai nel checkout principale.`] : []),
    '',
    h.text,
    '',
    'Verifica lo stato reale (file, git status) prima di agire, non rifare ciò che è indicato come scartato, fai ripartire ciò che è elencato in «In corso». Non citare il passaggio all’utente: per lui è la stessa chat. Poi rispondi al suo messaggio:',
    COLD_SEP,
    message,
  ].join('\n');
}

/** The user's part of a cold continuation's first message (the transcript shows only that); other texts unchanged. */
export function coldUserText(text: string): string {
  if (!text.startsWith(COLD_MARK)) return text;
  const i = text.indexOf(`\n${COLD_SEP}\n`);
  return i < 0 ? '' : text.slice(i + COLD_SEP.length + 2);
}

/** "214k", "1,2M", "850" */
export function tokensLabel(n: number): string {
  if (n >= 1_000_000) return `${(Math.round(n / 100_000) / 10).toString().replace('.', ',')}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

/** "Fix totale" → "Fix totale (2)", "Fix totale (2)" → "Fix totale (3)", unique among `taken`. */
export function nextTitle(title: string, taken: readonly string[]): string {
  const m = /^(.*?)\s*\((\d+)\)$/.exec(title);
  const base = (m ? m[1]! : title).trim() || 'Chat';
  let n = m ? Number(m[2]) + 1 : 2;
  while (taken.includes(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

/** <userData>/handoffs/<chatId>.md with a small JSON header line (when, source, size): read by the UI and the Regia. */
export class HandoffStore {
  readonly dir: string;
  constructor(userData: string) { this.dir = path.join(userData, 'handoffs'); }

  /** session = the copy kept for one cold continuation (archive below): the note that session started from */
  pathOf(chatId: string, session?: string): string {
    if (!/^[\w-]{1,64}$/.test(chatId)) throw new Error('id di chat non valido');
    if (session !== undefined && !/^[\w-]{1,64}$/.test(session)) throw new Error('id di sessione non valido');
    return path.join(this.dir, session ? `${chatId}.${session}.md` : `${chatId}.md`);
  }

  /** Keeps a copy of the chat's note for the session that ends on it (a later note overwrites the chat's own file);
   *  returns the copy's path, or the chat's own path when the copy fails. */
  archive(chatId: string, session: string): string {
    const from = this.pathOf(chatId), to = this.pathOf(chatId, session);
    try { fs.copyFileSync(from, to); return to; } catch (e) {
      log.warn('chats', 'hand-off copy not kept', { chat: chatId, cause: errText(e), hint: 'the divider opens the latest note instead' });
      return from;
    }
  }

  write(chatId: string, info: Omit<HandoffInfo, 'path' | 'chatId'>): HandoffInfo {
    const file = this.pathOf(chatId);
    const meta = { at: info.at, source: info.source, title: info.title, contextTokens: info.contextTokens ?? null };
    const body = `<!-- second-brain ${JSON.stringify(meta)} -->\n# Passaggio di consegne · ${info.title}\n\n${info.text}\n`;
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, body, 'utf8');
    fs.renameSync(tmp, file);
    return { ...info, chatId, path: file };
  }

  read(chatId: string, session?: string): HandoffInfo | null {
    const file = this.pathOf(chatId, session);
    let raw: string;
    try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
    try {
      const m = /^<!-- second-brain (\{.*?\}) -->\n# [^\n]*\n\n([\s\S]*)$/.exec(raw);
      if (!m) return null;
      const meta = JSON.parse(m[1]!) as { at?: unknown; source?: unknown; title?: unknown; contextTokens?: unknown };
      return {
        chatId, path: file, text: m[2]!.trimEnd(),
        at: typeof meta.at === 'number' ? meta.at : 0,
        source: meta.source === 'auto' ? 'auto' : 'chat',
        title: typeof meta.title === 'string' ? meta.title : '',
        ...(typeof meta.contextTokens === 'number' ? { contextTokens: meta.contextTokens } : {}),
      };
    } catch (e) {
      log.warn('chats', 'hand-off file unreadable', { chat: chatId, data: errText(e) });
      return null;
    }
  }
}

/** A rough context size for engines that do not report one (Cursor over ACP): characters / 4. */
export const estimateTokens = (chars: number): number => Math.round(chars / 4);
