// Offline recommendation/migration cases use catalog fixtures, without implicit connections or provider calls; the
// interview ⇄ me.md mapping and the local validation of the interview answers.
import { expect, it } from 'vitest';
import type { AgentProfile } from '@shared/agents';
import type { OwnerProfile } from '@shared/profile';
import { REPLY_PRESETS } from '@shared/profile';
import { answerPatch, answerProblems, customReplyStyle, emptySetup, knownName, profileDraft, recommendedAgents, replyStyleOf, validSetupStep, wizardLocked, wizardProfile } from '../../src/renderer/lib/agent-setup';
import { checkSetup } from '../../src/main/agents/setup';
const profile=(id:string):AgentProfile=>({id,name:id,purpose:'Useful work',instructions:'',engine:'claude',model:null,avatar:{kind:'symbol',value:'briefcase'},createdAt:1,updatedAt:1,role:'',category:'other',tools:null,permissionCeiling:null,origin:{kind:'user'},version:1,activeVersion:1,lastEditedBy:'user',userLocked:true,status:'active'});
const catalog=['general','planning','writing','analysis','research','development'].map(role=>profile(`default-${role}`));
it('keeps engine preferences resumable without accepting arbitrary engines or trust flags', () => {
  expect(checkSetup({ ...emptySetup(), engines: ['codex', 'cursor', 'codex'], trusted: true })).toMatchObject({ engines: ['codex', 'cursor'] });
  expect(checkSetup({ ...emptySetup(), engines: [] }).engines).toEqual([]);
  expect(checkSetup({ ...emptySetup(), engines: ['claude'], trusted: true })).not.toHaveProperty('trusted');
  expect(() => checkSetup({ ...emptySetup(), engines: ['unknown'] })).toThrow();
  expect(() => checkSetup({ ...emptySetup(), engines: [['codex']] })).toThrow();
});
it('starts an offline interview with no assumed work context or connections',()=>{
  expect(emptySetup()).toEqual({step:0,work:'',goals:'',tools:'',style:'balanced',agentIds:[]});
});
it('recommends everyday roles and adds development only for a stated goal',()=>{
  const selected=recommendedAgents({...emptySetup(),work:'independent',goals:'Preparare offerte e confrontare dati'},catalog);
  expect(selected).toEqual(['default-general','default-planning','default-writing','default-analysis']);
  expect(selected).not.toContain('default-development');
  expect(recommendedAgents({...emptySetup(),goals:'sviluppo software'},catalog)).toContain('default-development');
});
it('never invents profiles absent from the real catalog',()=>{
  expect(recommendedAgents({...emptySetup(),goals:'ricerca e analisi dati'},[profile('custom-research')])).toEqual([]);
});
it('restores only a valid interview step from old or malformed state',()=>{
  expect([NaN,-1,90,1.5,3].map(validSetupStep)).toEqual([0,0,4,0,3]);
});

