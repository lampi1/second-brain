// ChatManager layer (ADR 0200): questions and permissions. The user's answer, the gates a request passes before
// it reaches the user (role gate, read-only commands, auto-permit, «Modalità notte» ADR 0191), the away recap and
// the count of a run's requests and «Comando da eseguire» asks.
import { phoneQuestionReserved } from './phone-port';
import { touchesProdDbAzure } from './ask-text';
import { withClarified } from './plan-interview';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Answer, PendingRequest } from '../../shared/contract';
import { backedAnswer } from './ran-check';

import { errText, log } from '../log';
import { engineOf } from '../engines/registry';
import { allowsClass, COMMAND_TOOLS, commandsReadOnly, readOnlyCommand, toolClassOf, type ReadScripts } from '../agents/tool-policy';
import { readOnlyTools } from '../agents/read-tools';
import { gateRequest, runtimePluginName } from '../agents/role-gate';
import { autoPermit } from './auto-permit';
import { loadPolicy, policyCovers, policyHit } from './permit-policy';
import { AWAY_PARKED, AWAY_PLAN_NOTE, recommendedAnswers } from '../../shared/away';
import { askingPlan, PLAN_APPROVED, type IntakeSource, type PlanIntake } from '../../shared/strategy';
import type { SubmissionReceipt, Rec } from './manager-types';
import { isNativeQuestion, yesNoOf } from '../../shared/yes-no';
import { answerableInWords, sameWords, wordsAnswer } from '../../shared/answer-in-words';
import { sysItem } from './manager-helpers';
import { phoneTime } from './phone-reply';
import { ManagerCheckpoints } from './manager-checkpoints';
import { requestKey, registerRequest } from '../coordination/requests';
import type { DecisionActor } from '../coordination/model';
import type { AnswerPatch } from './session';
import { CoordinationStore } from '../coordination/store';

/** his whole message is a go: «sì», «ok», «vai», «confermo», «procedi», «lancialo», «eseguilo», «sì vai» (ADR 0275) */
const saysGo = (text: string): boolean => yesNoOf(text) === 'yes' || /^(?:s[iì][, ]*)?(?:ok|okay|vai|confermo|procedi|lancia(?:lo)?|esegui(?:lo)?|fallo)[.! ]*$/i.test(text.trim());
const PROD_FOR_USER = 'bloccato: questo permesso tocca produzione, un database o Azure: mostra all’utente cosa lancia e, dopo il suo sì (il suo ultimo messaggio), rispondi con confirmed true';

/** A question request's identity for #379: its questions and their options, in order. */
const questionSig = (req: Pick<PendingRequest, 'questions'>): string =>
  JSON.stringify((req.questions ?? []).map(q => [q.question, !!q.multiSelect, q.options.map(o => o.label)]));

/** Questions and permissions: the user's answer, the role gate, auto-permit, «Modalità notte», counted requests. */
export abstract class ManagerRequests extends ManagerCheckpoints {
  private coordinationStore?: CoordinationStore;
  private readonly answering = new WeakMap<Rec, Set<string>>();
  /** Same SQLite journal as Workflows, opened lazily. No function-valued or Electron dependency crosses the boundary. */
  protected get coordination(): CoordinationStore {
    return this.coordinationStore ??= new CoordinationStore(path.join(this.opts.userData, 'app.db'));
  }
  protected closeCoordination(): void { this.coordinationStore?.close(); }

  /** Called before exposing a request. Throws on persistence failure: never publish an unjournaled approval. */
  protected registerRequest(r: Rec, req: Omit<PendingRequest, 'chatId'>): void {
    registerRequest(this.coordination, r.s, req);
  }

  private deliverAnswer(r: Rec, req: Omit<PendingRequest, 'chatId'>, answer: Answer, actor: DecisionActor, patch?: AnswerPatch): boolean | Promise<boolean> {
    if (answer.kind !== req.type || (answer.kind === 'permission' && (typeof answer.allow !== 'boolean' || (req.noAlways && answer.always)))) throw new Error('Risposta non valida per questa richiesta.');
    if (answer.kind === 'question') {
      const asked = req.questions?.map(q => q.question) ?? [];
      if (!asked.length || !answer.answers || Object.keys(answer.answers).some(q => !asked.includes(q)) || asked.some(q => {
        const v = answer.answers[q]; return typeof v !== 'string' && !(Array.isArray(v) && v.every(x => typeof x === 'string'));
      })) throw new Error('Rispondi alle domande della richiesta originale.');
    }
    const store = this.coordination;
    const decision = store.resolve(requestKey(store, r.s, req), actor, answer);
    const delivery = store.beginDelivery(decision.id);
    const delivered = (ok: boolean): boolean => { store.finishDelivery(delivery.id, ok ? 'delivered' : 'failed'); return ok; };
    const uncertain = (e: unknown): never => { store.finishDelivery(delivery.id, 'uncertain'); throw e; };
    try {
      const session = r.session;
      if (session?.answerConsumed) return session.answerConsumed(req.id, answer, patch).then(delivered, uncertain);
      return delivered(session?.answer(req.id, answer, patch) ?? false);
    } catch (e) {
      return uncertain(e);
    }
  }

