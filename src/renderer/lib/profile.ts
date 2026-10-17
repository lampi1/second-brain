// Renderer half of the owner's profile (me.md): the form ⇄ fields mapping and the save-error mapping, shared by
// Settings → Il mio profilo (components/ProfileSettings.tsx) and the first interview. Main checks everything again
// (src/main/brain/profile.ts); this only keeps the form honest. Unit tests: test/unit/profile-form.test.ts.
import type { OwnerProfile, ProfileFields } from '@shared/profile';
import { PROFILE_LIMITS } from '@shared/profile';

export interface ProfileForm { name: string; role: string; language: string; mainWork: string; replyStyle: string }
export const profileForm = (p: Pick<OwnerProfile, keyof ProfileFields>): ProfileForm =>
  ({ name: p.name, role: p.role, language: p.language, mainWork: p.mainWork.join('\n'), replyStyle: p.replyStyle });
/** one area per line; a leading "- ", "* " or "• " is a bullet, "**Acme**" is not. Never truncated: main refuses too many. */
export const workAreas = (text: string): string[] =>
  text.split(/\r?\n/).map(l => l.replace(/^\s*[-*•]\s+/, '').trim()).filter(Boolean);
export const tooManyAreas = (form: ProfileForm) => workAreas(form.mainWork).length > PROFILE_LIMITS.areas;
/** only the fields the user edited and that are not locked: an untouched field is never sent, even if it would normalize */
export function changedFields(base: OwnerProfile, form: ProfileForm): Partial<ProfileFields> {
  const out: Partial<ProfileFields> = {}, locked = new Set(base.locked), was = profileForm(base);
  for (const key of ['name', 'role', 'language', 'replyStyle'] as const) if (!locked.has(key) && form[key] !== was[key] && form[key].trim() !== base[key]) out[key] = form[key].trim();
  if (!locked.has('mainWork') && form.mainWork !== was.mainWork) {
    const areas = workAreas(form.mainWork);
    if (areas.join('\n') !== base.mainWork.join('\n')) out.mainWork = areas;
  }
  return out;
}
/** after a concurrent edit: fields the user did not touch take the new values, the user's edits stay as typed */
export function rebaseForm(form: ProfileForm, before: OwnerProfile, after: OwnerProfile): ProfileForm {
  const was = profileForm(before), now = profileForm(after), out = { ...form };
  for (const key of Object.keys(out) as (keyof ProfileForm)[]) if (out[key] === was[key]) out[key] = now[key];
  return out;
}
export type ProfileError = 'changed' | 'invalid' | 'noBrain' | 'error';
export function profileError(error: unknown): ProfileError {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes('PROFILE_CHANGED') ? 'changed' : text.includes('PROFILE_FIELDS') || text.includes('PROFILE_UNRECOGNIZED') ? 'invalid' : text.includes('PROFILE_NO_BRAIN') ? 'noBrain' : 'error';
}
