// The chats side of the phone bridge (shared/contract/phone.ts PhonePort): what the Telegram bridge (src/main/phone)
// may see and decide. Why: the phone is the owner away from the PC, but a weaker channel (design §5.5): its free text
// informs the Orchestrator (source {kind:'phone'}), which answers for him (ADR 0275), and its buttons decide a simple
// Sì/No question or a proposed Strategist plan, a permission one of the user's own brain rules sent to them (ADR 0254:
// Sì allows it once), and a command left by a chat that the phone shows whole (ADR 0259 §4, 0275: Sì runs it on the PC,
// production included, since he saw it; No lets it go). Anything else the Orchestrator answers when he tells it. A question shows the same
// parts as the PC's card (ask-text.ts questionLines). Every decision is checked again against the live chat when it arrives.
// Built by the integrator in main's wiring with the ChatManager and the main Emitter; tests: test/unit/chats/phone.test.ts.
import { SYS_IT } from '../../shared/sys';
import type { Answer, ChatItem, ChatSummary, EventChannel, EventMap, PendingRequest } from '../../shared/contract';
import type { PhoneDecidable, PhoneDecideResult, PhonePort, PhoneOutcome } from '../../shared/contract/phone';
import { reservedText } from '../../shared/away';
import { isYesNo, yesNoOf } from '../../shared/yes-no';
import { errText, log } from '../log';
import { briefFor, commandLines, commandShownWhole, questionLines } from './ask-text';
import type { TurnEndInfo } from './manager-types';

/** What the port needs from the ChatManager (structural, so tests pass a fake). */
export interface PhoneChats {
  list(): ChatSummary[];
  pending(): PendingRequest[];
  /** a chat's items: a question's brief (show_ui next-ask, artifact askId) is read for reserved words */
  items(chatId: string): ChatItem[];
  /** the user's message from the phone: source {kind:'phone'}, 📱 on its bubble, the phone reply hint */
  sendFromPhone(chatId: string, text: string, voice: boolean): Promise<void>;
  answer(chatId: string, requestId: string, answer: Answer, by: 'pc' | 'phone'): Promise<void>;
  planDecide(chatId: string, decision: 'approve' | 'change', at: number, text: string | undefined, by: 'pc' | 'phone'): Promise<void>;
  onTurnEnded(fn: (info: TurnEndInfo) => void): () => void;
}
/** the commands the chats left (run/asks.ts): Sì runs one on the PC, No puts it aside; absent = commands stay on the PC */
export interface PhoneCommands {
  pending(): PendingRequest[];
  /** confirmProd: the user saw the whole command and said yes to it (ADR 0275), the second click production needs */
  run(chatId: string, requestId: string, confirmProd?: boolean): void;
  dismiss(chatId: string, requestId: string): void;
}
/** The main Emitter's tap (main/ipc.ts Emitter.tap). */
export interface PhoneEvents { tap(fn: <K extends EventChannel>(channel: K, payload: EventMap[K]) => void): void }

/** The engines' own question tools (as appctl/user-words.ts): an MCP tool's question (a workflow or learning proposal,
 *  anything an agent built) is never decided from the phone. */
const NATIVE_QUESTIONS = new Set(['AskUserQuestion', 'AskQuestion', 'AskUser']);
const MARK = /\((consigliat[oa]|recommended|empfohlen)\)/i;
/** what the Strategist gets when the phone says No to its plan: nothing to change yet, the user looks at it on the PC */
export const PHONE_PLAN_NO = 'Non approvato dal telefono: l\'utente rivede il piano al PC. Non partire e non riproporlo finché non ti scrive.';
/** answers remembered so a late button says «già risposto» ('already') instead of «non c'è più» */
const RESOLVED_KEEP = 500;

const qKey = (chatId: string, requestId: string) => `${chatId}/q/${requestId}`;
const pKey = (chatId: string, at: string) => `${chatId}/p/${at}`;
const closed = (c: ChatSummary) => !!c.closedAt || c.state === 'closed';