  /** #379 «questions sometimes reach me twice»: the same question again while its first copy is still open (an engine
   *  retrying its ask, two asks in one message) waits behind the first, unseen, and takes the same answer. */
  protected heldAsTwin(r: Rec, req: Omit<PendingRequest, 'chatId'>): boolean {
    if (req.type !== 'question' || !req.questions?.length) return false;
    const sig = questionSig(req);
    const first = [...r.pending.values()].find(p => p.id !== req.id && p.type === 'question' && questionSig(p) === sig);
    // a copy about to show (showLater) counts as open too: the same ask again joins it instead of a second panel
    const showing = first ? undefined : [...(r.twins ?? [])].find(([k, list]) => k.startsWith('show:') && list[0] && questionSig(list[0]) === sig)?.[0];
    if (!first && !showing) return false;
    this.registerRequest(r, req);
    const twins = r.twins ??= new Map();
    const key = first?.id ?? showing!;
    twins.set(key, [...(twins.get(key) ?? []), req]);
    log.info('chats', 'the same question again while the first is open: it takes the first one\'s answer', { chat: r.s.id, data: { first: first?.id ?? showing, twin: req.id } });
    return true;
  }

  /** Shows a request the sink held back (ManagerSink: the role gate and the rest already passed). */
  protected abstract exposeRequest(r: Rec, req: Omit<PendingRequest, 'chatId'>): void;

  /** The first copy's answer was delivered: its twins take it too. One the engine refused keeps its receipt (failed or
   *  uncertain, never answerable again): it is logged, the engine may ask again. */
  private answerTwins(r: Rec, firstId: string, answer: Answer, actor: DecisionActor): void {
    const twins = r.twins?.get(firstId);
    if (!twins) return;
    r.twins!.delete(firstId);
    for (const twin of twins) {
      const failed = (e?: unknown): void => {
        log.warn('chats', 'twin question not answered', { chat: r.s.id, cause: e ? errText(e) : 'the engine refused the answer', hint: 'its receipt says why; the engine may ask it again', data: { twin: twin.id } });
      };
      try {
        void Promise.resolve(this.deliverAnswer(r, twin, answer, actor)).then(ok => { if (!ok) failed(); }, failed);
      } catch (e) { failed(e); }
    }
  }

  /** The engine resolved request `id`: a twin it withdrew leaves its list; a first copy withdrawn unanswered (never one
   *  being answered now) lets its twins show, the next one first. */
  protected showTwins(r: Rec, id: string): void {
    for (const [first, list] of r.twins ?? []) {
      const left = list.filter(t => t.id !== id);
      if (left.length !== list.length) { if (left.length) r.twins!.set(first, left); else r.twins!.delete(first); }
    }
    if (this.answering.get(r)?.has(id)) return;
    const twins = r.twins?.get(id);
    if (!twins) return;
    r.twins!.delete(id);
    this.showLater(r, twins);
  }

  /** After the current event: an engine that exits resolves every open request first and only then ends, so a copy shown
   *  at once would flash; shown only when the same engine still runs. Twins it withdraws meanwhile leave the list. */
  private showLater(r: Rec, twins: Omit<PendingRequest, 'chatId'>[]): void {
    const session = r.session, key = `show:${twins[0]!.id}`;
    if (!session || r.s.closedAt) return;
    (r.twins ??= new Map()).set(key, twins);
    setImmediate(() => {
      const list = r.twins?.get(key);
      r.twins?.delete(key);
      if (!list?.length || r.session !== session || r.s.closedAt || this.chats.get(r.s.id) !== r) return;
      const [next, ...rest] = list;
      if (rest.length) r.twins!.set(next!.id, rest);
      try { this.exposeRequest(r, next!); }
      catch (e) { log.warn('chats', 'held question not shown', { chat: r.s.id, cause: errText(e), hint: 'the engine may ask it again', data: { request: next!.id } }); }
    });
  }

  /** True claims this request for policy handling; a remote delivery is still dispatching until its acknowledgement.
   *  Recaps and pending removal must wait too. Failure stays journaled and is never retried as user consent. */
  private policyAnswer(r: Rec, req: Omit<PendingRequest, 'chatId'>, answer: Answer, policy: string, patch?: AnswerPatch, consumed?: () => void): boolean {
    this.registerRequest(r, req);
    const session = r.session;
    // being answered: an engine resolution meanwhile does not show its twins (#379)
    const answering = this.answering.get(r) ?? new Set<string>();
    this.answering.set(r, answering); answering.add(req.id);
    const finish = (ok: boolean): boolean => {
      answering.delete(req.id);
      if (ok && this.chats.get(r.s.id) === r && r.session === session) { this.answerTwins(r, req.id, answer, { kind: 'policy', policy }); this.dropPending(r, req.id); consumed?.(); }
      return ok;
    };
    let result: boolean | Promise<boolean>;
    try { result = this.deliverAnswer(r, req, answer, { kind: 'policy', policy }, patch); } catch (e) { answering.delete(req.id); throw e; }
    if (typeof result === 'boolean') return finish(result);
    void result.then(finish).catch(e => { answering.delete(req.id); log.warn('chats', 'policy answer delivery uncertain', {
      chat: r.s.id, cause: errText(e), hint: 'inspect the request receipt; do not retry the accepted decision', data: { policy },
    }); });
    return true;
  }

