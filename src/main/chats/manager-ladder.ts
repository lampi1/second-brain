// ChatManager layer (ADR 0200): the question ladder (ADR 0344). A worker's question goes up one level at a time: worker →
// the chat that started it → the Orchestrator → the user. A native question past the gates is held here before anyone
// sees it (ladderHeld, called by manager-sink.ts exposeRequest, so every engine passes by it); the chat that holds it is
// woken with it and answers (ladderReply: agent_answer_child, app_resolve_question) or passes it one level up; a holder
// closed, in error or silent for LADDER_SILENT_MS never stops it: it goes up by itself. agent_ask_parent enters the same
// ladder (ladderAsk). Permissions, commands, plan approvals and forms are never held; an agent never answers what is the
// user's (ladderReserved). Night mode answers first, as before (ADR 0191). A restart keeps every open question: its
// engine request is gone, so the answer reaches the worker as a message, or the same question asked again takes its place.
// The records are ChatSummary.questions (shared/question-ladder.ts). Unit tests: test/unit/chats/ladder.test.ts.
import { randomUUID } from 'node:crypto';
import type { Answer, PendingRequest, Question } from '../../shared/contract';
import { LADDER_TOOL, isNativeQuestion } from '../../shared/yes-no';
import { askedText, asksToExplain, sameAsk, withoutAppNote } from '../../shared/ask-once';
import { recommendedAnswers } from '../../shared/away';
import { sameWords } from '../../shared/answer-in-words';
import { ROLE_DEFAULTS, isWorkRole } from '../../shared/roles';
import { LADDER_SILENT_MS, keepLadder, ladderAnswer, ladderAnswerText, ladderAsks, ladderLine as oneLine, ladderMessage, ladderReserved, ladderText, openQuestions, withStep, type LadderAction, type LadderAnswer, type LadderAsk, type LadderLevel, type LadderQuestion } from '../../shared/question-ladder';
import { errText, log } from '../log';
import { touchesProdDbAzure } from './ask-text';
import { AGENT_LABEL } from '../../shared/agent-label';
import { sysItem } from './manager-helpers';
import { timersFor } from '../timers';
import type { DecisionActor } from '../coordination/model';
import type { Rec } from './manager-types';
import { ManagerWork } from './manager-work';

const { setTimeout, clearTimeout } = timersFor('chats/ladder');

export { LADDER_TOOL };
const WHY_MAX = 300, ANSWER_MAX = 4000;

interface Open { r: Rec; q: LadderQuestion; timer?: ReturnType<typeof setTimeout>; why?: string; sending?: boolean; moving?: boolean }
interface Holder { id: string; rec?: Rec; level: 'strategist' | 'orchestrator' }
/** What a holder says about a question (agent_answer_child, app_resolve_question). */
export interface LadderReply { chatId: string; requestId?: string; answer?: string; why?: string; askUser?: boolean }

/** The ladder: which chat holds a worker's question, its way up, and the answer back. */
export abstract class ManagerLadder extends ManagerWork {
  /** the open questions by id; undefined while the base constructor restores the saved chats */
  private readonly ladder = new Map<string, Open>();
  /** shows a request in the user's row (manager-sink.ts) */
  protected abstract reveal(r: Rec, req: PendingRequest): void;

  // ---- the gate

  /** True = held: an agent above the chat answers it first, the user does not see it. */
  protected override ladderHeld(r: Rec, req: Omit<PendingRequest, 'chatId'>): boolean {
    if (!isNativeQuestion(req) || !req.questions?.length || r.s.isOrchestrator || this.opts.away?.()) return false;
    // the same question still open without its engine (a restart, agent_ask_parent): this request takes its place
    const again = this.openOf(r).find(o => !o.q.requestId && !o.sending && sameAsk(ladderText(o.q), askedText(req)));
    if (again) {
      this.put(again, { requestId: req.id, via: 'request' });
      this.dropUserAsks(q => q.id === askId(again.q.id));
      delete r.askedParentAt;
      if (again.q.level === 'user') return false;
      this.hold(again, req);
      return true;
    }
    if (!this.nextHolder(r, r)) return false;
    const o = this.begin(r, ladderAsks(req.questions), 'request', req.id);
    this.climb(o, 'asked');
    if (o.q.level === 'user') return false; // nobody above can take it: it shows as before, its record says why
    this.hold(o, req);
    this.wake(o);
    return true;
  }

