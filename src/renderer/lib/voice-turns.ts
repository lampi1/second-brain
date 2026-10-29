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
  private flushing = false;
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
    this.schedule();
  }
  /** Push to talk released and everything said is heard: what is held goes now, no wait for more (a transcript still
   *  on its way goes with it when it comes). */
  flush(): void {
    this.clearTimer();
    this.flushing = true;
    for (const [id, p] of this.pending) if (p.echo) this.pending.delete(id);
    if (this.pending.size) return;
    this.flushing = false;
    const held = this.held;
    if (!held) return;
    this.held = null;
    if (!this.d.current(held.target) || (held.target.questionId && !held.target.answerable)) this.d.draft(held.target, held.text);
    else this.d.deliver(held.target, held.text);
  }
  reset(preserve = false): void {
    this.clearTimer(); this.pending.clear(); this.flushing = false;
    const held = this.held; this.held = null;
    if (preserve && held) this.d.draft(held.target, held.text);
  }
  private clearTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private schedule(): void {
    if (this.flushing) { this.flush(); return; }
    if (this.d.manual?.()) return;
    if (!this.held || [...this.pending.values()].some(p => !p.echo)) return;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      const held = this.held;
      this.held = null;
      if (!held) return;
      if (!this.d.current(held.target) || (held.target.questionId && !held.target.answerable)) this.d.draft(held.target, held.text);
      else this.d.deliver(held.target, held.text);
    }, this.d.delay ?? 700);
  }
}
