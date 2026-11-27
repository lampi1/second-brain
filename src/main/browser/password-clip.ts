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
  /** what the clipboard held before the password went on it: taken at each copy unless the clipboard still holds the
   *  previous password (then the round's earlier text stays), so a text the user copied between two password copies is
   *  the one that comes back (security review, 2026-11-27) */
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
      // read synchronously when the clipboard allows it (Electron's does): the earlier text must be taken before the write
      const now = clip.readText();
      if (copied === null) before = typeof now === 'string' ? now : null;
      else if (typeof now === 'string' && now !== copied) before = now;
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