  /** agent_ask_parent: the worker asks and goes on; the answer reaches it as a message. */
  ladderAsk(chatId: string, ask: { question: string; options: string[]; why?: string }): { asked: string } {
    const r = this.need(chatId);
    const same = this.openOf(r).find(o => sameAsk(ladderText(o.q), ask.question));
    if (same) return { asked: this.nameOf(same.q) };
    const o = this.begin(r, ladderAsks([{ question: ask.question, options: ask.options.map(label => ({ label })) }]), 'message');
    if (ask.why) o.why = ask.why;
    this.climb(o, 'asked', ask.why);
    if (o.q.answered) return { asked: this.nameOf(o.q) };
    r.askedParentAt = Date.now();
    if (o.q.level === 'user') this.showOwn(o); else this.wake(o);
    return { asked: this.nameOf(o.q) };
  }

  private begin(r: Rec, asks: LadderAsk[], via: LadderQuestion['via'], requestId?: string): Open {
    const at = Date.now();
    const o: Open = { r, q: { id: `q-${randomUUID()}`, asks, level: 'user', at, levelAt: at, trail: [], via, ...(requestId ? { requestId } : {}) } };
    r.s.questions = keepLadder([...(r.s.questions ?? []), o.q]);
    this.ladder.set(o.q.id, o);
    return o;
  }

  private hold(o: Open, req: Omit<PendingRequest, 'chatId'>): void {
    if (o.q.level === 'user') return;
    const r = o.r;
    r.pending.set(req.id, { ...req, chatId: r.s.id, ladder: o.q.level });
    if (r.s.state === 'waiting' && this.allHeld(r)) r.s.state = 'running'; // it waits for an agent, not for the user
    this.persist();
    this.updated(r);
  }

  /** Every open request of the chat is held by an agent: it does not wait for the user. */
  protected override allHeld(r: Rec): boolean {
    return r.pending.size > 0 && [...r.pending.values()].every(p => p.ladder);
  }

  // ---- the way up

  /** The level above `from` for the worker's question; null = the user. */
  private nextHolder(from: Rec, worker: Rec): Holder | null {
    if (from.s.isOrchestrator) return null;
    if (from.s.parentId) {
      const rec = this.chats.get(from.s.parentId);
      return { id: from.s.parentId, ...(rec ? { rec } : {}), level: rec?.s.isOrchestrator ? 'orchestrator' : 'strategist' };
    }
    // a chat the user opened himself (or the app's own) asks him
    if (from === worker && from.s.run?.startedBy !== 'orchestrator') return null;
    const rec = this.openOrchestrator();
    return rec ? { id: rec.s.id, rec, level: 'orchestrator' } : null;
  }

  /** Why a chat can not answer now; null = it can. */
  private unavailable(rec: Rec | undefined): string | null {
    if (!rec || rec.s.closedAt || this.closedByUser(rec)) return 'chat chiusa';
    if (rec.s.state === 'error' || rec.s.lastError) return 'chat in errore';
    const last = rec.s.lastResult;
    if (last?.isError && !last.interrupted && !rec.session?.busy && rec.s.state !== 'running' && rec.s.state !== 'starting') return 'chat in errore o turni finiti';
    // this assignment's report: a child's, or a root chat's agent_report (new work starts a run without one)
    if (rec.s.delegation?.result || rec.s.run?.report?.via === 'agent_report') return 'ha già consegnato il suo lavoro';
    if (!rec.s.isOrchestrator && !this.chatToolShown(rec.s.id, 'agent_answer_child')) return 'non può rispondere alle chat delegate';
    return null;
  }

