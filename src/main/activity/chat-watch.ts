// Turns the chats' own events (chat:updated, chat:item, pending:added/resolved, on the main Emitter's tap) into the Log's
// task chain (shared/activity-log.ts): a chat opened (who chose the role and why, plus the routing classifier's pick and
// its model), each finished turn (cost, time, tools, tool errors, the input it answered and its last words),
// the requests to the user and who closed them, the delivered result, an independent review and its verdict, the close.
// Pure state machine over app events: no model, no file. Chats already open when the app starts are only remembered.
// Used by activity/wiring.ts; tests: test/unit/activity/chat-watch.test.ts.
import type { ChatItem, ChatSummary, PendingRequest } from '../../shared/contract';
import type { LogInput } from '../../shared/activity-log';

interface Turn { tools: string[]; toolErrors: number; input?: string; output?: string; error?: string }
interface Seen { title: string; who: string; parentId?: string; reportAt: number; verdictAt: number; closedAt: number; lastError: string; runId?: string; reviewOf?: string; orchestrator: boolean }

const CHOSEN_BY: Record<string, string> = { orchestrator: 'Orchestrator', app: 'L’app' };
const OUTCOME: Record<string, string> = { done: 'completato', partial: 'in parte', blocked: 'bloccato' };
const VERIFIED: Record<string, string> = { yes: 'criteri verificati', partial: 'criteri verificati in parte', no: 'criteri non verificati' };
export const VERDICT: Record<string, string> = { success: 'riuscito', partial: 'riuscito in parte', fail: 'non riuscito', unknown: 'non chiaro' };
const BASIS: Record<string, string> = { human: 'da te', 'reviewed-evidence': 'da una revisione', receipts: 'dalle ricevute dei test', 'orchestrator-opinion': 'dall’Orchestrator', 'self-report': 'dall’agente stesso', unknown: '' };
const firstLine = (s: string | undefined) => (s ?? '').split('\n').find(l => l.trim())?.trim() ?? '';

export class ChatWatch {
  private readonly seen = new Map<string, Seen>();
  private readonly turns = new Map<string, Turn>();
  private readonly runChat = new Map<string, string>();
  private readonly requests = new Map<string, PendingRequest>();
  private readonly userAnswered = new Set<string>();
  /** requests open when the user stopped, closed or archived their chat: they end with it, nobody approved them */
  private readonly endedByUser = new Set<string>();

  /** The chats open at start: remembered, never logged again. */
  seed(chats: readonly ChatSummary[]): void {
    for (const c of chats) this.remember(c);
  }

  private remember(c: ChatSummary): Seen {
    const s: Seen = { title: c.title, who: this.who(c), ...(c.parentId ? { parentId: c.parentId } : {}), reportAt: c.run?.report?.at ?? 0,
      verdictAt: c.run?.outcome?.at ?? 0, closedAt: c.closedAt ?? 0, lastError: c.lastError ?? '', ...(c.run ? { runId: c.run.runId } : {}),
      ...(c.run?.reviewOf ? { reviewOf: c.run.reviewOf } : {}), orchestrator: c.isOrchestrator || !!c.quick };
    this.seen.set(c.id, s);
    if (c.run) this.runChat.set(c.run.runId, c.id);
    return s;
  }

  private who(c: ChatSummary): string { return c.isOrchestrator ? 'Orchestrator' : c.agent?.name || c.title; }

  /** The task a chat belongs to: its top chat (a review belongs to the reviewed run's task). */
  rootOf(chatId: string): string {
    let id = chatId;
    for (let i = 0; i < 20; i++) {
      const s = this.seen.get(id); if (!s) break;
      const up = s.parentId ?? (s.reviewOf ? this.runChat.get(s.reviewOf) : undefined);
      if (!up || up === id) break;
      id = up;
    }
    return id;
  }

  private base(c: ChatSummary): Pick<LogInput, 'chatId' | 'rootId' | 'parentId' | 'runId' | 'who' | 'task'> {
    // the Orchestrator and Flash are not a task: their turns go to the stream only
    if (c.isOrchestrator || c.quick) return { chatId: c.id, ...(c.run ? { runId: c.run.runId } : {}), who: this.who(c) };
    const rootId = this.rootOf(c.id);
    return { chatId: c.id, rootId, ...(c.parentId ? { parentId: c.parentId } : {}), ...(c.run ? { runId: c.run.runId } : {}), who: this.who(c), task: this.seen.get(rootId)?.title ?? c.title };
  }

