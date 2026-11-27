// A password on the clipboard, for a short while only (ADR 0012, ADR 0367): the user's «Copia» on a login hand-off, the
// "Credenziali" panel or the Orchestrator's credentials card writes it; after `ms` (30 s) the clipboard gets back what
// it held before the copy, or is cleared when that was nothing, but only if it still holds the password (the user may
// have copied something else meanwhile: that stays). Agents may not paste while it is there (Credentials.markCopied).
// Pure apart from the clipboard and timer it is given; used by browser/service.ts, tested by
// test/unit/password-clip.test.ts with fake timers and an in-memory clipboard.

export interface ClipLike { writeText(text: string): void; readText(): string | Promise<string>; clear(): void }
export interface PasteGuard { markCopied(ms: number): void; cleared(): void }

export interface PasswordClip {
  /** the user's click: the password goes on the clipboard now; the earlier content comes back after `ms` */
  copy(password: string): void;
  /** now (the timer, the app closing): the clipboard gets its earlier content back if it still holds the password */
  restore(): Promise<void>;
}

export function passwordClip(clip: ClipLike, guard: PasteGuard, ms: number): PasswordClip {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let copied: string | null = null;
  /** what the clipboard held before the first password of this round (a second copy keeps the first round's) */
  let before: string | null = null;
  const restore = async (): Promise<void> => {
    if (timer) { clearTimeout(timer); timer = null; }
    const pw = copied, prev = before;
    copied = null; before = null;
    guard.cleared();
    if (pw === null || (await Promise.resolve(clip.readText())) !== pw) return;
    if (prev) clip.writeText(prev); else clip.clear();
  };
  return {
    copy(password: string): void {
      if (copied === null) {
        // read synchronously when the clipboard allows it (Electron's does): the earlier text must be taken before the write
        const now = clip.readText();
        before = typeof now === 'string' ? now : null;
      }
      clip.writeText(password);
      copied = password;
      guard.markCopied(ms);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void restore(); }, ms);
      (timer as { unref?: () => void }).unref?.();
    },
    restore,
  };
}