  /** One level up, over the levels that can not answer; `action` is what the current level did with it. */
  private climb(o: Open, action: 'asked' | 'passed' | 'skipped', why?: string): void {
    const q = o.q, r = o.r;
    clearTimeout(o.timer); delete o.timer;
    const from = action === 'asked' ? r : q.holder ? this.chats.get(q.holder) : undefined;
    let trail = q.trail;
    const step = (level: LadderLevel, name: string, act: LadderAction, chatId?: string, reason?: string): void => {
      trail = withStep({ trail }, { level, name, at: Date.now(), action: act, ...(chatId ? { chatId } : {}), ...(reason ? { why: reason } : {}) });
    };
    if (action !== 'asked') step(q.level, this.nameOf(q), action, q.holder, why);
    // a holder deleted meanwhile: what was above it is unknown, the Orchestrator is next
    let at: Rec | undefined = from;
    const seen = new Set([r.s.id, ...(q.holder ? [q.holder] : [])]);
    let next: Holder | null;
    for (;;) {
      next = at ? this.nextHolder(at, r) : this.orchestratorHolder();
      if (!next) break;
      if (seen.has(next.id)) { if (next.level === 'orchestrator') { next = null; break; } at = undefined; continue; }
      seen.add(next.id);
      const gone = this.unavailable(next.rec);
      if (!gone) break;
      step(next.level, next.rec ? this.nameOfRec(next.rec) : 'Chat chiusa', 'skipped', next.id, gone);
      at = next.rec;
      if (next.level === 'orchestrator') { next = null; break; }
    }
    const level: LadderLevel = next?.level ?? 'user', name = next?.rec ? this.nameOfRec(next.rec) : 'utente';
    step(level, name, 'asked', next?.id, action === 'asked' ? why : undefined);
    const { holder: _h, ...rest } = q;
    this.put(o, { ...rest, level, levelAt: Date.now(), trail, ...(next ? { holder: next.id } : {}) }, true);
    const question = short(ladderText(q));
    if (action !== 'asked') this.addItem(r, sysItem('ladderPassed', { question, from: this.nameOf(q), who: name, why: short(why ?? '') }, 'info'), false);
    else this.addItem(r, sysItem('ladderAsked', { question, who: name }, 'info'), false);
    log.info('chats', 'question moved on the ladder', { chat: r.s.id, data: { question: q.id, action, level, holder: next?.id ?? null } });
    this.persist();
    this.updated(r);
  }
  private orchestratorHolder(): Holder | null {
    const rec = this.openOrchestrator();
    return rec ? { id: rec.s.id, rec, level: 'orchestrator' } : null;
  }

  /** A question goes up and whoever holds it now is told: the next chat, or the user's row. */
  private up(o: Open, action: 'passed' | 'skipped', why: string): void {
    if (o.q.answered || o.moving || o.sending || !this.ladder.has(o.q.id)) return;
    if (o.q.requestId && this.answering.get(o.r)?.has(o.q.requestId)) { this.arm(o); return; } // an answer is on its way
    if (this.withdrawn(o)) return;
    o.moving = true;
    try { this.climb(o, action, why); } finally { delete o.moving; }
    if (o.q.level !== 'user') { const p = o.q.requestId ? o.r.pending.get(o.q.requestId) : undefined; if (p) p.ladder = o.q.level; this.wake(o); return; }
    this.toUser(o);
  }

  private wake(o: Open): void {
    const holder = o.q.holder;
    if (!holder) return;
    const q = o.q, text = ladderMessage(AGENT_LABEL, { id: o.r.s.id, title: o.r.s.title || 'Chat', role: this.roleOf(o.r) }, q, q.level === 'orchestrator' ? 'orchestrator' : 'child', o.why);
    this.arm(o);
    void this.send(holder, text, undefined, false, o.r.s.title || 'Chat', false, { kind: 'app' }).catch(e => {
      if (this.quitting) return; // the app is closing: the next start wakes this same level again (ladderBoot)
      log.warn('chats', 'question not delivered to the level above: it goes up', { chat: o.r.s.id, cause: errText(e), hint: 'the holder could not be woken', data: { holder } });
      if (o.q.holder === holder) this.up(o, 'skipped', 'non raggiungibile');
    });
  }
  private arm(o: Open): void {
    clearTimeout(o.timer);
    const holder = o.q.holder;
    o.timer = setTimeout(() => { if (o.q.holder === holder && !this.quitting) this.up(o, 'skipped', 'silenziosa da 10 minuti'); }, LADDER_SILENT_MS);
    (o.timer as { unref?: () => void }).unref?.();
  }

  /** The question reached the user: its own request in his row, or the app's card with the same words. */
  private toUser(o: Open): void {
    const r = o.r, req = o.q.requestId ? r.pending.get(o.q.requestId) : undefined;
    if (!req) { this.showOwn(o); return; }
    delete req.ladder;
    if (this.awayAnswered(r, req)) return;
    if (r.s.state === 'running') r.s.state = 'waiting';
    this.reveal(r, req);
  }

