// Main-owned automatic archive scheduler. Requires fresh presence, current backend guards, and 120 seconds of
// acknowledged warning; no renderer fade or stale deadline can authorize closure. Clock/IO are injected for tests.
import type { AutoClosePresence, AutoCloseStatus, AutoCloseWaiting } from '../../shared/auto-close';

export const AUTO_CLOSE_WARNING_MS = 120_000;
export const PRESENCE_LEASE_MS = 15_000;
/** Epoch-shaped monotonic clock: wall-clock adjustments cannot shorten leases or the acknowledged warning. */
export const autoCloseNow = (): number => performance.timeOrigin + performance.now();
export interface AutoCloseCandidate {
  id: string;
  /** Full current lifecycle fingerprint: turn/result/activity, delivery/mail/tasks/pending generations. */
  stamp: string;
  /** Main clock only. A restored old result never skips the warning. */
  activityAt: number;
  /** False for Regia/app/coordinating agents, active delivery/mail/tools/children/pending/errors or uncertain telemetry. */
  eligible: boolean;
  reason?: string;
  /** what a held chat waits for (ADR 0076): shown as "In attesa di…" on its tile */
  waitingFor?: AutoCloseWaiting;
}
export interface AutoCloseReservation { generation: number; deadline: number; stamp: string }
export interface AutoCloseDeps {
  /** Production supplies autoCloseNow, never Date.now. Tests inject monotonic fake time. */
  now: () => number;
  delayMs: () => number;
  candidates: () => AutoCloseCandidate[];
  /** Manager must check stillValid synchronously before reserving and again after each await, before closing/dropping
   * pending/browser state. Return false on cancellation. Never start a model turn to auto-archive. */
  archive: (chatId: string, reservation: AutoCloseReservation, stillValid: () => boolean) => Promise<boolean>;
  emit: (status: AutoCloseStatus[]) => void;
  initialKeptOpen?: readonly string[];
  saveKeptOpen?: (ids: string[]) => void;
}
interface Presence extends AutoClosePresence { receivedAt: number; rendererTouch: number }
interface Entry { status: AutoCloseStatus; fingerprint: string | null }

export class AutoCloseService {
  private readonly presence = new Map<string, Presence>();
  private readonly entries = new Map<string, Entry>();
  private readonly kept = new Set<string>();
  private readonly inFlight = new Set<string>();
  private nextGeneration = 1;
  private lastEmission = '';
  constructor(private readonly d: AutoCloseDeps) { for (const id of d.initialKeptOpen ?? []) this.kept.add(id); }
  state(): AutoCloseStatus[] { const clockAt = this.d.now(); return [...this.entries.values()].map(e => ({ ...e.status, clockAt })); }
  private emit(): void {
    const states = this.state(), key = JSON.stringify(states.map(({ clockAt: _clock, ...s }) => s));
    if (key === this.lastEmission) return;
    this.lastEmission = key; this.d.emit(states);
  }

  setPresence(rows: readonly AutoClosePresence[]): void {
    const now = this.d.now();
    const candidates = new Set(this.d.candidates().map(c => c.id));
    for (const p of rows.slice(0, 1000)) {
      if (!p || typeof p.chatId !== 'string' || typeof p.draft !== 'boolean' || typeof p.shown !== 'boolean' || typeof p.browser !== 'boolean' || !Number.isFinite(p.touchedAt) || !Number.isSafeInteger(p.queued) || p.queued < 0) continue;
      if (!candidates.has(p.chatId)) continue;
      const previous = this.presence.get(p.chatId);
      const rendererTouch = p.touchedAt > 0 ? p.touchedAt : previous?.rendererTouch ?? 0;
      // Changed positive hints (including a renderer restart) can only extend a hold. Backend time never moves back.
      const touchedAt = rendererTouch !== (previous?.rendererTouch ?? 0) ? now : previous?.touchedAt ?? 0;
      this.presence.set(p.chatId, { ...p, touchedAt, rendererTouch, receivedAt: now });
      const e = this.entries.get(p.chatId);
      if (e && e.status.warningStartedAt !== null && e.status.deadline !== null && (p.ackDeadline !== e.status.deadline || p.ackGeneration !== e.status.generation)) {
        // The warning disappeared behind a modal, scroll or a hidden window: its visible interval must start again.
        e.status.warningStartedAt = null; e.status.deadline = now + AUTO_CLOSE_WARNING_MS; e.status.generation = this.nextGeneration++;
      }
      if (e && !p.draft && !p.shown && !p.browser && e.status.warningStartedAt === null && p.ackDeadline === e.status.deadline && p.ackGeneration === e.status.generation && e.status.deadline !== null && e.status.deadline - now <= AUTO_CLOSE_WARNING_MS) {
        e.status.warningStartedAt = now;
        e.status.deadline = Math.max(e.status.deadline, now + AUTO_CLOSE_WARNING_MS);
      }
    }
    this.refresh();
  }

