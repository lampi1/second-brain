// Configuration changes «da applicare» (ADR 0357): what the Orchestrator asked and the app did not apply, because it had
// no proof the user asked it or because the change itself was refused (a model the engine does not list yet). Nothing is
// lost: each one stays an open Sì/No panel that the APP writes, naming the exact change and why it is not applied, until
// the user answers. Sì applies it (in main, by the app: no agent is in between, so nothing said to the Orchestrator
// meanwhile can change what is applied); a Sì that fails leaves it open with the new reason; No drops it. Only the user's
// own click answers it (never night mode, the Orchestrator or the phone). Kept in <userData>/config-pending.json, so a
// restart keeps it. The panels' pattern is run/asks.ts. Used by appctl/config.ts (hold), wiring.ts, ipc-handlers/chats.ts
// (chat:pending, chat:answer); tests in test/unit/appctl-pending-config.test.ts.
import crypto from 'node:crypto';
import type { Answer, EventMap, PendingRequest } from '../../shared/contract';
import { readLocal, writeLocal } from '../agents/local-store';
import { errText, log } from '../log';

export const CONFIG_TOOL = 'app_config_change';
/** At most this many wait at once: a new one past it replaces the oldest. */
export const PENDING_MAX = 20;

/** What is applied: one app_config set of area setting or agent. */
export interface HeldChange { area: 'setting' | 'agent'; key: string; agentId?: string; value: unknown }
export interface PendingChange extends HeldChange {
  id: string;
  at: number;
  /** the Orchestrator that asked it */
  chatId: string;
  /** the exact change in the user's words, written by the app */
  text: string;
  /** why it is not applied yet */
  why: string;
  reason?: string;
}
export interface PendingConfigDeps {
  file?: string;
  /** applies the change with the module that owns it; throws with the reason */
  apply(c: PendingChange): void;
  emit<K extends 'pending:added' | 'pending:resolved'>(channel: K, payload: EventMap[K]): void;
  /** the user's words on a panel that is neither Sì nor No: a clarification for the Orchestrator, never an ok */
  words?(chatId: string, text: string): void;
  /** the open Orchestrator a panel belongs to now (the one that asked may be gone); null = the one that asked */
  owner?(chatId: string): string;
  now?(): number;
}

const same = (a: HeldChange, b: HeldChange) => a.area === b.area && a.key === b.key && (a.agentId ?? '') === (b.agentId ?? '');
const valid = (v: unknown): v is PendingChange => {
  const c = v as PendingChange | null;
  return !!c && typeof c === 'object' && typeof c.id === 'string' && /^cfg_[a-f0-9]{12}$/.test(c.id) && (c.area === 'setting' || c.area === 'agent') && typeof c.key === 'string'
    && (c.agentId === undefined || typeof c.agentId === 'string') && typeof c.chatId === 'string' && typeof c.text === 'string' && typeof c.why === 'string' && Number.isFinite(c.at) && 'value' in c;
};

export class PendingConfig {
  private list: PendingChange[] = [];

  constructor(private readonly d: PendingConfigDeps) {
    const saved = d.file ? readLocal(d.file) : undefined;
    if (Array.isArray(saved)) this.list = saved.filter(valid).slice(-PENDING_MAX);
  }

  private now(): number { return this.d.now?.() ?? Date.now(); }
  private save(): void { if (this.d.file) writeLocal(this.d.file, this.list); }

  /** Keeps a change that was not applied; one of the same setting or card field replaces the earlier one. */
  hold(c: Omit<PendingChange, 'id' | 'at'>): PendingChange {
    for (const old of this.list.filter(x => same(x, c))) this.drop(old);
    while (this.list.length >= PENDING_MAX) this.drop(this.list[0]!);
    const held: PendingChange = { ...c, id: `cfg_${crypto.randomBytes(6).toString('hex')}`, at: this.now() };
    this.list.push(held);
    this.save();
    this.d.emit('pending:added', this.panel(held));
    log.info('appctl', 'configuration change held for the user', { chat: held.chatId, data: { id: held.id, area: held.area, key: held.key, ...(held.agentId ? { agentId: held.agentId } : {}) } });
    return held;
  }

  /** The change was applied another way (the user asked again and the proof held, the page): its panel goes. */
  applied(c: HeldChange): void { for (const old of this.list.filter(x => same(x, c))) this.drop(old); }

  private drop(c: PendingChange): void {
    this.list = this.list.filter(x => x !== c);
    this.save();
    this.d.emit('pending:resolved', { chatId: this.owner(c), requestId: c.id });
  }
  private owner(c: PendingChange): string { return this.d.owner?.(c.chatId) ?? c.chatId; }

  all(): PendingChange[] { return structuredClone(this.list); }
  owns(requestId: string): boolean { return this.list.some(c => c.id === requestId); }

  private panel(c: PendingChange): PendingRequest {
    const question = `${c.text} Applico?`;
    return { id: c.id, chatId: this.owner(c), type: 'question', tool: CONFIG_TOOL, title: question, detail: `Da applicare: ${c.why}`, input: {}, at: c.at,
      questions: [{ question, header: 'Da applicare', multiSelect: false, options: [
        { label: 'Sì (consigliato)', description: `La applico subito. Non applicata finora: ${c.why}` },
        { label: 'No', description: 'Resta tutto com’è.' }] }] };
  }
  /** The open panels, as requests. */
  pending(): PendingRequest[] { return this.list.map(c => this.panel(c)); }

  /** The user's own answer on a panel. */
  answer(requestId: string, answer: Answer): void {
    const c = this.list.find(x => x.id === requestId);
    if (!c || answer.kind !== 'question') throw new Error('Questa richiesta non è più aperta.');
    const given = Object.values(answer.answers).flat().map(x => String(x).replace(/\(consigliat[oa]\)/gi, '').trim());
    if (given.length && given.every(x => x.toLowerCase() === 'sì')) {
      try { this.d.apply(structuredClone(c)); } catch (e) {
        // still to apply, with the reason it has now
        c.why = errText(e);
        this.save();
        this.d.emit('pending:resolved', { chatId: this.owner(c), requestId: c.id });
        this.d.emit('pending:added', this.panel(c));
        throw e instanceof Error ? e : new Error(errText(e));
      }
      log.info('appctl', 'held configuration change applied on the user\'s yes', { chat: c.chatId, data: { id: c.id, key: c.key } });
      this.drop(c);
      return;
    }
    if (given.length && given.every(x => x.toLowerCase() === 'no')) { this.drop(c); return; }
    // his own words: a clarification, never an ok; the panel stays
    const words = given.join(' · ').trim();
    if (!words) throw new Error('Rispondi Sì o No.');
    this.d.words?.(this.owner(c), words);
  }
}