  /** The Orchestrator answers for the user (ADR 0269, 0275; the owner 2026-11-13: «ciò che dice l'orchestrator deve
   *  valere come se l'avessi detto io SEMPRE»): any open question of a chat (an option or free words, an MCP form, a
   *  Strategist's interview, a delegated chat's), and any permission, except one that runs a command on production, a
   *  database or Azure (that one waits for his own click, as Esegui does). Never the Orchestrator's own question: that is
   *  the user's. Recorded as policy «orchestrator-for-user» with a line in the chat that says who answered. */
  answerForUser(chatId: string, requestId: string, answer: Answer, confirmed = false): void {
    const r = this.need(chatId);
    const req = r.pending.get(requestId);
    if (!req) throw new Error('Questa richiesta non è più aperta.');
    if (r.s.isOrchestrator) throw new Error('bloccato: è una tua domanda, la risposta è dell’utente');
    if (req.type === 'command') throw new Error('bloccato: un comando si mostra intero all’utente con relay_question e parte al suo sì');
    if (!r.session) { this.dropPending(r, requestId); throw new Error('La chat non è più attiva: la richiesta è scaduta.'); }
    let choice: string;
    let given: Answer = answer;
    if (req.type === 'permission') {
      if (answer.kind !== 'permission') throw new Error('È un permesso: rispondi con allow true o false.');
      // production, a database or Azure: only after his own yes to it, in his last message to the Orchestrator (PC,
      // Telegram or Remote Control), written after the request (the owner 2026-11-13: «mostrami i comandi e rispondi per
      // me dopo la conferma»)
      if (answer.allow && touchesProdDbAzure([req.title, req.detail, JSON.stringify(req.input ?? {})].join('\n'))) {
        const o = this.openOrchestrator(), said = o?.userSaid;
        if (!confirmed || !said || said.at < req.at || !saysGo(said.text)) throw new Error(PROD_FOR_USER);
        // one yes, one production step: used up here, a second one needs his next yes
        o!.userSaid = undefined;
      }
      given = { kind: 'permission', allow: answer.allow, ...(answer.message ? { message: answer.message } : {}) };
      choice = answer.allow ? 'Consenti' : `Nega${answer.message ? `: ${answer.message}` : ''}`;
    } else {
      if (answer.kind !== 'question' || !req.questions?.length) throw new Error('È una domanda: rispondi con answers.');
      if (Object.keys(answer.answers).some(k => !req.questions!.some(q => q.question === k))) throw new Error('Rispondi alle domande della richiesta originale.');
      if (req.questions.some(q => answer.answers[q.question] === undefined || answer.answers[q.question] === '')) throw new Error('Rispondi a ogni domanda della richiesta.');
      choice = req.questions.map(q => { const v = answer.answers[q.question]!; return Array.isArray(v) ? v.join(', ') : v; }).join(' · ');
      // a Sì to «did you run it?» with no run since the question carries the NOT_RAN note, as the user's own does (#372)
      given = this.opts.runs ? backedAnswer(req, answer, this.opts.runs(chatId)) : answer;
    }
    const said = () => {
      this.addItem(r, sysItem('orchestratorAnswered', { choice: choice.length > 200 ? `${choice.slice(0, 199)}…` : choice }, 'info'), false);
      this.updated(r);
      log.info('chats', 'the Orchestrator answered for the user', { chat: r.s.id, data: { requestId, type: req.type } });
    };
    // a Strategist's interview: his answer, recorded as the plan's clarified answer as the user's own would be
    if (r.s.plan && req.type === 'question' && isNativeQuestion(req)) {
      void this.answer(chatId, requestId, given, 'pc').then(said, e => log.warn('chats', 'the Orchestrator\'s answer to an interview was not delivered', { chat: r.s.id, cause: errText(e), hint: 'the question stays in the user\'s row' }));
      return;
    }
    if (this.answering.get(r)?.has(requestId)) throw new Error('Request already answered; delivery is still pending.');
    if (!this.policyAnswer(r, req, given, 'orchestrator-for-user', undefined, said)) throw new Error('La risposta non è arrivata alla chat: la richiesta resta nella riga dell’utente.');
  }