  /** night: false = the app's answer just failed to arrive: the card, with no second try. */
  private showOwn(o: Open, night = true): void {
    const q = o.q, id = askId(q.id), questions: Question[] = q.asks.map(a => ({ question: a.question, multiSelect: !!a.multiSelect, options: (a.options.length ? a.options : ['Sì', 'No']).map(label => ({ label })) }));
    // night mode: the recommended option, as for any question (ADR 0191)
    const auto = night && this.opts.away?.() ? recommendedAnswers(questions) : null;
    if (auto) { this.giveBack(o, { by: 'app', name: 'Modalità notte', answer: Object.values(auto).flat().join(' · '), why: 'opzione consigliata', at: Date.now() }); return; }
    const req: PendingRequest = { id, chatId: o.r.s.id, type: 'question', tool: LADDER_TOOL, title: questions[0]!.question, detail: '', input: { chatId: o.r.s.id }, questions, at: Date.now() };
    this.userAsks.set(id, req);
    this.opts.emitter.emit('pending:added', req);
    const on = this.opts.onWaiting;
    if (on) this.hook('onWaiting', () => on(o.r.s.id, req));
  }

  /** Night mode just went on: the app's cards already in the user's row, as showOwn settles a new one (ADR 0191). */
  protected override ladderAway(): number {
    let n = 0;
    for (const req of [...this.userAsks.values()]) {
      const o = req.tool === LADDER_TOOL ? this.byAsk(req.id) : undefined, night = o && !o.sending ? recommendedAnswers(req.questions ?? []) : null;
      if (!o || !night) continue;
      this.ownAnswered(o, { by: 'app', name: 'Modalità notte', answer: Object.values(night).flat().join(' · '), why: 'opzione consigliata', at: Date.now() });
      n++;
    }
    return n;
  }

  // ---- the answer

  /** The chat that holds a question answers it, or passes it one level up (askUser). */
  async ladderReply(callerId: string, a: LadderReply): Promise<{ answered: string; askUser: boolean }> {
    const r = this.need(a.chatId);
    const mine = this.openOf(r).filter(o => o.q.holder === callerId && (!a.requestId || o.q.id === a.requestId || o.q.requestId === a.requestId));
    const o = mine[0];
    if (!o) throw new Error('Nessuna domanda di questa chat aspetta te: ha già avuto risposta, è salita di un livello o è dell’utente.');
    if (mine.length > 1) throw new Error(`Più domande aperte: indica requestId (${mine.map(m => m.q.id).join(', ')}).`);
    if (o.sending || o.q.requestId && this.answering.get(r)?.has(o.q.requestId)) throw new Error('Request already answered; delivery is still pending.');
    const why = oneLine(a.why ?? '').slice(0, WHY_MAX), title = r.s.title || 'Chat';
    if (a.askUser) { this.up(o, 'passed', why || oneLine(a.answer ?? '').slice(0, WHY_MAX) || 'non può deciderlo'); return { answered: title, askUser: true }; }
    const answer = (a.answer ?? '').trim();
    if (!answer || answer.length > ANSWER_MAX) throw new Error(`answer = da 1 a ${ANSWER_MAX} caratteri, oppure askUser: true.`);
    if (!why) throw new Error('why = da dove viene la risposta (richiesta, decisione scritta dell’utente, cervello, codice). Senza una fonte: askUser: true.');
    if (reserved(o.q)) throw new Error('bloccato: produzione, database, Azure, permessi, obiettivo, colleghi, QA, clienti o passi senza ritorno li decide solo l’utente: askUser: true.');
    const by = this.chats.get(callerId);
    const done: LadderAnswer = { by: o.q.level, chatId: callerId, name: by ? this.nameOfRec(by) : 'Chat', answer, why, at: Date.now() };
    const req = o.q.requestId ? r.pending.get(o.q.requestId) : undefined;
    if (!req) { await this.byMessage(o, done); return { answered: title, askUser: false }; }
    const text = ladderAnswerText(done);
    const given: Answer = { kind: 'question', answers: Object.fromEntries(req.questions!.map(q => [q.question, q.multiSelect ? [text] : text])) };
    if (!this.policyAnswer(r, req, given, 'ladder', undefined, () => this.settle(o, done))) throw new Error('La risposta non è arrivata alla chat: la domanda resta aperta.');
    return { answered: title, askUser: false };
  }

