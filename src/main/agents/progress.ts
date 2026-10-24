// Legacy milestone storage/API retained for compatibility; production wiring disables it without deleting history.
import path from 'node:path';
import { ACHIEVEMENTS, type AchievementId, type ProgressState } from '../../shared/progress';
import type { ChatSummary } from '../../shared/contract';
import { readLocal, writeLocal } from './local-store';

/** Three local acknowledgements. No chat text, ids, prompts, usage, streaks or remote telemetry are persisted. */
export class ProgressService {
  private readonly file: string;
  private value: Omit<ProgressState, 'available' | 'reason'> = { version: 1, hidden: false, earned: [] };
  private problem: string | undefined;
  constructor(userData: string, private readonly d: { enabled: boolean; chats: () => ChatSummary[]; emit?: (s: ProgressState) => void; now?: () => number }) {
    this.file = path.join(userData, 'progress.json');
    if (!d.enabled) return;
    try {
      const raw = readLocal(this.file) as Partial<ProgressState> | undefined;
      if (raw === undefined) return;
      if (raw.version !== 1 || typeof raw.hidden !== 'boolean' || !Array.isArray(raw.earned) || raw.earned.length > 3 || !raw.earned.every(e => e && (ACHIEVEMENTS as readonly string[]).includes(e.id) && Number.isFinite(e.at) && e.at > 0) || new Set(raw.earned.map(e => e.id)).size !== raw.earned.length) throw new Error('Invalid progress');
      this.value = { version: 1, hidden: raw.hidden, earned: raw.earned.map(({ id, at }) => ({ id, at })) };
    } catch { this.problem = 'I traguardi locali non sono leggibili. Il file è conservato.'; }
  }
  get(): ProgressState { return structuredClone({ ...this.value, available: this.d.enabled && !this.problem, ...(!this.d.enabled ? { reason: 'I traguardi personali sono disattivati.' } : this.problem ? { problem: this.problem, reason: this.problem } : {}) }); }
  private persist(next: Omit<ProgressState, 'available' | 'reason'>): ProgressState {
    if (!this.d.enabled || this.problem) return this.get();
    try { writeLocal(this.file, next); this.value = next; this.d.emit?.(this.get()); }
    catch { this.problem = 'I traguardi non sono stati salvati. Il lavoro e le preferenze restano disponibili.'; }
    return this.get();
  }
  award(id: AchievementId): ProgressState {
    if (!(ACHIEVEMENTS as readonly string[]).includes(id) || this.value.earned.some(e => e.id === id)) return this.get();
    return this.persist({ ...this.value, earned: [...this.value.earned, { id, at: this.d.now?.() ?? Date.now() }] });
  }
  setHidden(hidden: boolean): ProgressState {
    if (typeof hidden !== 'boolean') throw new Error('Preferenza non valida.');
    return hidden === this.value.hidden ? this.get() : this.persist({ ...this.value, hidden });
  }
  confirmResult(chatId: string, resultAt: number): ProgressState {
    if (!this.d.enabled) throw new Error('I traguardi personali sono disattivati.');
    const chat = this.d.chats().find(c => c.id === chatId);
    const result = chat?.lastResult;
    if (!chat || chat.closedAt || chat.state !== 'idle' || chat.pending || chat.lastError || !chat.lastText.trim() || !Number.isFinite(resultAt) || !result || result.at !== resultAt || result.isError || result.interrupted) throw new Error('Conferma un risultato concluso con successo e ancora disponibile.');
    return this.award('first-result');
  }
}