  /** The user's own message to the Orchestrator answers a chat's question (ADR 0274, 0275): the Orchestrator names the
   *  question and quotes his words (`words`, checked against his last message, written after the question); his whole
   *  message is what the chat gets, so an excerpt never turns his «non …» into a yes. Never the Orchestrator's own
   *  question, an MCP form, a permission or a command. Recorded as policy «orchestrator-user-words» (an interview: as
   *  his own answer, so the plan keeps it), with a line in the chat. */
  answerWithUserWords(chatId: string, requestId: string, words: string): void {
    const r = this.need(chatId);
    const req = r.pending.get(requestId);
    if (!req) throw new Error('Questa richiesta non è più aperta.');
    if (r.s.isOrchestrator || !answerableInWords(req)) throw new Error('bloccato: le sue parole rispondono solo alla domanda di una chat di lavoro (non a un permesso, un comando, un modulo o una tua domanda)');
    const said = this.openOrchestrator()?.userSaid;
    if (!said || said.at < req.at || !sameWords(said.text, words)) throw new Error('bloccato: words deve essere copiato dal suo ultimo messaggio, scritto dopo la domanda; se non risponde a questa domanda lasciala aperta');
    if (!r.session) { this.dropPending(r, requestId); throw new Error('La chat non è più attiva: la richiesta è scaduta.'); }
    if (this.answering.get(r)?.has(requestId)) throw new Error('Request already answered; delivery is still pending.');
    // a Strategist's interview: his answer, recorded as the plan's clarified answer (the user's own path)
    if (r.s.plan) {
      const words = said.text.trim();
      void this.answer(chatId, requestId, wordsAnswer(req, words), 'pc').then(() => {
        this.addItem(r, sysItem('orchestratorPassedWords', { words: words.length > 200 ? `${words.slice(0, 199)}…` : words }, 'info'), false);
        this.updated(r);
      }, e => log.warn('chats', 'the user\'s words did not reach the interview', { chat: r.s.id, cause: errText(e), hint: 'the question stays in the user\'s row' }));
      return;
    }
    const text = said.text.trim();
    const sent = this.policyAnswer(r, req, wordsAnswer(req, text), 'orchestrator-user-words', undefined, () => {
      this.addItem(r, sysItem('orchestratorPassedWords', { words: text.length > 200 ? `${text.slice(0, 199)}…` : text }, 'info'), false);
      this.updated(r);
      log.info('chats', 'the Orchestrator passed the user\'s words on', { chat: r.s.id, data: { requestId } });
    });
    if (!sent) throw new Error('La risposta non è arrivata alla chat: la domanda resta nella sua riga.');
  }

