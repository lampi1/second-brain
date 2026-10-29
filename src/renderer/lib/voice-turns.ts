// Captured speech stays with its original chat/question. A full thought (including corrections across VAD
// segments) is settled before dispatch; stale context becomes a draft. Used by voice.ts, tested with a fake clock.
export interface VoiceTurnTarget {
  chatId: string;
  mode: 'dictate' | 'talk';
  questionId: string | null;
  questionVersion: string | null;
  answerable: boolean;
}
interface Capture { target: VoiceTurnTarget; echo: boolean }
interface Held { target: VoiceTurnTarget; text: string }
export class VoiceTurns {
  private readonly pending = new Map<number, Capture>();
  private held: Held | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closing: Set<number> | null = null;
  constructor(private readonly d: {
    current(target: VoiceTurnTarget): boolean;
    deliver(target: VoiceTurnTarget, text: string): void;
    draft(target: VoiceTurnTarget, text: string): void;
    delay?: number;
    /** push to talk: nothing goes by itself after a pause, only at flush() (the release) */
    manual?: () => boolean;
  }) {}
  start(id: number, target: VoiceTurnTarget, echo: boolean): boolean {
    if (this.pending.has(id)) return false;
    this.pending.set(id, { target: { ...target }, echo });
    if (!echo) this.clearTimer();
    return true;
  }
  finish(id: number, text: string): void {
    const capture = this.pending.get(id);
    if (!capture) return;
    this.pending.delete(id);
    const closing = this.closing?.delete(id) ?? false;
    if (text && !capture.echo) {
      const { target } = capture;
      if (target.mode === 'dictate') this.d.draft(target, text);
      else {
        if (this.held && JSON.stringify(this.held.target) !== JSON.stringify(target)) {
          this.d.draft(this.held.target, this.held.text);
          this.held = null;
        }
        this.held = { target, text: this.held ? `${this.held.text} ${text}` : text };
      }
    }
    if (closing) this.close();
    else this.schedule();
  }
  /** Push to talk released: what is held goes now, no wait for more; the transcripts of this turn still on their way
   *  go with it when they come (the engine decodes in order, so a next press's words always come after them). */
  flush(): void {
    this.clearTimer();
    for (const [id, p] of this.pending) if (p.echo) this.pending.delete(id);
    this.closing = new Set(this.pending.keys());
    this.close();
  }
  /** Esc while holding: this turn's words are dropped; a released turn still closing goes on. */
  drop(): void {
    if (!this.closing?.size) { this.reset(); return; }
    for (const id of [...this.pending.keys()]) if (!this.closing.has(id)) this.pending.delete(id);
  }
  private close(): void {
    if (this.closing?.size) return;
    this.closing = null;
    const held = this.held;
    if (!held) return;
    this.held = null;
    this.send(held);
  }
  private send(held: Held): void {
    if (!this.d.current(held.target) || (held.target.questionId && !held.target.answerable)) this.d.draft(held.target, held.text);
    else this.d.deliver(held.target, held.text);
  }
  reset(preserve = false): void {
    this.clearTimer(); this.pending.clear(); this.closing = null;
    const held = this.held; this.held = null;
    if (preserve && held) this.d.draft(held.target, held.text);
  }
  private clearTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private schedule(): void {
    if (this.closing) return;
    if (this.d.manual?.()) return;
    if (!this.held || [...this.pending.values()].some(p => !p.echo)) return;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      const held = this.held;
      this.held = null;
      if (held) this.send(held);
    }, this.d.delay ?? 700);
  }
}
