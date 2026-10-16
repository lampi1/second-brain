// What a question or permission needs around it (the user, 2026-10-12: "quando mi fai le domande voglio sempre il
// contesto e il contenuto ... o il link dei report o pr"): the prose the chat wrote for the request (since the
// previous question it asked in the same turn, never that one's reasoning), whether it asks again the question just
// answered, the links it named (web pages, PRs, local files: file:///, C:\…, /Users/…) and the documents it wrote (Write/Edit of a
// report, a screenshot). Also which "Ragionamento" blocks hold the only prose before a question: models often write
// what they mean to ask about only in their reasoning, and the transcript must not fold it away (transcripts of
// 2026-10-11/12: 128 questions of 177 had no visible text before them). Pure: used by RequestPanel.tsx (the "Contesto"
// block) and ChatItems.tsx (thinking shown open); pinned by test/unit/askContext.test.ts.
import type { ChatItem, PendingRequest } from '@shared/contract';
import { LOCAL_START } from './pathPatterns';

export interface ContextPiece { id: string; kind: 'text' | 'thinking'; text: string }
export interface ContextLink { kind: 'web' | 'file'; href: string; label: string }
/** again: the chat asks once more the question the user just answered (often after a free answer it replied to only
 *  in its reasoning); answer = what the user wrote then ('' when the result is not readable) */
export interface AskContext { pieces: ContextPiece[]; links: ContextLink[]; again?: { answer: string } }

/** Tools that ask the user (Claude's AskUserQuestion, Cursor's question and plan asks). */
const ASK_TOOLS = /^(AskUserQuestion|AskQuestion|ExitPlanMode|CreatePlan)$/;
/** Files a chat writes that the user may want to open from the question (never source code). */
const DOC_EXT = /\.(md|txt|html?|pdf|png|jpe?g|gif|webp|csv|xlsx|docx|pptx|log)$/i;
const MAX_PIECES = 4;
const MAX_CHARS = 12_000;
const MAX_LINKS = 12;

/** The items of the current turn: after the user's last message. */
export function turnItems(items: readonly ChatItem[] | undefined): readonly ChatItem[] {
  if (!items?.length) return [];
  let from = items.length;
  while (from > 0 && items[from - 1]!.kind !== 'user') from--;
  return items.slice(from);
}