// The interview ⇄ me.md mapping (lib/agent-setup.ts): prefill, nothing asked twice, only real answers written.
const owner = (patch: Partial<OwnerProfile> = {}): OwnerProfile => ({ name: 'Tu', role: 'Da conoscere insieme', language: 'italiano', mainWork: [], replyStyle: 'template style', replyStyleDefault: 'template style', rules: [], locked: [], revision: 'r', updatedAt: 0, growth: { journalDays: 0, lastJournal: null }, path: 'me.md', ...patch });
it('shows me.md where the owner gave no answer in this run, placeholders as empty', () => {
  expect(profileDraft(emptySetup(), owner())).toEqual({ name: '', role: '', language: 'italiano', areas: '', style: 'balanced' });
  expect(profileDraft(emptySetup(), owner({ name: 'Giulia', role: 'pm', mainWork: ['a', 'b'], replyStyle: REPLY_PRESETS.concise }))).toEqual({ name: 'Giulia', role: 'pm', language: 'italiano', areas: 'a\nb', style: 'concise' });
  // an answer given wins; a field not answered follows me.md as it is now (an edit in Settings meanwhile shows up)
  expect(profileDraft({ ...emptySetup(), profile: { role: 'qa' } }, owner({ role: 'lead', mainWork: ['new'] }))).toMatchObject({ role: 'qa', areas: 'new' });
  expect(knownName(owner())).toBe(false); expect(knownName(owner({ name: 'Giulia' }))).toBe(true);
  expect(answerPatch({ ...emptySetup(), profile: { role: 'pm' } }, { areas: 'x'.repeat(3000) })).toEqual({ role: 'pm', areas: 'x'.repeat(2000) });
});
it('writes only the answers given that add something, never a known name, a custom reply style or a locked field', () => {
  const draft = { ...emptySetup(), profile: { name: ' Giulia ', role: 'pm', language: 'italiano', areas: '- Checkout\nApp', style: 'concise' as const } };
  expect(wizardProfile(draft, owner())).toEqual({ name: 'Giulia', role: 'pm', mainWork: ['Checkout', 'App'], replyStyle: REPLY_PRESETS.concise });
  expect(wizardProfile(draft, owner({ name: 'Anna' }))).not.toHaveProperty('name');
  expect(wizardProfile(draft, owner({ replyStyle: 'my own words' }))).not.toHaveProperty('replyStyle');
  expect(customReplyStyle(owner({ replyStyle: 'my own words' }))).toBe(true);
  expect(wizardProfile(draft, owner({ locked: ['mainWork', 'name'] }))).toEqual({ role: 'pm', replyStyle: REPLY_PRESETS.concise });
  // balanced picked after a preset puts the template text back
  expect(wizardProfile({ ...emptySetup(), profile: { style: 'balanced' } }, owner({ replyStyle: REPLY_PRESETS.detailed }))).toEqual({ replyStyle: 'template style' });
  // nothing answered in this run writes nothing, whatever the legacy draft.style says or me.md holds now
  expect(wizardProfile({ ...emptySetup(), style: 'concise' }, owner({ role: 'lead', mainWork: ['a'] }))).toEqual({});
  expect(replyStyleOf(owner({ replyStyle: REPLY_PRESETS.detailed }))).toBe('detailed');
});
it('flags the answers main would refuse and leaves them out of the save', () => {
  const draft = { ...emptySetup(), profile: { name: 'gi_ulia', role: 'pm. Language: x', language: 'it in chat', areas: Array.from({ length: 13 }, (_, i) => 'a' + i).join('\n') } };
  expect(Object.keys(answerProblems(draft, owner())).sort()).toEqual(['areas', 'language', 'name', 'role']);
  expect(wizardProfile(draft, owner())).toEqual({});
  expect(answerProblems({ ...emptySetup(), profile: { areas: 'x'.repeat(161) } }, owner())).toHaveProperty('areas');
  expect(answerProblems({ ...emptySetup(), profile: { name: 'Giulia', areas: 'a\nb' } }, owner())).toEqual({});
  // an answer the wizard can no longer write (name now known, field locked) never blocks it
  expect(answerProblems(draft, owner({ name: 'Mario', locked: ['role', 'language', 'mainWork'] }))).toEqual({});
});
it('shows read-only the me.md fields it could only keep by cutting them', () => {
  expect([...wizardLocked(owner({ role: 'r'.repeat(241), locked: ['name'] }))].sort()).toEqual(['name', 'role']);
  expect(wizardLocked(owner()).size).toBe(0);
  expect(profileDraft({ ...emptySetup(), profile: { role: 'pm', language: 'en' } }, owner({ role: 'lead', locked: ['role'] }))).toMatchObject({ role: 'lead', language: 'en' });
  expect(wizardProfile({ ...emptySetup(), profile: { role: 'short' } }, owner({ role: 'r'.repeat(241) }))).toEqual({});
});
it('keeps the interview answers in the local setup and refuses malformed ones', () => {
  const profile = { name: 'Giulia', role: 'pm', language: 'italiano', areas: 'a\nb', style: 'concise' as const };
  expect(checkSetup({ ...emptySetup(), profile }).profile).toEqual(profile);
  expect(checkSetup({ ...emptySetup(), profile: { role: 'pm' } }).profile).toEqual({ role: 'pm' });
  expect(checkSetup(emptySetup())).not.toHaveProperty('profile');
  for (const bad of [null, [], { name: 1 }, { role: 'x'.repeat(241) }, { style: 'loud' }])
    expect(() => checkSetup({ ...emptySetup(), profile: bad }), JSON.stringify(bad)).toThrow();
});
