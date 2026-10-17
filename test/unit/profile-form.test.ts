// Unit tests of the renderer's profile form (src/renderer/lib/profile.ts): work areas one per line, only changed and
// unlocked fields sent, and main's error codes mapped to the messages the form shows.
import { describe, expect, it } from 'vitest';
import type { OwnerProfile } from '../../src/shared/profile';
import { changedFields, profileError, profileForm, rebaseForm, tooManyAreas, workAreas } from '../../src/renderer/lib/profile';

const base: OwnerProfile = { name: 'Tu', role: 'dev', language: 'italiano', mainWork: ['Billing'], replyStyle: 'short', replyStyleDefault: 'default', rules: [], locked: [], revision: 'r', updatedAt: 0, growth: { journalDays: 0, lastJournal: null }, path: 'me.md' };

describe('profile form', () => {
  it('reads work areas one per line, bullets and blanks dropped, markdown kept, never truncated', () => {
    expect(workAreas('- Billing\n\n • Search \r\n* Mobile')).toEqual(['Billing', 'Search', 'Mobile']);
    expect(workAreas('**Acme**: billing\n-x')).toEqual(['**Acme**: billing', '-x']);
    const many = { ...profileForm(base), mainWork: Array.from({ length: 13 }, (_, i) => 'a' + i).join('\n') };
    expect(workAreas(many.mainWork)).toHaveLength(13);
    expect(tooManyAreas(many)).toBe(true);
  });
  it('sends only what the user edited and never a locked field', () => {
    expect(changedFields(base, profileForm(base))).toEqual({});
    expect(changedFields(base, { ...profileForm(base), role: ' qa ', mainWork: 'Billing\nSearch' })).toEqual({ role: 'qa', mainWork: ['Billing', 'Search'] });
    expect(changedFields({ ...base, locked: ['role', 'language'] }, { ...profileForm(base), role: 'qa', name: 'Giulia' })).toEqual({ name: 'Giulia' });
    // areas the form would normalize are not rewritten unless the user edits them
    const odd = { ...base, mainWork: ['**Acme**: billing', '  spaced  '] };
    expect(changedFields(odd, { ...profileForm(odd), name: 'Giulia' })).toEqual({ name: 'Giulia' });
  });
  it('after a concurrent edit keeps the user edits and takes the new values elsewhere', () => {
    const after = { ...base, replyStyle: 'new style', role: 'lead' };
    const form = rebaseForm({ ...profileForm(base), name: 'Giulia' }, base, after);
    expect(form).toEqual({ ...profileForm(after), name: 'Giulia' });
    expect(changedFields(after, form)).toEqual({ name: 'Giulia' });
  });
  it('maps main errors', () => {
    expect(profileError(new Error("Error invoking remote method 'profile:save': Error: PROFILE_CHANGED"))).toBe('changed');
    expect(profileError(new Error('PROFILE_FIELDS'))).toBe('invalid');
    expect(profileError(new Error('PROFILE_NO_BRAIN'))).toBe('noBrain');
    expect(profileError('boom')).toBe('error');
  });
});