  updated(c: ChatSummary): LogInput[] {
    const out: LogInput[] = [];
    let s = this.seen.get(c.id);
    if (!s) {
      s = this.remember(c);
      if (!s.orchestrator) out.push(...this.opened(c));
    }
    s.title = c.title; s.who = this.who(c);
    if (c.run) { this.runChat.set(c.run.runId, c.id); s.runId = c.run.runId; if (c.run.reviewOf) s.reviewOf = c.run.reviewOf; }
    const base = this.base(c);
    const report = c.run?.report;
    if (report && report.at > s.reportAt) {
      s.reportAt = report.at;
      if (report.verdict) {
        out.push({ ...base, kind: 'task', step: 'verdict', level: report.verdict === 'fail' ? 'warn' : 'ok', title: `Verifica: ${VERDICT[report.verdict]}`, text: report.summary, verdict: report.verdict, ...(c.run?.reviewOf ? { reviewOf: c.run.reviewOf } : {}) });
      } else {
        out.push({ ...base, kind: 'task', step: 'result', level: report.outcome === 'blocked' ? 'warn' : 'ok', title: `${s.who}: risultato consegnato (${OUTCOME[report.outcome] ?? report.outcome})`,
          text: [report.summary, VERIFIED[report.verified]].filter(Boolean).join(' · '), output: report.canonical?.summary ?? report.summary });
      }
    }
    const outcome = c.run?.outcome;
    if (outcome && outcome.at > s.verdictAt) {
      s.verdictAt = outcome.at;
      if (outcome.verdict !== 'unknown' || outcome.basis !== 'unknown') {
        const by = BASIS[outcome.basis] ?? '';
        out.push({ ...base, kind: 'task', step: 'verdict', level: outcome.verdict === 'fail' ? 'warn' : outcome.verdict === 'unknown' ? 'info' : 'ok', title: `Verifica: ${VERDICT[outcome.verdict] ?? outcome.verdict}${by ? ` ${by}` : ''}`, text: outcome.note, verdict: outcome.verdict });
      }
    }
    if (c.lastError && c.lastError !== s.lastError) out.push({ ...base, kind: 'task', level: 'error', title: `${s.who}: errore`, error: c.lastError });
    s.lastError = c.lastError ?? '';
    if (c.closedAt && c.closedAt !== s.closedAt) {
      s.closedAt = c.closedAt;
      if (!s.orchestrator) out.push({ ...base, kind: 'task', step: 'closed', level: 'info', title: c.closedBy === 'auto' ? `${s.who}: chiusa da sola, finito il lavoro` : `${s.who}: chiusa da te` });
    } else if (!c.closedAt) s.closedAt = 0;
    return out;
  }

  private opened(c: ChatSummary): LogInput[] {
    const base = this.base(c), out: LogInput[] = [];
    const parent = c.parentId ? this.seen.get(c.parentId) : undefined;
    const chooser = parent?.who ?? CHOSEN_BY[c.run?.startedBy ?? (c.route?.agent?.chosenBy ?? 'user')];
    const goal = c.delegation?.goal ?? c.run?.goal;
    const reason = c.route?.reason ?? (c.delegation ? `Delegato: ${firstLine(c.delegation.goal)}` : null);
    if (c.run?.reviewOf) {
      out.push({ ...base, kind: 'task', step: 'review', level: 'info', title: `${base.who} apre una revisione indipendente`, text: firstLine(goal), input: goal, reviewOf: c.run.reviewOf });
    } else {
      out.push({ ...base, kind: 'task', step: 'open', level: 'info', title: chooser ? `${chooser} sceglie ${base.who}` : `Hai scelto ${base.who}`, text: reason ?? (goal ? firstLine(goal) : undefined), input: goal ?? undefined });
    }
    const r = c.route;
    if (r) {
      const model = c.model ? ` · ${c.model}` : '';
      const SOURCE: Record<string, string> = { table: 'dalla tabella', default: 'scelta di base', override: 'scelta a mano', explore: 'in prova', agent: 'dal ruolo' };
      out.push({ ...base, kind: 'classifier', level: 'info', title: `Classificatore: ${r.kind}${r.area ? ` / ${r.area}` : ''} → ${c.harness}${model}`, text: [SOURCE[r.source], r.reason].filter(Boolean).join(' · ') });
    }
    return out;
  }