  /** The answer of a question with no engine request open: a message to the worker. Settled only once delivered. */
  private async byMessage(o: Open, done: LadderAnswer): Promise<void> {
    const asked = `alla tua domanda «${short(oneLine(ladderText(o.q)))}»`;
    const text = done.by === 'user' ? `[risposta dell’utente ${asked}, data nell’app]\n${done.answer}` : `${AGENT_LABEL}\n\n[risposta ${asked}]\n${ladderAnswerText(done)}`;
    o.sending = true;
    try {
      await this.send(o.r.s.id, text, undefined, false, 'App', false, { kind: 'app' });
      // his answer to a Strategist's interview counts like the one on its own panel
      if (done.by === 'user' && o.q.asks.length === 1) this.interviewed(o.r, [{ question: o.q.asks[0]!.question }], { [o.q.asks[0]!.question]: done.answer }, false);
      this.settle(o, done);
    } finally { delete o.sending; }
  }

  /** Closed: who answered and why stay on the record and on one line of the worker's chat. */
  private settle(o: Open, done: LadderAnswer, line = true): void {
    if (o.q.answered) return;
    clearTimeout(o.timer);
    const r = o.r, { holder: _h, requestId: _r, ...rest } = o.q;
    this.put(o, { ...rest, answered: ladderAnswer(done), trail: withStep(o.q, { level: done.by === 'app' ? o.q.level : done.by, name: done.name, at: done.at, action: 'answered', ...(done.chatId ? { chatId: done.chatId } : {}), ...(done.why ? { why: done.why } : {}) }) }, true);
    this.ladder.delete(o.q.id);
    r.s.questions = keepLadder(r.s.questions ?? []);
    this.dropUserAsks(q => q.id === askId(o.q.id));
    if (!this.openOf(r).length) delete r.askedParentAt;
    // the user's own answer to a question that only he saw is already in the chat: no second line
    if (line && (done.by !== 'user' || o.q.trail.length > 2)) this.addItem(r, sysItem('ladderAnswered', { question: short(ladderText(o.q)), who: done.name, answer: short(done.answer), why: done.why || '—' }, 'info'), false);
    log.info('chats', 'question answered on the ladder', { chat: r.s.id, data: { question: o.q.id, by: done.by, steps: o.q.trail.length } });
    this.persist();
    this.updated(r);
  }

  /** The app's card answered by the user. */
  protected override answerUserAction(req: PendingRequest, answer: Answer): void {
    if (req.tool !== LADDER_TOOL) { super.answerUserAction(req, answer); return; }
    const o = this.byAsk(req.id);
    if (!o || answer.kind !== 'question') throw new Error('Questa richiesta non è più aperta.');
    const text = [...new Set(Object.values(answer.answers).flat())].join(' · ').trim();
    if (!text) throw new Error('Rispondi alla domanda.');
    this.ownAnswered(o, { by: 'user', name: 'utente', answer: text, why: '', at: Date.now() });
  }
  private ownAnswered(o: Open, done: LadderAnswer): void {
    if (o.sending) throw new Error('Request already answered; delivery is still pending.');
    this.dropUserAsks(q => q.id === askId(o.q.id));
    this.giveBack(o, done);
  }
  /** An answer that does not arrive puts the question, if still open, in the user's row: never tried again by itself. */
  private giveBack(o: Open, done: LadderAnswer): void {
    void this.byMessage(o, done).catch(e => {
      log.warn('chats', 'answer not delivered to the worker: its question is back', { chat: o.r.s.id, cause: errText(e), hint: 'answer it again once the chat runs' });
      if (!o.q.answered && this.ladder.has(o.q.id)) this.showOwn(o, false);
    });
  }

