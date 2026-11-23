// The Skill page's requests that must not lose the user's work, as plain functions (no DOM): the request that removes a
// file, the order of the answers when two files open one after the other, the Undo a deletion offers at once. Used by
// components/skills/SkillDetail.tsx; pinned by test/unit/renderer/skill-edit.test.ts.
import type { SkillFileText, SkillWrite } from '@shared/skill-library';

/** Removing the open file: with the mtime of what the user sees, so a file that changed on disk meanwhile is kept. */
export function fileRemoval(skill: string, doc: Pick<SkillFileText, 'path' | 'mtime'>): SkillWrite {
  return { skill, path: doc.path, text: null, mtime: doc.mtime };
}

/** Only the latest request may answer: a slower earlier one (another file, another skill, a closed page) is dropped, so
 *  the editor never shows or saves one file's text under another file's name. */
export interface Latest {
  run<T>(ask: () => Promise<T>, done: (v: T) => void, failed: (e: unknown) => void): void;
  /** for a longer job: starts a request and says whether it still is the latest one */
  ticket(): () => boolean;
  /** from now on no pending answer counts */
  cancel(): void;
}
export function latestOnly(): Latest {
  let n = 0;
  const ticket = () => { const mine = ++n; return () => mine === n; };
  return {
    run(ask, done, failed) {
      const live = ticket();
      ask().then(v => { if (live()) done(v); }, e => { if (live()) failed(e); });
    },
    ticket,
    cancel() { n++; },
  };
}

/** How long the toast of a deletion stays (the store caps at 30 s); «Eliminate di recente» keeps the Undo after it. */
export const UNDO_TTL = 20_000;
/** The toast of a deletion: «Annulla» of that very change, when the history has one. */
export function undoOffer(changeId: string | null | undefined, label: string, undo: (changeId: string) => void): { action?: { label: string; run: () => void }; ttl?: number } {
  return changeId ? { action: { label, run: () => undo(changeId) }, ttl: UNDO_TTL } : {};
}
