// The owner's profile as the app shows it: the managed fields of the brain's me.md ("Who" and "How to work with").
// Shared by main (src/main/brain/profile.ts reads and patches the file) and the renderer (Settings → Il mio profilo,
// first interview). Only these fields are ever written by the app; the rest of me.md stays byte-identical.

/** The fields the app may change in me.md. Everything else is read-only here and grows through brain-editor. */
export interface ProfileFields {
  name: string;
  role: string;
  language: string;
  /** "Main work": one line per area */
  mainWork: string[];
  /** the "Reply style" rule of "How to work with" */
  replyStyle: string;
}
/** One rule of "How to work with": its bold title and its text (markdown kept as written). */
export interface ProfileRule { title: string; text: string }
export interface OwnerProfile extends ProfileFields {
  /** hash of the file read: a save must send it back (someone else may have changed me.md meanwhile) */
  revision: string;
  /** me.md last modified, epoch ms */
  updatedAt: number;
  rules: ProfileRule[];
  /** fields the file's layout does not let the app change safely (left to brain-editor) */
  locked: (keyof ProfileFields)[];
  /** how the brain grows with use: the journal days written and the latest one (YYYY-MM-DD) */
  growth: { journalDays: number; lastJournal: string | null };
  path: string;
}
export type ProfileResult = { ok: true; profile: OwnerProfile } | { ok: false; reason: 'no-brain' | 'missing' | 'unreadable' };
export interface ProfileSave { revision: string; fields: Partial<ProfileFields> }
/** limits of the editable fields, shared by the form and main's checks */
export const PROFILE_LIMITS = { name: 80, role: 240, language: 40, area: 160, areas: 12, replyStyle: 600 } as const;