  /** The Orchestrator answering for the user (ADR 0275): only a question that reached him, and never one that is his alone. */
  override answerForUser(chatId: string, requestId: string, answer: Answer, confirmed = false): void {
    const o = this.openOf(this.need(chatId)).find(x => x.q.requestId === requestId || x.q.id === requestId || askId(x.q.id) === requestId);
    if (o) {
      if (o.q.level !== 'user') throw new Error('bloccato: la domanda è ancora di un agente; risponde chi la tiene, con answer e why, o la passa con askUser: true.');
      if (reserved(o.q)) throw new Error('bloccato: questa domanda la decide solo l’utente (il suo clic o le sue parole).');
      if (!o.q.requestId) {
        if (answer.kind !== 'question') throw new Error('È una domanda: rispondi con answers.');
        const text = Object.values(answer.answers).flat().join(' · ').trim();
        if (!text) throw new Error('Rispondi a ogni domanda della richiesta.');
        this.ownAnswered(o, { by: 'orchestrator', name: 'Orchestrator', answer: text, why: 'risponde per l’utente', at: Date.now() });
        return;
      }
    }
    super.answerForUser(chatId, requestId, answer, confirmed);
  }
  /** The user's own words answer the app's card too (ADR 0274). */
  override answerWithUserWords(chatId: string, requestId: string, words: string): void {
    const own = this.userAsks.get(requestId), o = own?.tool === LADDER_TOOL && own.chatId === chatId ? this.byAsk(requestId) : undefined;
    if (!o) { super.answerWithUserWords(chatId, requestId, words); return; }
    const said = this.openOrchestrator()?.userSaid;
    if (!said || said.at < own!.at || !sameWords(said.text, words) || asksToExplain(said.text)) throw new Error('bloccato: words deve essere copiato dal suo ultimo messaggio, scritto dopo la domanda; se non risponde a questa domanda lasciala aperta');
    this.ownAnswered(o, { by: 'user', name: 'utente', answer: said.text.trim(), why: '', at: Date.now() });
  }

  // ---- what other layers tell it

  /** An open request was answered by someone (the user, night mode, the Orchestrator for him). */
  protected override requestAnswered(r: Rec, req: Pick<PendingRequest, 'id'>, answer: Answer, actor: DecisionActor): void {
    const o = this.openOf(r).find(x => x.q.requestId === req.id), policy = actor.kind === 'policy' ? actor.policy : actor.kind;
    if (!o || policy === 'ladder') return; // the holder's answer settles it once its engine has it (ladderReply)
    const given = answer.kind === 'question' ? Object.values(answer.answers).flat().map(withoutAppNote).join(' · ') : '—', at = Date.now();
    if (actor.kind === 'user') this.settle(o, { by: 'user', name: 'utente', answer: given, why: '', at });
    else if (policy === 'orchestrator-user-words') this.settle(o, { by: 'user', name: 'utente', answer: given, why: 'le sue parole, passate dall’Orchestrator', at }, false);
    else if (policy === 'orchestrator-for-user') this.settle(o, { by: 'orchestrator', name: 'Orchestrator', answer: given, why: 'risponde per l’utente', at }, false);
    else this.settle(o, { by: 'app', name: policy === 'away' ? 'Modalità notte' : 'App', answer: given, why: policy === 'away' ? 'opzione consigliata' : policy, at });
  }

  /** A request left its chat unanswered: withdrawn by its engine (Stop), or lost with it. An engine that exits resolves
   *  its requests first and only then ends, so it is decided after the current event. */
  protected override requestGone(r: Rec, requestId: string): void {
    const o = this.openOf(r).find(x => x.q.requestId === requestId), session = r.session;
    if (!o) return;
    setImmediate(() => {
      if (o.q.answered || o.q.requestId !== requestId || this.quitting || this.withdrawn(o)) return;
      if (session && r.session === session && session.alive) { this.settle(o, { by: 'app', name: 'App', answer: '—', why: 'domanda ritirata dal suo motore', at: Date.now() }); return; }
      const { requestId: _gone, ...rest } = o.q;
      this.put(o, { ...rest, via: 'message' }, true);
      if (o.q.level === 'user') this.showOwn(o);
      this.persist();
      this.updated(r);
    });
  }

  /** The worker is closed, reported or gone: its question waits for nobody. */
  private withdrawn(o: Open): boolean {
    const r = o.r, gone = this.chats.get(r.s.id) !== r || r.s.closedAt ? 'chat chiusa' : r.s.delegation?.result && !o.q.requestId ? 'la chat ha consegnato senza aspettarla' : null;
    if (!gone) return false;
    this.settle(o, { by: 'app', name: 'App', answer: '—', why: gone, at: Date.now() });
    return true;
  }