  item(chatId: string, item: ChatItem, chat: ChatSummary | undefined): LogInput[] {
    const t = this.turns.get(chatId) ?? { tools: [], toolErrors: 0 };
    this.turns.set(chatId, t);
    switch (item.kind) {
      case 'user': t.input = item.text; return [];
      case 'assistant': if (!item.streaming && item.text.trim()) t.output = item.text; return [];
      case 'tool':
        if (item.status === 'running') { if (!t.tools.includes(item.name)) t.tools.push(item.name); }
        else if (item.status === 'error') { t.toolErrors++; if (!t.tools.includes(item.name)) t.tools.push(item.name); t.error ??= `${item.name}: ${item.output ?? item.summary}`; }
        return [];
      case 'system': if (item.level === 'error') t.error = item.text; return [];
      case 'result': {
        this.turns.delete(chatId);
        if (!chat) return [];
        if (!this.seen.has(chatId)) this.remember(chat);
        const who = this.who(chat);
        const tools = t.tools.length ? ` · ${t.tools.length} ${t.tools.length === 1 ? 'strumento' : 'strumenti'}` : '';
        const title = item.interrupted ? `${who}: fermato da te` : item.isError ? `${who}: turno finito con un errore` : `${who} ha lavorato${tools}`;
        return [{ ...this.base(chat), kind: 'task', step: 'work', level: item.isError ? 'error' : t.toolErrors ? 'warn' : 'ok', title,
          costUsd: item.costUsd, ms: item.durationMs, ...(t.tools.length ? { tools: t.tools } : {}), ...(t.toolErrors ? { toolErrors: t.toolErrors } : {}),
          ...(t.input ? { input: t.input } : {}), ...(t.output ? { output: t.output } : {}), ...(t.error || item.isError ? { error: t.error ?? 'Il motore ha chiuso il turno con un errore.' } : {}) }];
      }
      default: return [];
    }
  }

  /** The user answered this request (chat:answer from the window). */
  answeredByUser(chatId: string, requestId: string): void { this.userAnswered.add(`${chatId}/${requestId}`); }
  /** The answer failed: the request was not closed by it. */
  notAnswered(chatId: string, requestId: string): void { this.userAnswered.delete(`${chatId}/${requestId}`); }
  /** The user stopped, closed or archived a chat (every chat when chatId is missing): its open requests end with it. */
  stoppedByUser(chatId?: string): void {
    for (const key of this.requests.keys()) if (!chatId || key.startsWith(`${chatId}/`)) this.endedByUser.add(key);
  }

  pendingAdded(p: PendingRequest, chat: ChatSummary | undefined): LogInput[] {
    if (p.type === 'command' || !chat) return [];
    this.requests.set(`${p.chatId}/${p.id}`, p);
    const who = this.who(chat);
    return [{ ...this.base(chat), kind: 'task', step: 'request', level: 'warn', title: p.type === 'permission' ? `${who} chiede il permesso: ${p.tool}` : `${who} ti fa una domanda`,
      text: p.title, input: p.detail, reqId: p.id, reqType: p.type }];
  }

  pendingResolved(chatId: string, requestId: string, chat: ChatSummary | undefined): LogInput[] {
    const key = `${chatId}/${requestId}`, p = this.requests.get(key);
    this.requests.delete(key);
    if (!p || !chat) return [];
    const byUser = this.userAnswered.delete(key);
    // ended with its chat (the user's Stop, close or archive, or the chat already gone): nobody approved it
    const ended = !byUser && (this.endedByUser.delete(key) || !!chat.closedAt || chat.state === 'closed');
    this.endedByUser.delete(key);
    const who = this.who(chat);
    const reqType = p.type === 'permission' ? 'permission' as const : 'question' as const;
    const what = p.type === 'permission' ? `Permesso di ${who} chiuso` : `Domanda di ${who} chiusa`;
    return [{ ...this.base(chat), kind: 'task', step: 'resolved', level: byUser ? 'ok' : ended ? 'info' : p.type === 'permission' ? 'warn' : 'info',
      title: byUser ? (p.type === 'permission' ? `Hai risposto al permesso di ${who}` : `Hai risposto a ${who}`) : ended ? `${what} insieme alla chat` : `${what} senza la tua risposta`,
      text: p.title, reqId: p.id, reqType, by: byUser ? 'user' : ended ? 'ended' : 'other' }];
  }

  removed(chatId: string): void {
    this.turns.delete(chatId); this.seen.delete(chatId);
    for (const [run, id] of this.runChat) if (id === chatId) this.runChat.delete(run);
    for (const set of [this.requests, this.userAnswered, this.endedByUser]) for (const key of set.keys()) if (key.startsWith(`${chatId}/`)) set.delete(key);
  }
}