  /** The user's answer. by = where they gave it: the PC (the panel) or the paired phone (phone bridge: only a question,
   *  never a permission or a command; chats/phone-port.ts checks the rest before it calls this) */
  async answer(chatId: string, requestId: string, answer: Answer, by: 'pc' | 'phone' | 'relay' = 'pc'): Promise<void> {
    const r = this.need(chatId);
    if (by === 'relay') throw new Error('Una risposta inoltrata da un agente non è una decisione dell’utente.');
    // the app's own question (a run stopped on a step only the user can do, #358): answered here, never by an engine
    const ask = this.userAsks.get(requestId);
    if (ask && ask.chatId === chatId) { this.answerUserAction(ask, answer); return; }
    if (!r.pending.has(requestId)) throw new Error('Questa richiesta non è più aperta.');
    if (!r.session) { this.dropPending(r, requestId); throw new Error('La chat non è più attiva: la richiesta è scaduta.'); }
    const req = r.pending.get(requestId)!;
    // from the phone: a Sì/No question, or a permission one of the user's brain rules sent to them (ADR 0254), once
    const phoneOk = req.type === 'question' ? answer.kind === 'question' : req.type === 'permission' && !!req.heldBy && answer.kind === 'permission' && !answer.always;
    if (by === 'phone' && !phoneOk) throw new Error('Dal telefono si risponde solo a una domanda Sì/No.');
    const interview = (r.s.plan || r.s.isOrchestrator) && isNativeQuestion(req) && answer.kind === 'question';
    const pcOnly = interview ? phoneQuestionReserved(req, () => { this.ensureHistory(r); return r.items; }) : false;
    const answering = this.answering.get(r) ?? new Set<string>();
    if (answering.has(requestId)) throw new Error('Request already answered; delivery is still pending.');
    this.answering.set(r, answering); answering.add(requestId);
    if (by === 'phone') (r.answeringFromPhone ??= new Set()).add(requestId); // the engine resolves it now: pending:resolved carries by 'phone'
    const session = r.session;
    // Same rule as the sink's resolved: the request leaves the chat it was asked in, whichever engine runs it now
    const sameChat = (): boolean => this.chats.get(chatId) === r;
    let ok: boolean;
    try {
      // a Yes on «hai eseguito il comando?» that no run of this chat backs reaches it with the app's note (#372)
      const told = this.opts.runs ? backedAnswer(req, answer, this.opts.runs(chatId)) : answer;
      if (told !== answer) log.info('chats', 'a Yes on «did you run it?» with no run behind it: told to the chat', { chat: chatId, data: { requestId } });
      ok = await this.deliverAnswer(r, req, told, { kind: 'user', channel: by });
      // its twins take the same answer before it leaves, so its resolution never shows them (#379)
      if (ok && sameChat()) this.answerTwins(r, requestId, told, { kind: 'user', channel: by });
      // The RPC acknowledgement can precede the batched resolved event. Preserve phone provenance in either order.
      if (ok && sameChat()) this.dropPending(r, requestId);
      // the Orchestrator's own question answered in words typed on the PC (not an option clicked): they are his last
      // message too, so the Orchestrator may pass them to a work chat's question they answer (ADR 0274)
      if (ok && r.s.isOrchestrator && by === 'pc' && answer.kind === 'question') {
        const typed = Object.entries(answer.answers).flatMap(([q, v]) => (Array.isArray(v) ? v : [v]).filter(x => !req.questions?.find(k => k.question === q)?.options.some(o => o.label === x)));
        if (typed.length) r.userSaid = { text: typed.join('\n'), at: Date.now() };
      }
    } finally {
      answering.delete(requestId);
      r.answeringFromPhone?.delete(requestId);
      if (!r.answeringFromPhone?.size) delete r.answeringFromPhone;
    }
    if (!ok && sameChat()) { this.dropPending(r, requestId); this.showTwins(r, requestId); }
    // The chat or its engine changed during the delivery: the receipt journal holds the outcome. Nothing else here may
    // touch the replacement (its next turn's decisions, the user's event, the plan's clarified answers).
    if (!sameChat() || r.session !== session) {
      log.warn('chats', 'answer delivered across an engine change: not recorded on the new session', {
        chat: chatId, cause: 'the session was replaced while the answer was being delivered', hint: 'inspect the request receipt; the decision is never resent', data: { requestId, ok },
      });
      return;
    }
    if (!ok) return;
    // request/tool/asked bind the line to this question (appctl/tools.ts decidedSince): its tool item never counts as a PC answer
    if (by === 'phone') { this.addItem(r, sysItem('phoneDecided', { time: phoneTime(Date.now()), what: 'question', request: requestId, tool: req.toolUseId ? `t-${req.toolUseId}` : '', asked: req.at }, 'info'), false); this.updated(r); }
    // Full request scope stays private (ADR 0083); shared user events carry only the user's own choices/words.
    if (r.s.isOrchestrator) {
      delete r.intakeKey;
      if (r.intakePanelId === requestId && isNativeQuestion(req) && answer.kind === 'question') r.intakeKey = randomUUID();
      if (r.intakePanelId === requestId) delete r.intakePanelId;
    }
    const decision = JSON.stringify({ requestId, pcOnly, ...(by !== 'pc' ? { by } : {}), ...(r.intakeKey ? { intakeKey: r.intakeKey } : {}), nativeQuestion: isNativeQuestion(req), title: req.title, detail: req.detail, questions: req.questions ?? [], answer });
    r.continuationDecisions = r.continuationDecisions ? `${r.continuationDecisions}\n${decision}` : decision;
    // one checkpoint carries the decision and the user's event: two synchronous checkpoints per click froze the window (#294)
    let saved = false;
    try {
      saved = answer.kind === 'question' ? this.userWrote(chatId, JSON.stringify({ requestId, answers: Object.values(answer.answers) }))
        : this.userWrote(chatId, JSON.stringify({ requestId, allow: answer.allow, ...(answer.message ? { message: answer.message } : {}) }));
    } finally { if (!saved) this.persist(true); } // the decision is on disk even when the event could not be recorded
    // a Strategist still asking: the answer is one more thing its strip shows as already clear (ADR 0108)
    const plan = r.s.plan;
    if (plan && (plan.phase === 'asking' || plan.phase === 'revising') && isNativeQuestion(req) && answer.kind === 'question' && req.questions?.length) {
      const next = withClarified(plan, req.questions, answer.answers, pcOnly);
      if (next !== plan) { r.s.plan = next; this.persist(); this.updated(r); }
    }
  }

  /** Pin the answer before routing or model choice yields to another user request. */
  bindPlanIntake(chatId: string, question: string): IntakeSource {
    const key = this.need(chatId).intakeKey;
    if (!key) throw new Error('Use the exact question from your latest answered intake panel, or omit intakeQuestion.');
    return { chatId, question, key };
  }

  /** Recheck the pinned answer immediately before the synchronous plan registration. */
  protected planIntake({ chatId, question, key }: IntakeSource): PlanIntake {
    const r = this.need(chatId);
    if (r.s.isOrchestrator && !r.s.closedAt && r.intakeKey && r.continuationDecisions) {
      const records = r.continuationDecisions;
      const decision = JSON.parse(records.slice(records.lastIndexOf('\n') + 1));
      const qs = decision.questions;
      if (key === r.intakeKey && decision.intakeKey === key && decision.nativeQuestion === true && decision.answer?.kind === 'question' && Array.isArray(qs) && qs.length === 1 && qs[0]?.question === question) {
        const result = withClarified(askingPlan(0), qs, decision.answer.answers, decision.pcOnly !== false);
        if (result.enough) return { stop: true, ...(result.pcOnly ? { pcOnly: true } : {}) };
        const [entry] = result.clarified;
        if (entry) return entry;
      }
    }
    throw new Error('Use the exact question from your latest answered intake panel, or omit intakeQuestion.');
  }