export function phoneQuestionReserved(p: PendingRequest, readItems: () => ChatItem[], reserved: (text: string) => boolean = reservedText): boolean {
  const qs = p.questions ?? [];
  let items: ChatItem[];
  try { items = readItems(); } catch { return true; }
  const brief = items.flatMap(i => {
    if (i.kind !== 'artifact' || i.askId !== p.id || i.ui.component !== 'brief') return [];
    const b = i.ui.props;
    return [i.title, i.summary, ...b.done, b.ifYes, b.ifNo, b.why ?? '', ...(b.todo ?? []), b.yesLabel ?? '', b.noLabel ?? '', b.yesOption ?? '', b.noOption ?? '', ...(b.yesSteps ?? []), ...(b.noSteps ?? []),
      ...(b.change ? [b.change.what ?? '', b.change.before, b.change.after] : []), ...(b.checks ?? []).flatMap(c => [c.label, c.detail ?? '']),
      ...(b.files ?? []).flatMap(x => [x.path, x.why ?? '']), ...(b.images ?? []).map(x => x.caption ?? '')];
  });
  const words = [p.title, p.detail, ...qs.flatMap(x => [x.question, x.header ?? '', ...x.options.flatMap(o => [o.label, o.description ?? ''])]), ...brief];
  return p.type !== 'question' || !NATIVE_QUESTIONS.has(p.tool) || reserved(words.join('\n'));
}

