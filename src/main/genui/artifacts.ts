// Generative UI, the main half (ADR 0033): the show_ui tool on every chat's own MCP endpoint and the store of the
// visuals it makes ("artifacts", ChatItem kind 'artifact'). A chat passes a catalog component name + props
// (shared/genui.ts checks them: a wrong call gets a clear error back as the tool result, so the model retries); the
// visual becomes an item of the calling chat (target chat), of its Orchestrator (target orchestrator: the Orchestrator's panel shows it with
// the sender's name) or waits for the chat's next AskUserQuestion (target next-ask: attached to it when the question
// arrives, a plain card after ASK_WAIT_MS). Visuals live in <userData>/artifacts/<chatId>.json (at most
// ARTIFACT_MAX_PER_CHAT per chat), so they survive a transcript reload and a restart; chat:items merges them in by time.
// It watches the events main sends to the page (pending:added links, chat:removed forgets), like run/asks.ts.
// Used by wiring.ts and demo-wiring.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { ArtifactTarget, ChatItem, ChatSummary, EventMap } from '../../shared/contract';
import { ARTIFACT_MAX_PER_CHAT, ARTIFACT_TARGETS, SUMMARY_MAX, TITLE_MAX, UI_COMPONENTS, checkUi } from '../../shared/genui';
import type { McpTool } from '../mcp/server';
import { log, errText } from '../log';

export type Artifact = Extract<ChatItem, { kind: 'artifact' }>;
/** how long a next-ask visual waits for the chat's question before it shows as a card in the chat */
export const ASK_WAIT_MS = 60_000;

export interface ArtifactDeps {
  dir: string;                                       // <userData>/artifacts
  chats: () => ChatSummary[];
  emit: (chatId: string, item: ChatItem) => void;    // 'chat:item' to the page
  now?: () => number;
  askWaitMs?: number;
  /** why the card could not show this screenshot (outside the allowed folders, missing, not an image), null when it can */
  imageProblem?: (path: string) => string | null;
  /** where a chat saves screenshots the card can show, named when one is refused */
  evidenceDir?: string;
}

