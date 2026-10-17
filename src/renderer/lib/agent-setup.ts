// Offline interview recommendations: use existing catalog IDs, editable proposals, no permissions or remote calls.
// Also the interview ⇄ me.md mapping: what the owner already told the brain is prefilled, never asked again, and on
// confirm only the answers that add something are written (a custom reply style or a locked field is never touched).
import type { AgentProfile, SetupDraft, SetupProfile } from '@shared/agents';
import type { OwnerProfile, ProfileFields } from '@shared/profile';
import { PROFILE_FORBIDDEN, PROFILE_LIMITS, PROFILE_PLACEHOLDERS, REPLY_PRESETS } from '@shared/profile';
import { workAreas } from './profile';

export const INTERVIEW_STEPS = ['Chi sei', 'Il tuo lavoro', 'Come lavoriamo', 'I tuoi agenti', 'Riepilogo'] as const;
const placeholder = (key: keyof typeof PROFILE_PLACEHOLDERS, value: string) => !value || (PROFILE_PLACEHOLDERS[key] as readonly string[]).includes(value);
/** the owner's name is already known: the interview shows it instead of asking */
export const knownName = (current: OwnerProfile | null) => !!current && !placeholder('name', current.name);
/** a reply style the owner wrote themselves (or brain-editor did): the interview leaves it alone */
export const customReplyStyle = (current: OwnerProfile) => !!current.replyStyle && current.replyStyle !== current.replyStyleDefault && !(Object.values(REPLY_PRESETS) as string[]).includes(current.replyStyle);
export const replyStyleOf = (current: OwnerProfile): SetupDraft['style'] => current.replyStyle === REPLY_PRESETS.concise ? 'concise' : current.replyStyle === REPLY_PRESETS.detailed ? 'detailed' : 'balanced';
export type InterviewAnswers = Required<SetupProfile>;
/** what the interview shows: the answers given in this run, else what me.md says now (placeholders count as empty);
 * a known name or a read-only field always shows me.md, since confirm would not write the answer */
export function profileDraft(draft: SetupDraft, current: OwnerProfile | null): InterviewAnswers {
  const all = draft.profile ?? {}, locked = wizardLocked(current);
  const p = { ...all, name: knownName(current) || locked.has('name') ? undefined : all.name, role: locked.has('role') ? undefined : all.role, language: locked.has('language') ? undefined : all.language, areas: locked.has('mainWork') ? undefined : all.areas };
  const base: InterviewAnswers = current
    ? { name: knownName(current) ? current.name : '', role: placeholder('role', current.role) ? '' : current.role, language: current.language, areas: current.mainWork.join('\n'), style: replyStyleOf(current) }
    : { name: '', role: '', language: '', areas: '', style: 'balanced' };
  return { name: p.name ?? base.name, role: p.role ?? base.role, language: p.language ?? base.language, areas: p.areas ?? base.areas, style: p.style ?? base.style };
}
const FIELD_LIMITS = { name: PROFILE_LIMITS.name, role: PROFILE_LIMITS.role, language: PROFILE_LIMITS.language, areas: 2000 } as const;
/** records an answer the owner gave, within the limits a saved draft accepts */
export function answerPatch(draft: SetupDraft, patch: Partial<SetupProfile>): SetupProfile {
  const out = { ...draft.profile, ...patch };
  for (const key of Object.keys(FIELD_LIMITS) as (keyof typeof FIELD_LIMITS)[]) if (out[key] !== undefined) out[key] = out[key]!.slice(0, FIELD_LIMITS[key]);
  return out;
}
/** fields the interview shows read-only: locked by main, or longer in me.md than the wizard could keep without cutting */
export function wizardLocked(current: OwnerProfile | null): Set<string> {
  const out = new Set<string>(current?.locked ?? []);
  if (current) for (const key of ['name', 'role', 'language'] as const) if (current[key].length > PROFILE_LIMITS[key]) out.add(key);
  if (current && current.mainWork.join('\n').length > FIELD_LIMITS.areas) out.add('mainWork');
  return out;
}
/** why an answer the wizard can still write can't go into me.md as typed (main refuses it the same way): one message
 * per field; answers to a known name or a read-only field are ignored, as on confirm */