  /** A chat is going away for good or closing: what it held goes up, what it asked is withdrawn. */
  protected override ladderClosed(r: Rec): void {
    if (this.quitting) return;
    for (const o of [...this.ladder.values()]) {
      if (o.r === r) this.settle(o, { by: 'app', name: 'App', answer: '—', why: 'chat chiusa', at: Date.now() });
      else if (o.q.holder === r.s.id) this.up(o, 'skipped', 'chat chiusa');
    }
  }

  /** Every change of a chat: one that can no longer answer passes up what it holds, one that ended withdraws its own. */
  protected override updated(r: Rec): void {
    super.updated(r);
    if (!this.ladder?.size || this.quitting) return;
    for (const o of [...this.ladder.values()]) {
      if (o.r === r) { if (!o.sending) this.withdrawn(o); continue; }
      if (o.q.holder !== r.s.id || o.sending || o.moving) continue;
      const gone = this.unavailable(r);
      if (gone) this.up(o, 'skipped', gone);
    }
  }

  /** After a start: every saved open question is back, its level waited anew (an engine's request is gone with it). */
  protected override ladderBoot(): void {
    for (const r of this.chats.values()) for (const o of this.openOf(r)) {
      if (this.withdrawn(o)) continue;
      r.askedParentAt = Date.now(); // it still waits for an answer (#152)
      if (o.q.level === 'user') { if (!o.q.requestId) this.showOwn(o); }
      else if (!o.timer) this.wake(o);
    }
  }

  /** The questions a chat holds (agent_children, app_pending). */
  ladderHeldBy(holderId: string): { chatId: string; title: string; q: LadderQuestion }[] {
    return [...this.chats.values()].flatMap(r => openQuestions(r.s.questions).filter(q => q.holder === holderId).map(q => ({ chatId: r.s.id, title: r.s.title || 'Chat', q })));
  }

  /** The Orchestrator asks as its own a question a work chat has on the ladder: that question goes to the user with its
   *  own words (asked once). The id it shows under, null = none. */
  protected override ladderOwnAsk(asked: string): { r: Rec; id: string } | null {
    const o = [...this.ladder.values()].find(x => !x.sending && !x.q.answered && (x.q.level === 'user' ? !x.q.requestId : this.chats.get(x.q.holder ?? '')?.s.isOrchestrator) && sameAsk(ladderText(x.q), asked));
    if (!o) return null;
    if (o.q.level !== 'user') this.up(o, 'passed', 'lo chiede all’utente');
    return o.q.answered ? null : { r: o.r, id: o.q.requestId ?? askId(o.q.id) };
  }

  // ---- small things

  /** The open questions of a chat; a saved one is picked up the first time. */
  private openOf(r: Rec): Open[] {
    return openQuestions(r.s.questions).map(q => {
      let o = this.ladder.get(q.id);
      if (!o) { o = { r, q }; this.ladder.set(q.id, o); }
      return o;
    });
  }
  private byAsk(id: string): Open | undefined { return [...this.ladder.values()].find(o => askId(o.q.id) === id); }
  private put(o: Open, patch: Partial<LadderQuestion>, whole = false): void {
    const id = o.q.id;
    o.q = whole ? patch as LadderQuestion : { ...o.q, ...patch };
    o.r.s.questions = (o.r.s.questions ?? []).map(q => q.id === id ? o.q : q);
  }
  private roleOf(r: Rec): string {
    const role = r.s.delegation?.role ?? r.s.agent?.id;
    return r.s.isOrchestrator ? 'Orchestrator' : role && isWorkRole(role) ? ROLE_DEFAULTS[role].name : r.s.agent?.name ?? 'Chat';
  }
  private nameOfRec(r: Rec): string { return r.s.isOrchestrator ? 'Orchestrator' : `${this.roleOf(r)} «${oneLine(r.s.title || 'Chat')}»`; }
  private nameOf(q: LadderQuestion): string {
    if (q.level === 'user') return 'utente';
    const rec = q.holder ? this.chats.get(q.holder) : undefined;
    return rec ? this.nameOfRec(rec) : 'Chat chiusa';
  }
}

/** Its words and its options: what only the user decides (ladderReserved), at every level. */
const reserved = (q: LadderQuestion): boolean => ladderReserved([ladderText(q), ...q.asks.flatMap(x => x.options)].join('\n'), touchesProdDbAzure);
const askId = (questionId: string): string => `ladder-${questionId}`;
const short = (s: string): string => { const t = oneLine(s); return t.length > 200 ? `${t.slice(0, 199)}…` : t; };
