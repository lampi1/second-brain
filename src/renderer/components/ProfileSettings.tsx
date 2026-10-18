// Settings → Il mio profilo: the owner's me.md as the agents read it ("Who" and "How to work with"), editable in its
// managed fields only (name, role, chat language, work areas, reply style) through 'profile:save', which refuses to
// overwrite a concurrent edit. Shows how the profile grows (rules added by brain-editor, journal days). Used by
// SettingsPage.tsx; the logic lives in lib/profile.ts.
import { useEffect, useRef, useState } from 'react';
import type { OwnerProfile, ProfileFields, ProfileResult } from '@shared/profile';
import { PROFILE_LIMITS } from '@shared/profile';
import { changedFields, profileError, profileForm, rebaseForm, tooManyAreas, type ProfileForm } from '../lib/profile';
import { useApp } from '../store/store';
import { toast } from '../store/ui';
import { locale, t } from '../i18n';
import '../styles/profile.css';

const plain = (text: string) => text.replace(/\*\*|`/g, '');
const day = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' });

export function ProfileSettings() {
  const root = useApp(s => s.settings?.brainRoot ?? null);
  const [result, setResult] = useState<ProfileResult | null>(null), [form, setForm] = useState<ProfileForm | null>(null);
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState<string | null>(null);
  const live = useRef(true);
  const load = async (): Promise<OwnerProfile | null> => {
    try { const value = await window.sb.invoke('profile:get', undefined); if (live.current) setResult(value); return value.ok ? value.profile : null; }
    catch { if (live.current) setResult({ ok: false, reason: 'unreadable' }); return null; }
  };
  useEffect(() => { live.current = true; setForm(null); void load(); return () => { live.current = false; }; }, [root]);
  if (!result) return <p className="st-desc" role="status">…</p>;
  if (!result.ok) return <p className="st-desc" role="status" data-testid="profile-unavailable">{t(result.reason === 'no-brain' ? 'profile.noBrain' : result.reason === 'missing' ? 'profile.missing' : 'profile.unreadable')}</p>;
  const profile = result.profile, locked = new Set(profile.locked);
  const save = async () => {
    if (!form || busy) return;
    if (tooManyAreas(form)) { setProblem(t('profile.tooMany', { n: PROFILE_LIMITS.areas })); return; }
    const fields = changedFields(profile, form);
    if (!Object.keys(fields).length) { setForm(null); return; }
    setBusy(true); setProblem(null);
    try {
      const saved = await window.sb.invoke('profile:save', { revision: profile.revision, fields });
      if (!live.current) return;
      setResult({ ok: true, profile: saved }); setForm(null); toast(t('profile.saved'), 'ok');
    } catch (error) {
      const kind = profileError(error);
      // keep the user's edits, take the new values for the fields they did not touch, carry the new revision
      if (kind === 'changed') { const fresh = await load(); if (fresh && live.current) setForm(rebaseForm(form, profile, fresh)); }
      if (live.current) setProblem(t(kind === 'changed' ? 'profile.changed' : kind === 'invalid' ? 'profile.invalid' : kind === 'noBrain' ? 'profile.noBrain' : 'profile.error'));
    } finally { if (live.current) setBusy(false); }
  };
  const field = (key: Exclude<keyof ProfileFields, 'mainWork' | 'replyStyle'>, max: number) => <label className="field"><span>{t(`profile.${key}`)}</span>
    <input value={form![key]} maxLength={max} disabled={locked.has(key)} title={locked.has(key) ? t('profile.locked') : undefined} onChange={e => setForm({ ...form!, [key]: e.target.value })} data-testid={`profile-${key}`}/></label>;
  const value = (text: string) => text ? <span className="st-desc">{plain(text)}</span> : <span className="st-desc">{t('profile.empty')}</span>;
  return <div className="st-profile" data-testid="profile-settings">
    <p className="st-desc">{t('profile.lead')}</p>
    {form ? <form className="st-profile-form" onSubmit={e => { e.preventDefault(); void save(); }}><fieldset disabled={busy}>
      {field('name', PROFILE_LIMITS.name)}{field('role', PROFILE_LIMITS.role)}{field('language', PROFILE_LIMITS.language)}
      <label className="field"><span>{t('profile.mainWork')}</span><textarea rows={4} value={form.mainWork} disabled={locked.has('mainWork')} onChange={e => setForm({ ...form, mainWork: e.target.value })} data-testid="profile-mainWork"/><small>{t('profile.mainWorkHint')}</small></label>
      <label className="field"><span>{t('profile.replyStyle')}</span><textarea rows={3} maxLength={PROFILE_LIMITS.replyStyle} value={form.replyStyle} disabled={locked.has('replyStyle')} onChange={e => setForm({ ...form, replyStyle: e.target.value })} data-testid="profile-replyStyle"/></label>
      {profile.locked.length > 0 && <p className="st-desc">{t('profile.locked')}</p>}
      {problem && <p role="alert">{problem}</p>}
      <div className="st-inline"><button type="submit" className="btn btn-primary" data-testid="profile-save">{t('profile.save')}</button><button type="button" className="btn btn-ghost" onClick={() => { setForm(null); setProblem(null); }}>{t('common.cancel')}</button></div>
    </fieldset></form> : <>
      <dl className="st-profile-view">
        <dt>{t('profile.name')}</dt><dd>{value(profile.name)}</dd>
        <dt>{t('profile.role')}</dt><dd>{value(profile.role)}</dd>
        <dt>{t('profile.language')}</dt><dd>{value(profile.language)}</dd>
        <dt>{t('profile.mainWork')}</dt><dd>{profile.mainWork.length ? <ul>{profile.mainWork.map((a, i) => <li key={i}>{plain(a)}</li>)}</ul> : value('')}</dd>
        <dt>{t('profile.replyStyle')}</dt><dd>{value(profile.replyStyle)}</dd>
      </dl>
      <div className="st-inline"><button type="button" className="btn btn-ghost" onClick={() => setForm(profileForm(profile))} data-testid="profile-edit">{t('profile.edit')}</button><button type="button" className="btn btn-ghost" onClick={() => void import('../actions').then(m => m.openFileViewer(profile.path))}>{t('profile.open')}</button></div>
    </>}
    <details className="st-profile-rules"><summary>{t('profile.rules', { n: profile.rules.length })}</summary><ul>{profile.rules.map((r, i) => <li key={i}><b>{plain(r.title)}</b>: {plain(r.text)}</li>)}</ul></details>
    <div className="st-profile-growth" data-testid="profile-growth">
      <p className="st-desc">{t('profile.growth')}</p>
      <p className="st-desc">{t('profile.updated', { date: new Date(profile.updatedAt).toLocaleString(locale(), { dateStyle: 'long', timeStyle: 'short' }) })}</p>
      <p className="st-desc">{profile.growth.lastJournal ? t('profile.journal', { n: profile.growth.journalDays, date: day(profile.growth.lastJournal) }) : t('profile.journalNone')}</p>
    </div>
  </div>;
}