const trimUrl = (u: string) => u.replace(/[.,;:!?'"»)\]]+$/, '');
const MD_LINK = /\[([^\]\n]{1,120})\]\(\s*<?((?:https?|file):[^)\s>]+)>?\s*\)/gi;
const URL_RE = /\b(?:https?:\/\/|file:\/\/\/)[^\s<>"'`)\]]+/gi;
// C:\x\y.md, C:/x/y.md or /Users/x/y.md (pathPatterns.ts; spaces end a path: a path with spaces is caught only as a
// markdown link or a file:/// URL)
const LOCAL_PATH = new RegExp(String.raw`(?<![\w/\\])${LOCAL_START}[^\s<>"'\`|*?]+\.[A-Za-z0-9]{1,6}\b`, 'g');

function webLabel(href: string): string {
  try {
    const u = new URL(href);
    const pr = u.pathname.match(/\/pullrequest\/(\d+)/i) ?? u.pathname.match(/\/pull\/(\d+)/i);
    if (pr) return `PR ${pr[1]}`;
    const wi = u.pathname.match(/\/_workitems\/edit\/(\d+)/i) ?? u.searchParams.get('workitem')?.match(/^(\d+)$/);
    if (wi) return `Work item ${wi[1]}`;
    const tail = u.pathname.split('/').filter(Boolean).slice(-1)[0];
    return tail ? `${u.host} · ${decodeURIComponent(tail).slice(0, 40)}` : u.host;
  } catch { return href.slice(0, 60); }
}
const baseName = (p: string) => p.replace(/^file:\/+/i, '').split(/[\\/]/).filter(Boolean).pop() ?? p;
const fileLabel = (p: string) => { try { return decodeURIComponent(baseName(p)); } catch { return baseName(p); } };
const fileKey = (p: string) => { let x = p.replace(/^file:\/+/i, ''); try { x = decodeURIComponent(x); } catch { /* as is */ } return x.replace(/\//g, '\\').toLowerCase(); };

/** Every link named in these texts, in order, without repeats: markdown links keep their text as the label. */
export function linksIn(texts: readonly string[], written: readonly string[] = []): ContextLink[] {
  const out: ContextLink[] = [];
  const seen = new Set<string>();
  const add = (kind: ContextLink['kind'], href: string, label: string) => {
    const k = kind === 'file' ? fileKey(href) : href;
    if (seen.has(k) || out.length >= MAX_LINKS) return;
    seen.add(k);
    out.push({ kind, href, label });
  };
  for (const t of texts) {
    for (const m of t.matchAll(MD_LINK)) {
      const href = trimUrl(m[2]!);
      add(/^file:/i.test(href) ? 'file' : 'web', href, m[1]!.replace(/[`*_]/g, '').trim() || href);
    }
    for (const m of t.matchAll(URL_RE)) {
      const href = trimUrl(m[0]);
      if (/^file:/i.test(href)) add('file', href, fileLabel(href)); else add('web', href, webLabel(href));
    }
    for (const m of t.matchAll(LOCAL_PATH)) add('file', trimUrl(m[0]), fileLabel(m[0]));
  }
  for (const p of written) add('file', p, fileLabel(p));
  return out;
}

const pathOf = (input: unknown): string => {
  if (!input || typeof input !== 'object') return '';
  const i = input as Record<string, unknown>;
  for (const k of ['file_path', 'filePath', 'path', 'notebook_path']) if (typeof i[k] === 'string') return i[k] as string;
  return '';
};

/** The documents the turn wrote (Write/Edit of a report, a screenshot saved), absolute paths only. */
export function writtenDocs(turn: readonly ChatItem[]): string[] {
  const out: string[] = [];
  for (const it of turn) {
    if (it.kind !== 'tool' || it.status === 'error' || !/^(Write|Edit|MultiEdit|edit|write)$/i.test(it.name.replace(/^mcp__.*__/, ''))) continue;
    const p = pathOf(it.input);
    if ((/^[a-zA-Z]:[\\/]/.test(p) || /^\/[^/]/.test(p)) && DOC_EXT.test(p)) out.push(p);
  }
  return out;
}

/** The text of a request itself (question, options, previews, permission detail): links named only there count too. */
export function requestTexts(req: PendingRequest): string[] {
  const out = [req.title, req.detail];
  for (const q of req.questions ?? []) {
    out.push(q.question);
    for (const o of q.options) out.push(o.label, o.description ?? '', o.preview ?? '');
  }
  return out.filter(Boolean);
}

const askedTexts = (input: unknown): string => {
  const qs = (input as { questions?: unknown } | null)?.questions;
  return Array.isArray(qs) ? qs.map(q => String((q as { question?: unknown })?.question ?? '')).join('\n') : '';
};
/** The user's answer as the CLI wrote it in the ask's result: `"question"="answer"` pairs. */
const answerIn = (output: string | undefined): string =>
  [...(output ?? '').matchAll(/"(?:[^"\\]|\\.)*"="((?:[^"\\]|\\.)*)"/g)].map(m => m[1]!).join(' · ');

/** The part of the turn that belongs to this request: after the previous ask the user answered in the same turn
 *  (its reasoning was about that question: the user, 2026-10-13, "con il ragionamento della domanda precedente") and
 *  up to the request's own tool row. `prevAsk`: that previous ask, when there is one. */
export function requestItems(items: readonly ChatItem[] | undefined, req: PendingRequest): { span: readonly ChatItem[]; turn: readonly ChatItem[]; prevAsk: Extract<ChatItem, { kind: 'tool' }> | null } {
  const all = turnItems(items);
  const ownId = req.toolUseId ? `t-${req.toolUseId}` : null;
  const own = ownId ? all.findIndex(it => it.id === ownId) : -1;
  const turn = own >= 0 ? all.slice(0, own) : all;
  for (let i = turn.length - 1; i >= 0; i--) {
    const it = turn[i]!;
    // a running ask row is the request itself (Cursor carries no tool_use id): not a boundary
    if (it.kind === 'tool' && ASK_TOOLS.test(it.name) && it.status !== 'running') return { span: turn.slice(i + 1), turn, prevAsk: it };
  }
  return { span: turn, turn, prevAsk: null };
}

/** The context of a request from its chat's items: its own prose pieces (newest last), every link of the turn, and,
 *  when the chat asks again the question just answered, what the user answered then. */
export function askContext(items: readonly ChatItem[] | undefined, req: PendingRequest): AskContext {
  const { span, turn, prevAsk } = requestItems(items, req);
  const prose: ContextPiece[] = [];
  for (const it of span) {
    if (it.kind === 'assistant' && it.text.trim()) prose.push({ id: it.id, kind: 'text', text: it.text });
    else if (it.kind === 'thinking' && it.text.trim()) prose.push({ id: it.id, kind: 'thinking', text: it.text });
  }
  // the newest pieces, as much as fits (the oldest piece kept may be cut at its start)
  const pieces: ContextPiece[] = [];
  let room = MAX_CHARS;
  for (const p of prose.slice(-MAX_PIECES).reverse()) {
    if (room <= 0) break;
    pieces.unshift(p.text.length > room ? { ...p, text: `…${p.text.slice(-room)}` } : p);
    room -= p.text.length;
  }
  // links and documents: the whole turn (a report written before an earlier question is still what this one is about)
  const turnProse = turn.flatMap(it => ((it.kind === 'assistant' || it.kind === 'thinking') && it.text.trim() ? [it.text] : []));
  const links = linksIn([...turnProse, ...requestTexts(req)], writtenDocs(turn));
  const asked = req.questions?.map(q => q.question).join('\n') ?? '';
  const again = prevAsk && asked && askedTexts(prevAsk.input) === asked ? { answer: answerIn(prevAsk.output) } : null;
  return { pieces, links, ...(again ? { again } : {}) };
}

/** Thinking blocks right before a question (no answer text nor another tool between them and the ask): shown open.
 *  `asking`: the chat has an open question now (Cursor asks without a tool row): the end of the list counts as an ask. */
export function thinkingBeforeAsk(items: readonly ChatItem[], asking: boolean): Set<string> {
  const out = new Set<string>();
  const walkBack = (from: number) => {
    for (let i = from; i >= 0; i--) {
      const it = items[i]!;
      // another tool in between: that reasoning was about the tool, not the question
      if (it.kind === 'user' || (it.kind === 'assistant' && it.text.trim()) || (it.kind === 'tool' && !ASK_TOOLS.test(it.name))) return;
      if (it.kind === 'thinking' && it.text.trim()) out.add(it.id);
    }
  };
  items.forEach((it, i) => { if (it.kind === 'tool' && ASK_TOOLS.test(it.name)) walkBack(i - 1); });
  if (asking) walkBack(items.length - 1);
  return out;
}