export function createPhonePort(chats: PhoneChats, events: PhoneEvents, commands?: PhoneCommands): PhonePort {
  const labels = new Map<string, string>();
  let nextLabel = 0;
  const shown = new Map<string, PhoneDecidable>();
  const resolved = new Set<string>();
  /** plans decided from the phone: their resolved event (chat:updated, maybe later) says by 'phone' */
  const deciding = new Set<string>();
  const listeners: ((ev: { type: 'added' | 'resolved'; item: PhoneDecidable; by?: 'phone' | 'pc' }) => void)[] = [];
  const outcomes = new Set<(outcome: PhoneOutcome) => void>();

  const neutral = (c: ChatSummary): string => {
    if (c.isOrchestrator) return 'Orchestrator';
    let l = labels.get(c.id);
    if (!l) { l = `lavoro ${++nextLabel}`; labels.set(c.id, l); }
    return l;
  };
  const role = (c: ChatSummary): string => c.agent?.name ?? (c.isOrchestrator ? 'Orchestrator' : 'Chat');
  const chatOf = (chatId: string) => chats.list().find(c => c.id === chatId);

  function ofRequest(p: PendingRequest, c: ChatSummary): PhoneDecidable {
    const qs = p.questions ?? [];
    const q = qs[0];
    // a permission one of the user's brain rules sent to them (ADR 0254): Sì allows it once, No refuses it
    if (p.type === 'permission' && p.heldBy) {
      return { chatId: c.id, ref: { kind: 'question', requestId: p.id }, role: role(c), neutralLabel: neutral(c),
        text: [`Permesso (regola «${p.heldBy.rule}»: ${p.heldBy.why})`, p.title, p.detail, 'Sì\nNo'].filter(Boolean).join('\n'), simple: true, reserved: false, orchestrator: true };
    }
    if (p.type === 'command' && p.command) {
      const text = commandLines(p, role(c)).join('\n');
      return { chatId: c.id, ref: { kind: 'question', requestId: p.id }, role: role(c), neutralLabel: neutral(c), text,
        // the short form only when it holds the whole command: a decision is never taken on a cut text
        ...(p.command.code.includes('\n') ? {} : { short: `Eseguo sul PC? ${p.command.code}` }), recommended: 'yes', simple: !!commands && commandShownWhole(p), reserved: false, orchestrator: true };
    }
    const simple = p.type === 'question' && NATIVE_QUESTIONS.has(p.tool) && qs.length === 1 && !!q && isYesNo(q);
    // nothing is reserved any more (ADR 0275): the owner decides from the phone what he decides on the PC
    const reserved = false;
    const pick = simple ? q!.options.find(o => MARK.test(o.label)) : undefined;
    const recommended = pick ? yesNoOf(pick.label) ?? undefined : undefined;
    // a question with its brief: the same parts as the PC's card (ADR 0259 §4)
    let brief;
    try { brief = simple ? briefFor(p, chats.items(p.chatId)) : undefined; } catch { brief = undefined; }
    // the engines put the question in the title and the detail too: each line once, so it fits the phone (#370)
    const lines = brief ? questionLines(q!.question, brief)
      : [p.title, p.detail, ...qs.flatMap(q => [q.question, ...q.options.map(o => `${o.label}${o.description ? `: ${o.description}` : ''}`)])];
    const text = [...new Set(lines.flatMap(l => (l ?? '').split('\n')).map(l => l.trim()).filter(Boolean))].join('\n');
    return { chatId: c.id, ref: { kind: 'question', requestId: p.id }, role: role(c), neutralLabel: neutral(c),
      text, ...(simple ? { short: q!.question } : {}), ...(recommended ? { recommended } : {}), simple, reserved, orchestrator: true };
  }

  function ofPlan(c: ChatSummary): PhoneDecidable | null {
    const plan = c.plan;
    if (!plan || plan.phase !== 'proposed') return null;
    const text = [...plan.steps.map((s, i) => `${i + 1}. ${s.title}${s.detail ? ` · ${s.detail}` : ''}`), ...(plan.doneWhen ? [`Fatto quando: ${plan.doneWhen}`] : [])].join('\n');
    // ADR 0275: a plan is answered from the phone like on the PC, whatever its steps do (only prod/DB/Azure commands wait for his whole-command yes)
    return { chatId: c.id, ref: { kind: 'plan', at: String(plan.at) }, role: role(c), neutralLabel: neutral(c), text,
      simple: true, reserved: false, orchestrator: true };
  }

  const keyOf = (d: PhoneDecidable) => d.ref.kind === 'question' ? qKey(d.chatId, d.ref.requestId) : pKey(d.chatId, d.ref.at);
  const tell = (ev: { type: 'added' | 'resolved'; item: PhoneDecidable; by?: 'phone' | 'pc' }) => {
    for (const fn of listeners) { try { fn(ev); } catch (e) { log.warn('phone', 'decidable listener failed', { cause: errText(e), hint: 'the phone may miss this request' }); } }
  };
  const add = (d: PhoneDecidable) => { const k = keyOf(d); if (shown.has(k) || resolved.has(k)) return; shown.set(k, d); tell({ type: 'added', item: d }); };
  const drop = (k: string, by: 'phone' | 'pc') => {
    const d = shown.get(k);
    if (!d) return;
    shown.delete(k);
    resolved.add(k);
    if (resolved.size > RESOLVED_KEEP) resolved.delete(resolved.values().next().value!);
    tell({ type: 'resolved', item: d, by });
  };

  events.tap((ch, payload) => {
    if (ch === 'chat:item') {
      const p = payload as EventMap['chat:item'];
      if (p.item.kind === 'system' && p.item.code === 'resultReady' && p.item.result && chatOf(p.chatId)?.isOrchestrator) {
        const r = p.item.result;
        for (const listener of outcomes) listener({ runId: r.runId, revision: r.at, text: `Orchestrator · Risultato di ${String(p.item.params?.role ?? '')} (testo dell’agente)\n${r.summary}\n\n${r.output}` });
      }
      // a step only the user can do (ADR 0269): the same plain message as on the PC, no buttons («fatto» answers it)
      if (p.item.kind === 'system' && p.item.code === 'userStep' && chatOf(p.chatId)?.isOrchestrator) {
        const q = p.item.params ?? {};
        const text = SYS_IT['sys.userStep']({ title: String(q.title ?? ''), text: String(q.text ?? ''), ...(q.command ? { command: String(q.command) } : {}) });
        for (const listener of outcomes) listener({ runId: p.item.id, revision: p.item.at, text: `Orchestrator · ${text}` });
      }
    } else if (ch === 'pending:added') {
      const p = payload as EventMap['pending:added'], c = chatOf(p.chatId);
      if (c && !closed(c)) add(ofRequest(p, c));
    } else if (ch === 'pending:resolved') {
      const p = payload as EventMap['pending:resolved'];
      drop(qKey(p.chatId, p.requestId), p.by === 'phone' ? 'phone' : 'pc');
    } else if (ch === 'chat:updated') {
      const c = payload as ChatSummary;
      const plan = closed(c) ? null : ofPlan(c), live = plan ? keyOf(plan) : null;
      for (const [k, d] of [...shown]) {
        if (d.chatId !== c.id) continue;
        if (d.ref.kind === 'plan' && k !== live) { drop(k, deciding.has(k) ? 'phone' : 'pc'); deciding.delete(k); }
        else if (d.ref.kind === 'question' && closed(c)) drop(k, 'pc');
      }
      if (plan) add(plan);
    } else if (ch === 'chat:removed') {
      const { chatId } = payload as EventMap['chat:removed'];
      for (const [k, d] of [...shown]) if (d.chatId === chatId) drop(k, 'pc');
    }
  });

  function listDecidable(): PhoneDecidable[] {
    const list = chats.list().filter(c => !closed(c)), byId = new Map(list.map(c => [c.id, c]));
    const out: PhoneDecidable[] = [];
    for (const p of [...chats.pending(), ...(commands?.pending() ?? [])]) { const c = byId.get(p.chatId); if (c) out.push(ofRequest(p, c)); }
    for (const c of list) { const d = ofPlan(c); if (d) out.push(d); }
    return out;
  }

  async function answerFromPhone(chatId: string, requestId: string, yes: boolean): Promise<PhoneDecideResult> {
    const k = qKey(chatId, requestId);
    const c = chatOf(chatId), p = chats.pending().find(x => x.chatId === chatId && x.id === requestId);
    if (!p) return commandFromPhone(chatId, requestId, yes);
    if (!c || closed(c)) return 'gone';
    // the same rules as the list, on the request as it is now
    const d = ofRequest(p, c), q = p.questions?.[0];
    if (!d.simple || d.reserved) return 'gone';
    const held = p.type === 'permission' && !!p.heldBy;
    const option = held ? undefined : q?.options.find(o => yesNoOf(o.label) === (yes ? 'yes' : 'no'));
    if (!held && (!q || !option)) return 'gone';
    try {
      await chats.answer(chatId, requestId, held
        ? { kind: 'permission', allow: yes, ...(yes ? {} : { message: 'The user said no from the phone. Go on with the rest of the work without it.' }) }
        : { kind: 'question', answers: { [q!.question]: option!.label } }, 'phone');
      return 'ok';
    } catch (e) {
      // answered on the PC in the meantime (or the chat ended with it)
      if (!chats.pending().some(x => x.chatId === chatId && x.id === requestId)) return resolved.has(k) ? 'already' : 'gone';
      log.warn('phone', 'answer from the phone failed', { chat: chatId, cause: errText(e), hint: 'the question stays open on the PC' });
      return 'gone';
    }
  }

  /** Sì on a command: it runs on the PC (main's runner, the same checks as Esegui; production never: no second click
   *  from here); No puts it aside. Checked again on the request as it is now. */
  function commandFromPhone(chatId: string, requestId: string, yes: boolean): PhoneDecideResult {
    const k = qKey(chatId, requestId), cmds = commands;
    const c = chatOf(chatId), p = cmds?.pending().find(x => x.chatId === chatId && x.id === requestId);
    if (!cmds || !p) return resolved.has(k) ? 'already' : 'gone';
    if (!c || closed(c)) return 'gone';
    // he sees the whole command before his Sì: production included, that Sì is his second click (ADR 0275)
    if (!commandShownWhole(p)) return 'gone';
    try {
      if (yes) cmds.run(chatId, requestId, true); else cmds.dismiss(chatId, requestId);
      log.info('phone', yes ? 'command run from the phone' : 'command put aside from the phone', { chat: chatId, data: { request: requestId } });
      return 'ok';
    } catch (e) {
      log.warn('phone', 'command from the phone failed', { chat: chatId, cause: errText(e), hint: 'the command stays on the PC with its Esegui' });
      return 'gone';
    }
  }

  async function decidePlanFromPhone(chatId: string, at: string, approve: boolean): Promise<PhoneDecideResult> {
    const k = pKey(chatId, at), c = chatOf(chatId);
    if (!c || closed(c)) return 'gone';
    const d = ofPlan(c);
    if (!d) return resolved.has(k) ? 'already' : 'gone';
    // a plan proposed again since the phone saw it: the phone's button is about the old one
    if (d.ref.kind !== 'plan' || d.ref.at !== at) return resolved.has(k) ? 'already' : 'gone';
    if (d.reserved) return 'gone';
    deciding.add(k);
    try {
      await chats.planDecide(chatId, approve ? 'approve' : 'change', c.plan!.at, approve ? undefined : PHONE_PLAN_NO, 'phone');
      return 'ok';
    } catch (e) {
      deciding.delete(k);
      const now = chatOf(chatId)?.plan;
      if (!now || now.phase !== 'proposed' || String(now.at) !== at) return resolved.has(k) ? 'already' : 'gone';
      log.warn('phone', 'plan decision from the phone failed', { chat: chatId, cause: errText(e), hint: 'the plan stays on its strip for the PC' });
      return 'gone';
    }
  }

  async function sendFromPhone(text: string, opts: { voice: boolean }): Promise<{ queued: boolean }> {
    const all = chats.list().filter(c => c.isOrchestrator);
    // the open Orchestrator; with none, the latest one (the phone's message reopens it, as the user's own would)
    const o = all.find(c => !closed(c)) ?? all.sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))[0];
    if (!o) throw new Error('Nessun Orchestrator a cui scrivere: aprilo dal PC.');
    const queued = !closed(o) && (o.state === 'running' || o.state === 'starting' || o.pending > 0);
    await chats.sendFromPhone(o.id, text, !!opts.voice);
    return { queued };
  }

  return {
    onOutcome(cb) { outcomes.add(cb); return () => { outcomes.delete(cb); }; },
    sendFromPhone,
    listDecidable,
    answerFromPhone,
    decidePlanFromPhone,
    onDecidable(cb) { listeners.push(cb); return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); }; },
    onOrchestratorTurnEnd(cb) {
      return chats.onTurnEnded(info => {
        if (!chatOf(info.chatId)?.isOrchestrator || info.outcomeDelivery && !info.fromPhone) return;
        cb({ reply: info.reply ?? '', fromPhone: !!info.fromPhone, failed: !!info.isError });
      });
    },
    onChatFailed(cb) {
      return chats.onTurnEnded(info => {
        if (!info.isError) return;
        const c = chatOf(info.chatId);
        if (!c || c.isOrchestrator) return;
        cb({ chatId: c.id, role: role(c), neutralLabel: neutral(c) });
      });
    },
    waitingSummary() {
      const open = chats.list().filter(c => !closed(c));
      const waiting = open.filter(c => c.pending > 0 || c.plan?.phase === 'proposed');
      const o = open.find(c => c.isOrchestrator);
      return { waiting: waiting.length, orchestratorBusy: !!o && (o.state === 'running' || o.state === 'starting'), labels: waiting.map(c => `${role(c)} · ${neutral(c)}`) };
    },
  };
}