  /** «Modalità notte» just went on (ADR 0191): what already waits for the user is settled the way a new request would be
   *  (recommended answer, parked permission) and a plan waiting on its strip starts. Returns how many it settled. */
  settleForAway(): number {
    if (!this.opts.away?.()) return 0;
    let n = 0;
    for (const r of this.chats.values()) {
      if (r.s.closedAt) continue;
      for (const req of [...r.pending.values()]) {
        // A previous async answer may still be in flight (or uncertain). Its accepted decision is never sent twice.
        if (this.coordination.original(r.s.id, req.id)?.state === 'accepted') continue;
        if (this.awayAnswered(r, req)) n++;
      }
      const plan = r.s.plan;
      if (plan?.phase === 'proposed') {
        n++;
        this.hook('onAway', () => this.opts.onAway?.({ kind: 'plan', chatId: r.s.id, title: r.s.title || 'Strategist', text: plan.steps.map(x => x.title).join(' · ') }));
        void this.decidePlan(r.s.id, 'approve', plan.at, undefined, `${PLAN_APPROVED}\n${AWAY_PLAN_NOTE}`, undefined, true)
          .catch(e => log.warn('chats', 'away: plan not started', { chat: r.s.id, cause: errText(e), hint: 'the plan stays on its strip for the user' }));
      }
    }
    if (n) log.info('chats', 'away: open requests settled', { data: { n } });
    return n;
  }

  /** What still waits for the user (for the recap when they are back): one line per open question or permission. */
  openForUser(): { title: string; what: string }[] {
    const out: { title: string; what: string }[] = [];
    for (const r of this.chats.values()) {
      if (r.s.closedAt) continue;
      for (const req of r.pending.values()) if (req.type !== 'command') out.push({ title: r.s.title || 'Chat', what: req.type === 'question' ? (req.questions?.[0]?.question ?? req.title) : `permesso ${req.tool}` });
      if (r.s.plan?.phase === 'proposed') out.push({ title: r.s.title || 'Strategist', what: 'piano da approvare' });
    }
    return out;
  }

  /** Puts the night's recap in the Orchestrator's chat (an app notice: no turn, no token). False = no open Orchestrator. */
  awayRecap(text: string): boolean {
    const o = this.openOrchestrator();
    if (!o) return false;
    this.addItem(o, sysItem('awayRecap', { text }, 'info'), false);
    this.updated(o);
    return true;
  }

  /** A "Comando da eseguire" request (run/asks.ts keeps it, not the engine): counted once on the chat's open run. */
  commandAsked(chatId: string, requestId: string): void {
    const r = this.chats.get(chatId);
    if (!r) return;
    this.countRequest(r, { id: requestId, type: 'command' });
    (r.commandsOpen ??= new Set()).add(requestId);
  }
  /** That request left (run, "Non serve", the chat went on): when nothing else waits, the stale clock starts again. */
  commandDone(chatId: string, requestId: string): void {
    const r = this.chats.get(chatId);
    if (!r?.commandsOpen?.delete(requestId)) return;
    if (!r.commandsOpen.size && !r.pending.size) this.idleAgain(r);
  }

  /** The role gate (agents/role-gate.ts) on a request before it reaches the user: a skill is allowed at once (ADR 0278;
   *  one the user's own rules name, or any while those rules cannot be read, goes on to autoPermitted), an engine
   *  sub-agent other than a search and a request beyond the delegating chat's permissions are refused, visibly.
   *  True = answered here. */
  protected gated(r: Rec, req: Omit<PendingRequest, 'chatId'>): boolean {
    const owner = r.s.agent, parent = r.s.parentId ? this.chats.get(r.s.parentId) : undefined;
    if (owner?.source !== 'catalog' || (r.s.isOrchestrator && req.tool !== 'Skill')) return false;
    const verdict = gateRequest(req, { role: { id: owner.id, name: owner.name }, skills: r.skills ?? [],
      rewrite: engineOf(r.s.harness)?.kind === 'claude',
      policy: r.policy ?? null, brainRoot: this.opts.brainRoot?.() ?? null, readScripts: this.readScripts(r), cwd: r.s.cwd,
      ...(r.agentAssets ? { plugin: runtimePluginName(r.agentAssets.pluginDir) } : {}),
      ...(r.s.parentId ? { parent: { policy: parent ? parent.policy ?? null : r.policy ?? null, title: parent?.s.title ?? r.s.parentId } } : {}) });
    if (verdict.kind === 'pass') return false;
    if (verdict.kind === 'allow') {
      // the user's rules (permissions.json) hold a skill they name, as in a plain chat; unreadable rules ask
      if (req.tool === 'Skill') {
        const policy = loadPolicy(this.opts.brainRoot?.() ?? null);
        if (policy.state === 'broken' || policyHit(policy, req.tool, req.input, COMMAND_TOOLS, req.title)) return false;
      }
      this.policyAnswer(r, req, { kind: 'permission', allow: true }, 'role-gate', verdict.patch);
      log.info('chats', 'role gate allowed', { chat: r.s.id, data: { tool: req.tool, qualified: !!verdict.patch } });
      return true;
    }
    this.addItem(r, sysItem(verdict.code, verdict.params, 'warn'), false);
    this.policyAnswer(r, req, { kind: 'permission', allow: false, message: verdict.message }, 'role-gate');
    log.info('chats', 'role gate refused', { chat: r.s.id, data: { tool: req.tool, code: verdict.code } });
    return true;
  }