  keepOpen(chatId: string, keep = true): void {
    if (keep) this.kept.add(chatId); else this.kept.delete(chatId);
    const e = this.entries.get(chatId); if (e) this.cancel(e, keep ? 'Tenuto aperto da te' : 'Chiusura automatica riattivata');
    this.d.saveKeptOpen?.([...this.kept]);
    this.refresh();
  }

  /** Invalidate before the first await of send/mail/handoff, and on pending/tool/child lifecycle changes. */
  invalidate(chatId: string, reason = 'Nuova attività'): void {
    const e = this.entries.get(chatId); if (e) { this.cancel(e, reason); this.emit(); }
  }

  private hold(c: AutoCloseCandidate, now: number): string | null {
    if (this.kept.has(c.id)) return 'Tenuto aperto da te';
    if (!(this.d.delayMs() > 0) || !Number.isFinite(this.d.delayMs())) return 'Chiusura automatica disattivata';
    if (!c.eligible || !Number.isFinite(c.activityAt)) return c.reason || 'Lavoro o attività da completare';
    const p = this.presence.get(c.id);
    if (!p || now - p.receivedAt >= PRESENCE_LEASE_MS || now < p.receivedAt) return 'Presenza non aggiornata: chiusura sospesa';
    if (p.draft) return 'Bozza in composizione';
    if (p.queued > 0) return 'Messaggi in coda';
    if (p.shown || p.browser) return 'Agente o browser in uso';
    return null;
  }
  private cancel(e: Entry, reason: string): void {
    if (e.status.deadline !== null || e.status.reason !== reason) e.status.generation = this.nextGeneration++;
    e.status.deadline = null; e.status.warningStartedAt = null; e.status.reason = reason; e.fingerprint = null;
    e.status.keptOpen = this.kept.has(e.status.chatId);
  }
  refresh(): void {
    const now = this.d.now(), candidates = this.d.candidates();
    const ids = new Set(candidates.map(c => c.id));
    for (const id of this.entries.keys()) if (!ids.has(id) && !this.inFlight.has(id)) { this.entries.delete(id); this.presence.delete(id); }
    for (const c of candidates) {
      let e = this.entries.get(c.id);
      if (!e) { e = { status: { chatId: c.id, deadline: null, warningStartedAt: null, generation: this.nextGeneration++, keptOpen: this.kept.has(c.id), reason: null, clockAt: now }, fingerprint: null }; this.entries.set(c.id, e); }
      const held = this.hold(c, now);
      if (held) {
        this.cancel(e, held);
        if (!c.eligible && c.waitingFor && !this.kept.has(c.id)) e.status.waitingFor = c.waitingFor; else delete e.status.waitingFor;
        continue;
      }
      const p = this.presence.get(c.id)!;
      const fingerprint = JSON.stringify([c.stamp, c.activityAt, p.touchedAt, this.d.delayMs()]);
      if (fingerprint !== e.fingerprint) {
        e.fingerprint = fingerprint;
        e.status = { chatId: c.id, generation: this.nextGeneration++, keptOpen: false, deadline: Math.max(Math.min(c.activityAt, now) + this.d.delayMs(), p.touchedAt + this.d.delayMs(), now + AUTO_CLOSE_WARNING_MS), warningStartedAt: null, reason: null, clockAt: now };
      }
    }
    this.emit();
  }

  /** Call on lifecycle changes and an inexpensive main timer. A late/stalled timer never shortens the warning. */
  async tick(): Promise<void> {
    this.refresh();
    const now = this.d.now();
    for (const e of this.entries.values()) {
      const s = e.status;
      if (this.inFlight.has(s.chatId) || s.deadline === null || now < s.deadline) continue;
      if (s.warningStartedAt === null || now - s.warningStartedAt < AUTO_CLOSE_WARNING_MS) {
        s.deadline = now + AUTO_CLOSE_WARNING_MS; s.warningStartedAt = null; s.generation = this.nextGeneration++; this.emit(); continue;
      }
      const candidate = this.d.candidates().find(c => c.id === s.chatId);
      if (!candidate || this.hold(candidate, now)) continue;
      const expected: AutoCloseReservation = { generation: s.generation, deadline: s.deadline, stamp: candidate.stamp };
      const expectedTouch = this.presence.get(s.chatId)!.touchedAt;
      const valid = () => {
        const current = this.entries.get(s.chatId)?.status;
        const live = this.d.candidates().find(c => c.id === s.chatId);
        const presence = this.presence.get(s.chatId);
        return !!current && !!live && !!presence && current.generation === expected.generation && current.deadline === expected.deadline && live.stamp === expected.stamp && live.activityAt === candidate.activityAt && !this.hold(live, this.d.now()) && presence.touchedAt === expectedTouch;
      };
      this.inFlight.add(s.chatId);
      try { if (valid()) await this.d.archive(s.chatId, expected, valid); }
      finally { this.inFlight.delete(s.chatId); this.cancel(e, 'Scadenza conclusa: rilettura dello stato'); this.emit(); }
    }
  }
}