export function answerProblems(draft: SetupDraft, current: OwnerProfile | null): Partial<Record<'name' | 'role' | 'language' | 'areas', string>> {
  const all = draft.profile ?? {}, locked = wizardLocked(current), out: Partial<Record<'name' | 'role' | 'language' | 'areas', string>> = {};
  const p = { ...all, name: knownName(current) || locked.has('name') ? undefined : all.name, role: locked.has('role') ? undefined : all.role, language: locked.has('language') ? undefined : all.language, areas: locked.has('mainWork') ? undefined : all.areas };
  if (p.name && PROFILE_FORBIDDEN.name.test(p.name)) out.name = 'Il nome non può contenere # * ` [ ] < > | _ \\';
  if (p.role && PROFILE_FORBIDDEN.role.test(p.role)) out.role = 'Il ruolo non può contenere «. Language:».';
  if (p.language && PROFILE_FORBIDDEN.language.test(p.language)) out.language = 'Scrivi solo la lingua, per esempio: italiano.';
  const areas = workAreas(p.areas ?? '');
  if (areas.length > PROFILE_LIMITS.areas) out.areas = `Al massimo ${PROFILE_LIMITS.areas} aree: raggruppa le più vicine.`;
  else if (areas.some(a => a.length > PROFILE_LIMITS.area)) out.areas = `Ogni area al massimo ${PROFILE_LIMITS.area} caratteri.`;
  return out;
}
/** the me.md fields to save on confirm: only answers given in this run, changed, unlocked and valid */
export function wizardProfile(draft: SetupDraft, current: OwnerProfile): Partial<ProfileFields> {
  const out: Partial<ProfileFields> = {}, locked = wizardLocked(current), p = draft.profile ?? {}, problems = answerProblems(draft, current);
  const put = (key: 'name' | 'role' | 'language', value: string | undefined) => { const v = value?.trim(); if (v && v !== current[key] && !locked.has(key) && !problems[key]) out[key] = v; };
  if (!knownName(current)) put('name', p.name);
  put('role', p.role); put('language', p.language);
  const areas = workAreas(p.areas ?? '');
  if (areas.length && !problems.areas && areas.join('\n') !== current.mainWork.join('\n') && !locked.has('mainWork')) out.mainWork = areas;
  const reply = !p.style ? '' : p.style === 'balanced' ? current.replyStyleDefault : REPLY_PRESETS[p.style];
  if (reply && reply !== current.replyStyle && !customReplyStyle(current) && !locked.has('replyStyle')) out.replyStyle = reply;
  return out;
}
export const emptySetup = (): SetupDraft => ({ step: 0, work: '', goals: '', tools: '', style: 'balanced', agentIds: [] });
export function recommendedAgents(draft: SetupDraft, catalog: readonly AgentProfile[]): string[] {
  const ids = new Set(['default-general', 'default-planning']);
  if (draft.work === 'independent' || /scriv|document|test[oi]|offert|client/i.test(draft.goals)) ids.add('default-writing');
  if (/anal|dat[oi]|confront|report|numer/i.test(draft.goals)) ids.add('default-analysis');
  if (/ricerc|font|informaz|stud/i.test(draft.goals)) ids.add('default-research');
  if (/svilupp|software|codice|programmaz/i.test(draft.goals)) ids.add('default-development');
  return catalog.filter(p => ids.has(p.id)).map(p => p.id);
}
export function validSetupStep(step: number): number { return Math.max(0, Math.min(INTERVIEW_STEPS.length - 1, Number.isInteger(step) ? step : 0)); }