  /** A role that may only read commands (shell-read): a command it asks to run that does not only read is refused at
   *  once, visibly, and never reaches the user, unless a delegating chat that may run any command is above it (beyond
   *  the role, within the parent: the user's call; one beyond the parent never got here, gated). One that reads, or
   *  that the user decides, reaches the user without "always" (a rule would let later commands through unchecked). */
  protected refusedCommand(r: Rec, req: Omit<PendingRequest, 'chatId'>): boolean {
    if (req.type !== 'permission' || !COMMAND_TOOLS.includes(req.tool) || !commandsReadOnly(r.policy)) return false;
    const command = (req.input as { command?: unknown } | null)?.command;
    const parent = r.s.parentId ? this.chats.get(r.s.parentId) : undefined;
    const parentRuns = !!parent && !commandsReadOnly(parent.policy) && allowsClass(parent.policy, 'shell');
    if (readOnlyCommand(command, this.readScripts(r)) || parentRuns) { req.noAlways = true; delete req.alwaysRules; return false; }
    const shown = typeof command === 'string' ? command.slice(0, 120) : req.tool;
    log.info('chats', 'command refused: read-only role', { chat: r.s.id, data: { tool: req.tool } });
    this.addItem(r, sysItem('commandReadOnly', { command: shown }, 'warn'), false);
    this.policyAnswer(r, req, { kind: 'permission', allow: false, message: `This role may only run commands that read (shell-read): ${shown} was refused. Use a reading command, or report what you need to your parent.` }, 'read-only-role');
    return true;
  }

  /** ADR 0103, 0254: the app answers a permission request itself (chats/auto-permit.ts): everything passes but what the
   *  user's brain rules hold (permissions.json: refused visibly with the rule's reason, or sent to the user) and what
   *  the user's own role limits keep for them. True = answered. */
  protected autoPermitted(r: Rec, req: Omit<PendingRequest, 'chatId'>): boolean {
    const policy = loadPolicy(this.opts.brainRoot?.() ?? null);
    if (policy.state === 'broken' && r.policyWarned !== policy.error) {
      r.policyWarned = policy.error;
      this.addItem(r, sysItem('policyBroken', { error: policy.error.slice(0, 160) }, 'warn'), false);
      log.warn('chats', 'brain permissions.json unreadable: asking the user', { chat: r.s.id, cause: policy.error, hint: 'fix permissions.json in the brain' });
    }
    // whatever reaches the user for a tool the rules could hold gets no «always»: a remembered grant would let a later
    // request they hold run without coming back here
    const toUser = (): false => {
      if (req.type === 'permission' && policyCovers(policy, req.tool, COMMAND_TOOLS, req.title)) { req.noAlways = true; delete req.alwaysRules; }
      return false;
    };
    // a class the role was not given, or a writing command of a role that may only read commands, stays the user's call
    // (Cursor and Codex do not enforce the role's tools themselves)
    const c = toolClassOf(req.tool);
    const command = (req.input as { command?: unknown } | null)?.command;
    if (r.policy?.tools && c && !allowsClass(r.policy, c)) return toUser();
    if (COMMAND_TOOLS.includes(req.tool) && commandsReadOnly(r.policy) && !readOnlyCommand(command, this.readScripts(r))) return toUser();
    const v = autoPermit(req, { cwd: r.s.cwd, ceiling: r.policy?.ceiling ?? null, readScripts: this.readScripts(r), policy });
    if (v.kind === 'ask') {
      // held by the user's rule: no «always» (a saved rule would let the next ones through unasked); the phone may answer
      if (v.rule) { req.noAlways = true; delete req.alwaysRules; req.heldBy = { rule: v.rule.id, why: v.rule.why }; log.info('chats', 'brain rule asks the user', { chat: r.s.id, data: { tool: req.tool, rule: v.rule.id } }); }
      return toUser();
    }
    if (v.kind === 'allow') {
      this.policyAnswer(r, req, { kind: 'permission', allow: true }, 'auto-permit');
      log.info('chats', 'auto-permit allowed', { chat: r.s.id, data: { tool: req.tool } });
      return true;
    }
    this.addItem(r, sysItem(v.rule.action === 'esegui' ? 'policyEsegui' : 'policyNeverPrint', { command: v.shown, rule: v.rule.id, why: v.rule.why.slice(0, 160) }, 'warn'), false);
    this.policyAnswer(r, req, { kind: 'permission', allow: false, message: v.message }, 'auto-permit');
    // only Claude reads the refusal's message as the tool's result; Codex and the ACP engines (Cursor, OpenCode) get a
    // bare «declined» and may end the turn on it: the app tells them after the turn (manager-delegation.ts), once per
    // rule and run (a chat with no run: once per rule until the user's own next message), so the chat goes on
    const key = `${v.rule.id}:${r.s.run?.runId ?? 'chat'}`;
    if (engineOf(r.s.harness)?.kind !== 'claude' && !r.refusalTold?.has(key)) r.refusalNote = { rule: v.rule.id, message: v.message, at: Date.now(), key };
    log.info('chats', 'brain rule refused', { chat: r.s.id, data: { tool: req.tool, rule: v.rule.id, action: v.rule.action } });
    return true;
  }

