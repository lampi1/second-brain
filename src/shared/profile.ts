// The owner's profile as the app shows it: the managed fields of the brain's me.md ("Who" and "How to work with").
// Shared by main (src/main/brain/profile.ts reads and patches the file) and the renderer (Settings → Il mio profilo,
// first interview). Only these fields are ever written by the app; the rest of me.md stays byte-identical.

/** The fields the app may change in me.md. Everything else is read-only here and grows through the brain-edit skill. */
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
  /** the template's "Reply style" text ('' when unknown): the first interview may replace it, never a custom one */
  replyStyleDefault: string;
  /** fields the file's layout does not let the app change safely (left to the brain-edit skill) */
  locked: (keyof ProfileFields)[];
  /** how the brain grows with use: the journal days written and the latest one (YYYY-MM-DD) */
  growth: { journalDays: number; lastJournal: string | null };
  path: string;
}
export type ProfileResult = { ok: true; profile: OwnerProfile } | { ok: false; reason: 'no-brain' | 'missing' | 'unreadable' };
export interface ProfileSave { revision: string; fields: Partial<ProfileFields> }
/** limits of the editable fields, shared by the form and main's checks */
export const PROFILE_LIMITS = { name: 80, role: 240, language: 40, area: 160, areas: 12, replyStyle: 600 } as const;
/** text a field may not carry, shared with the interview: the name heads the file and sits in headings, role and
 * language share the "Name, role. Language: x in chat" line */
export const PROFILE_FORBIDDEN = { name: /[#*`[\]<>|_\\]/, role: /\. Language: /, language: / in chat|\. Language: / } as const;
/** what a brain created before the owner introduced themselves says (default-brain.ts, install.mjs): "not known yet" */
export const PROFILE_PLACEHOLDERS = { name: ['Tu', 'You'], role: ['Da conoscere insieme', 'To discover together'] } as const;
/** the first interview's reply styles as written into me.md (the template's own text stands for "balanced") */
export const REPLY_PRESETS = {
  concise: 'short and direct: first line = the answer or the next action; no preambles, recaps or closing lines.',
  detailed: 'thorough: the answer first, then the reasoning step by step with examples; define new terms.',
} as const;