/** The model's id for a visual: short, safe in an item id. */
const KEY = /^[A-Za-z0-9._-]{1,40}$/;
const fileOf = (dir: string, chatId: string) => path.join(dir, `${chatId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);

export class Artifacts {
  private cache = new Map<string, Artifact[]>();
  private timers = new Map<string, NodeJS.Timeout>();
  private n = 0;
  private readonly now: () => number;
  private readonly waitMs: number;

  constructor(private readonly d: ArtifactDeps) {
    this.now = d.now ?? Date.now;
    this.waitMs = d.askWaitMs ?? ASK_WAIT_MS;
  }

  /** show_ui from chat callerId. Returns the tool's answer; throws an Error with a clear message on a wrong call. */
  show(callerId: string, a: Record<string, unknown>): string {
    const all = this.d.chats();
    const caller = all.find(c => c.id === callerId);
    if (!caller) throw new Error('this chat is no longer in the app');
    const title = text(a.title, 'title', TITLE_MAX);
    const summary = text(a.summary, 'summary', SUMMARY_MAX);
    const target = (a.target ?? 'chat') as ArtifactTarget;
    if (!ARTIFACT_TARGETS.includes(target)) throw new Error(`target: expected one of ${ARTIFACT_TARGETS.join(', ')}`);
    const ui = checkUi(a.component, a.props);
    if (ui.ok && ui.spec.component === 'brief' && target !== 'next-ask') throw new Error('brief: only with target "next-ask" (it is the context of your next question)');
    if (!ui.ok) throw new Error(`${ui.error}. Fix the props and call show_ui again (the shapes are in the tool's description).`);
    // a brief's screenshot the card cannot show is sent back now, while the chat can still move it (ADR 0150)
    if (ui.spec.component === 'brief' && this.d.imageProblem) {
      for (const [i, im] of (ui.spec.props.images ?? []).entries()) {
        const why = this.d.imageProblem(im.path);
        if (why) throw new Error(`images[${i}] (${im.path}): ${why} The question card cannot show it. Save the screenshot as PNG, JPG or WebP${this.d.evidenceDir ? ` under ${this.d.evidenceDir}` : ' under your evidence folder'} (or the brain, the app's repo), then call show_ui again with that absolute path.`);
      }
    }
    if (a.id !== undefined && a.id !== null && (typeof a.id !== 'string' || !KEY.test(a.id))) throw new Error('id: 1-40 letters, digits, ".", "_" or "-"');
    const key = typeof a.id === 'string' ? a.id : `${this.now().toString(36)}${++this.n}`;

    let owner = caller.id, where = 'in questa chat';
    if (target === 'orchestrator') {
      const orchestrator = caller.isOrchestrator ? caller.id : all.find(c => c.isOrchestrator && !c.closedAt)?.id;
      if (orchestrator) { owner = orchestrator; where = orchestrator === caller.id ? 'nel pannello dell’Orchestrator' : 'nell’Orchestrator'; }
      else where = 'in questa chat (nessun Orchestrator aperto)';
    }
    // in another chat's list (its Orchestrator) the id carries the sender: two chats with the same key never replace each
    // other; the sender's folder goes along, so its relative file paths open there (review 2026-10-13)
    const away = owner !== caller.id;
    const item: Artifact = {
      kind: 'artifact', id: away ? `art-${caller.id}-${key}` : `art-${key}`, at: this.now(), key, title, summary, ui: ui.spec, target,
      ...(away ? { from: caller.title, cwd: caller.cwd } : {}),
      ...(target === 'next-ask' ? { waiting: true } : {}),
    };
    this.put(owner, item);
    if (target === 'next-ask') {
      where = 'sulla tua prossima domanda (AskUserQuestion)';
      this.arm(owner, item.id);
    }
    log.info('genui', 'visual shown', { chat: caller.id, data: { key, component: ui.spec.component, target, owner } });
    return `Mostrato ${where}: ${ui.spec.component} "${title}" (id ${key}; lo stesso id lo sostituisce). Non vale come risposta dell'utente.`;
  }

  /** The visuals of a chat (waiting next-ask ones included: the page hides them until linked). */
  items(chatId: string): Artifact[] {
    let list = this.cache.get(chatId);
    if (!list) {
      list = this.load(chatId);
      this.cache.set(chatId, list);
    }
    return list.slice();
  }

  /** A brief (ADR 0150) waits for this chat's next question: the question gates ask for one before a yes/no question. */
  hasBrief(chatId: string): boolean {
    return this.items(chatId).some(i => i.waiting && i.ui.component === 'brief');
  }

  /** A chat's items with its visuals put in by time (the chat's own order is kept as it is). */
  merge(chatId: string, base: ChatItem[]): ChatItem[] {
    const arts = this.items(chatId).sort((x, y) => x.at - y.at);
    if (!arts.length) return base;
    const out: ChatItem[] = [];
    let i = 0;
    for (const b of base) {
      while (i < arts.length && arts[i]!.at < b.at) out.push(arts[i++]!);
      out.push(b);
    }
    while (i < arts.length) out.push(arts[i++]!);
    return out;
  }

  /** Events main sends to the page: a question links the chat's waiting visuals; a removed chat's visuals go. */
  observe<K extends keyof EventMap>(channel: K, payload: EventMap[K]): void {
    if (channel === 'pending:added') {
      const p = payload as EventMap['pending:added'];
      if (p.type === 'question') this.link(p.chatId, p.id);
    } else if (channel === 'chat:removed') {
      const { chatId } = payload as EventMap['chat:removed'];
      this.forget(chatId);
    }
  }

  stop(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  private link(chatId: string, requestId: string): void {
    for (const it of this.items(chatId)) {
      if (!it.waiting) continue;
      this.disarm(chatId, it.id);
      const { waiting: _w, ...rest } = it;
      this.put(chatId, { ...rest, askId: requestId });
    }
  }

  /** No question in time: the visual shows as a card in the chat. */
  private arm(chatId: string, itemId: string): void {
    this.disarm(chatId, itemId);
    const t = setTimeout(() => {
      this.timers.delete(`${chatId}/${itemId}`);
      const it = this.items(chatId).find(x => x.id === itemId);
      if (!it?.waiting) return;
      const { waiting: _w, ...rest } = it;
      this.put(chatId, rest);
    }, this.waitMs);
    t.unref?.();
    this.timers.set(`${chatId}/${itemId}`, t);
  }

  private disarm(chatId: string, itemId: string): void {
    const k = `${chatId}/${itemId}`;
    const t = this.timers.get(k);
    if (t) { clearTimeout(t); this.timers.delete(k); }
  }

  /** Adds or replaces (same id: it keeps its place in time) and saves; the oldest beyond the cap go. */
  private put(chatId: string, next: Artifact): void {
    const list = this.items(chatId);
    const at = list.findIndex(x => x.id === next.id);
    // a replaced visual keeps its time: the page replaces it in place, a reload (merge by time) must agree
    const item = at >= 0 ? { ...next, at: list[at]!.at } : next;
    if (at >= 0) list[at] = item;
    else list.push(item);
    while (list.length > ARTIFACT_MAX_PER_CHAT) {
      const old = list.shift()!;
      this.disarm(chatId, old.id);
    }
    this.cache.set(chatId, list);
    this.save(chatId, list);
    this.d.emit(chatId, item);
  }

  private forget(chatId: string): void {
    for (const it of this.cache.get(chatId) ?? []) this.disarm(chatId, it.id);
    this.cache.delete(chatId);
    try { fs.rmSync(fileOf(this.d.dir, chatId), { force: true }); } catch (e) { log.warn('genui', 'could not delete a closed chat\'s visuals', { chat: chatId, cause: errText(e), hint: `delete ${fileOf(this.d.dir, chatId)} by hand` }); }
  }

  private load(chatId: string): Artifact[] {
    const file = fileOf(this.d.dir, chatId);
    let raw: string;
    try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
    try {
      const j = JSON.parse(raw) as unknown;
      if (!Array.isArray(j)) return [];
      // re-checked on the way in (the file is ours, but a visual the page draws must always fit the catalog); a
      // next-ask visual still waiting from an earlier run lost its timer: it shows as a card
      return j.flatMap((x: Artifact) => {
        if (!x || x.kind !== 'artifact' || typeof x.id !== 'string' || typeof x.title !== 'string' || typeof x.summary !== 'string') return [];
        const ui = checkUi(x.ui?.component, x.ui?.props);
        if (!ui.ok) return [];
        const { waiting: _w, ...rest } = x;
        return [{ ...rest, ui: ui.spec }];
      }).slice(-ARTIFACT_MAX_PER_CHAT);
    } catch (e) {
      log.warn('genui', 'visuals file unreadable: ignored', { chat: chatId, cause: errText(e), hint: `the next show_ui of this chat overwrites ${file}` });
      return [];
    }
  }

  private save(chatId: string, list: Artifact[]): void {
    const file = fileOf(this.d.dir, chatId);
    try {
      fs.mkdirSync(this.d.dir, { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(list));
      fs.renameSync(tmp, file);
    } catch (e) {
      log.warn('genui', 'could not save the visuals', { chat: chatId, cause: errText(e), hint: `check that ${this.d.dir} is writable; they still show until the app restarts` });
    }
  }
}

function text(v: unknown, name: string, max: number): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${name}: required, plain text`);
  const s = v.trim();
  if (s.length > max) throw new Error(`${name}: too long (${s.length} chars, max ${max})`);
  return s;
}

export const SHOW_UI_HINT = 'show_ui: prefer it for tables, options, boards, file lists, charts, only when it explains better than text (a status table, a comparison, the changed files), never as decoration; keep it short; it never answers a question or a permission.';

/** show_ui on a chat's own endpoint (/mcp/chat/:chatId/:token: the path names the caller). */
export function showUiTool(store: Artifacts): McpTool {
  return {
    name: 'show_ui',
    description: [
      'Show the user a visual instead of a wall of text: a trusted component of the app\'s catalog, drawn by the app (never HTML). Prefer it for tables, options to choose from, boards (QA test cases, chat status), changed-file lists, charts. Keep it short.',
      'summary = the same content in one or two plain sentences (shown when the visual cannot be drawn). target: chat (default: a card in this chat) · orchestrator (in your Orchestrator\'s panel) · next-ask (attached to your next AskUserQuestion; with no question within 60 s it becomes a card here). The same id again replaces that visual (a board you update). It never answers a question or a permission: still ask with AskUserQuestion.',
      'props per component:',
      'table {columns: string[], rows: [{cells: string[], status?, link?: {label, href}}]}',
      'cards {options: [{title, summary?, pros?: string[], cons?: string[], effort?, risk?: low|medium|high, recommended?: true on one at most}]} (1-6 options)',
      'board {lanes: [{title, status?, items: [{title, detail?, status?, links?: [{label, href}]}]}]}',
      'diffList {groups: [{area, files: [{path, why?, added?, removed?, href?}]}]}',
      'barChart {unit?, bars: [{label, value, note?}]}',
      'status: ok|fail|blocked|running|todo|info|warn. href: an http(s) URL or an absolute local path.',
      'Inside an AskUserQuestion option\'s preview the same JSON {"component", "props", "title"?} goes in a ```sb-ui fence.',
      // screenshots: in the endpoint's instructions (browser/service.ts CHAT_HINTS), the only place this tool is listed
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'optional: your id for this visual (1-40 chars); the same id replaces it' },
        title: { type: 'string', description: `one line, at most ${TITLE_MAX} chars` },
        summary: { type: 'string', description: `plain text, at most ${SUMMARY_MAX} chars: the fallback and the line under the title` },
        component: { type: 'string', enum: [...UI_COMPONENTS] },
        props: { type: 'object', description: 'the component\'s props (see the description)' },
        target: { type: 'string', enum: [...ARTIFACT_TARGETS], description: 'default chat' },
      },
      required: ['title', 'summary', 'component', 'props'],
    },
    run: (args, ctx) => store.show(ctx.params.chatId ?? '', args),
  };
}