  /** «Modalità notte» (ADR 0191): nobody will answer, so a question gets its recommended option (shared/away.ts) and a
   *  permission is refused with a note to go on without it, parked for the user's return (never granted by the app). A
   *  command left for the user (Esegui) never blocks the chat: it stays in the queue. True = answered here. */
  protected awayAnswered(r: Rec, req: Omit<PendingRequest, 'chatId'>): boolean {
    if (req.type === 'command' || !this.opts.away?.()) return false;
    const title = r.s.title || r.s.agent?.name || 'Chat';
    if (req.type === 'question') {
      // Cursor's «plan ready» (cursor/create_plan) is a plan to approve like Claude's ExitPlanMode below: its first option
      const q0 = req.questions?.[0], plan = req.tool === 'CreatePlan' && q0?.options[0] ? { [q0.question]: q0.options[0].label } : null;
      const answers = plan ?? recommendedAnswers(req.questions ?? []);
      if (!answers) return false;
      const choice = Object.values(answers).flat().join(', ');
      // nobody saw a run either: a recommended Sì to «hai eseguito?» carries the app's note (#372)
      const picked: Answer = { kind: 'question', answers };
      const told = this.opts.runs ? backedAnswer(req, picked, this.opts.runs(r.s.id)) : picked;
      return this.policyAnswer(r, req, told, 'away', undefined, () => {
        this.addItem(r, sysItem('awayPicked', { choice }, 'info'), false);
        this.hook('onAway', () => this.opts.onAway?.({ kind: 'picked', chatId: r.s.id, title, text: `${req.questions?.[0]?.question ?? req.title} → ${choice}` }));
        log.info('chats', 'away: recommended answer', { chat: r.s.id, data: { questions: req.questions?.length ?? 0 } });
      });
    }
    // a plan mode's «plan ready» is a plan to approve, not a permission: it starts like a Strategist's plan, and every
    // permission the work then asks for still goes through the checks above or is parked here
    if (req.tool === 'ExitPlanMode') {
      return this.policyAnswer(r, req, { kind: 'permission', allow: true }, 'away-plan', undefined, () => {
        this.addItem(r, sysItem('awayPicked', { choice: 'Approva il piano' }, 'info'), false);
        this.hook('onAway', () => this.opts.onAway?.({ kind: 'plan', chatId: r.s.id, title, text: req.title || 'piano' }));
      });
    }
    return this.policyAnswer(r, req, { kind: 'permission', allow: false, message: AWAY_PARKED }, 'away-parked', undefined, () => {
      const what = `${req.tool}${req.detail ? `: ${req.detail}` : req.title ? `: ${req.title}` : ''}`;
      this.addItem(r, sysItem('awayParked', { what: what.slice(0, 160) }, 'warn'), false);
      this.hook('onAway', () => this.opts.onAway?.({ kind: 'parked', chatId: r.s.id, title, text: `permesso non concesso, ${what}` }));
      log.info('chats', 'away: permission parked', { chat: r.s.id, data: { tool: req.tool } });
    });
  }

  /** The brain's declared read-only tools (read-only-tools.md), resolved from the chat's folder (issue #93). */
  private readScripts(r: Rec): ReadScripts {
    return { cwd: r.s.cwd, paths: readOnlyTools(this.opts.brainRoot?.() ?? null) };
  }

  /** Each request once per run, by its id: question, permission or command. */
  protected countRequest(r: Rec, req: Pick<PendingRequest, 'id' | 'type'> | Omit<PendingRequest, 'chatId'>): void {
    // sink.pending calls here after policy mutations and before exposing the request, including plain chats without runs.
    if ('tool' in req) this.registerRequest(r, req);
    const run = r.s.run;
    if (!run || run.endedAt !== undefined || r.pending.has(req.id)) return;
    const seen = r.runSeen ??= new Set();
    if (seen.has(req.id)) return;
    seen.add(req.id);
    if (seen.size > 1000) seen.delete(seen.values().next().value!);
    run.counters[req.type === 'question' ? 'questions' : req.type === 'permission' ? 'permissions' : 'commands']++;
    this.runSave();
  }

  // ---- implemented in a later layer (ADR 0200: manager.ts and its manager-*.ts layers)
  abstract userWrote(chatId: string, text: string): boolean;
  protected abstract decidePlan(chatId: string, decision: 'approve' | 'change', at: number, text?: string, message?: string, receipt?: SubmissionReceipt, byApp?: boolean, by?: 'pc' | 'phone'): Promise<void>;
  protected abstract openOrchestrator(): Rec | undefined;
  /** the user's answer to the app's own user-action question (manager-delegation.ts, #358) */
  protected abstract answerUserAction(req: PendingRequest, answer: Answer): void;
}
