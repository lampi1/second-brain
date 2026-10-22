// The first-run setup wizard's flow (src/renderer/lib/setup-wizard.ts): one modal from start to finish, six steps with
// the language first (issues #164, #165), one recommended AI. "Collega" opens
// the official sign-in and leaves the wizard waiting on the same step (it never closes the modal or moves on), "Verifica"
// is a token-free status check, a saved run resumes on its step with its answers, and only the three explicit exits end it.
import { describe, expect, it, vi } from 'vitest';
import type { SetupDraft, SetupState } from '@shared/agents';
import type { CliStatus } from '@shared/contract';
import { LANG_NATIVE, LANG_PROFILE, SETUP_STEPS, canAdvance, canJump, canSignIn, clampStep, exitStatus, linkFromStatus, openSignIn, openingDraft, plainError, recommendedEngine, stepId, stepProblems, verifySignIn, withEngine } from '../../src/renderer/lib/setup-wizard';
import type { EngineLinkPort } from '../../src/renderer/lib/setup-wizard';
import { closeModal, openModal, ui } from '../../src/renderer/store/ui';

const blank: SetupDraft = { step: 0, work: '', goals: '', tools: '', style: 'balanced' };
const state = (status: SetupState['status'], preferences: Partial<SetupDraft> = {}): SetupState => ({ version: 1, status, preferences: { ...blank, ...preferences }, updatedAt: 1 });
const status = (patch: Partial<CliStatus> = {}): CliStatus => ({ found: true, path: '/bin/x', version: '1', loggedIn: false, ...patch });

describe('steps', () => {
  it('runs language → AI → tools → you → folders → ready, in one list (goals, areas and team are not asked)', () => {
    expect(SETUP_STEPS).toEqual(['language', 'ai', 'tools', 'you', 'folders', 'done']);
    expect([NaN, -1, 90, 1.5, 3].map(clampStep)).toEqual([0, 0, 5, 0, 3]);
    expect(stepId(0)).toBe('language');
    expect(stepId(1)).toBe('ai');
  });
  it('holds a step only for its own answer problems, the summary for all of them; the language is never typed', () => {
    const problems = { name: 'bad name', role: 'bad role', language: 'bad language', areas: 'too many' };
    expect(stepProblems(SETUP_STEPS.indexOf('ai'), problems)).toEqual([]);
    expect(stepProblems(SETUP_STEPS.indexOf('language'), problems)).toEqual([]);
    expect(stepProblems(SETUP_STEPS.indexOf('you'), problems)).toEqual(['bad name', 'bad role']);
    expect(stepProblems(SETUP_STEPS.indexOf('done'), problems)).toEqual(['bad name', 'bad role']);
    expect(canAdvance(SETUP_STEPS.indexOf('you'), problems)).toBe(false);
    expect(canAdvance(SETUP_STEPS.indexOf('tools'), problems)).toBe(true);
  });
  it('lets the step indicator go back always and forward only past steps that may be left', () => {
    expect(canJump(5, 0, { name: 'x' })).toBe(true);
    expect(canJump(0, 5, {})).toBe(true);
    expect(canJump(0, 3, { name: 'x' })).toBe(true); // reaching "you" is fine, leaving it is not
    expect(canJump(0, 4, { name: 'x' })).toBe(false);
  });
  it('writes the picked language into me.md in its own words, one per UI language', () => {
    expect(LANG_PROFILE).toEqual({ it: 'italiano', en: 'English', de: 'Deutsch' });
    expect(Object.values(LANG_NATIVE).map(l => l.name)).toEqual(['Italiano', 'English', 'Deutsch']);
  });
  it('recommends one AI: signed in first, then installed, then Claude Code', () => {
    expect(recommendedEngine({})).toBe('claude');
    expect(recommendedEngine({ claude: { phase: 'signedOut' }, codex: { phase: 'connected' }, cursor: { phase: 'missing' } })).toBe('codex');
    expect(recommendedEngine({ claude: { phase: 'missing' }, codex: { phase: 'missing' }, cursor: { phase: 'signedOut' } })).toBe('cursor');
    expect(recommendedEngine({ claude: { phase: 'signedOut' }, codex: { phase: 'unknown' }, cursor: { phase: 'signedOut' } })).toBe('claude');
    expect(recommendedEngine({ claude: { phase: 'missing' }, codex: { phase: 'missing' }, cursor: { phase: 'missing' } })).toBe('claude');
  });
});

describe('exits and resume', () => {
  it('ends only through later (draft), skip or finish, and each one saves', () => {
    expect(exitStatus('later')).toBe('draft');
    expect(exitStatus('skip')).toBe('skipped');
    expect(exitStatus('finish')).toBe('completed');
  });
  it('resumes a run in progress on its step with its answers', () => {
    const draft = openingDraft(state('draft', { step: 1, goals: 'meetings', engines: ['codex'], profile: { name: 'Giulia' }, guide: { stage: 'fallback' } }), { claude: true });
    expect(draft).toMatchObject({ step: 1, goals: 'meetings', engines: ['codex'], profile: { name: 'Giulia' }, guide: { stage: 'fallback' } });
    expect(openingDraft(state('draft', { step: 42 }), {}).step).toBe(5);
    expect(openingDraft(state('new'), { claude: true }).engines).toEqual([]);
  });
  it('starts a finished run over from the first step, without re-writing old answers', () => {
    const draft = openingDraft(state('completed', { step: 5, profile: { role: 'pm' } }), { claude: true, cursor: true });
    expect(draft.step).toBe(0);
    expect(draft.profile).toBeUndefined();
    expect(openingDraft(state('skipped'), { claude: true, cursor: true }).engines).toEqual(['claude', 'cursor']);
  });
  it('turns engines on and off in a stable order, never anything else', () => {
    expect(withEngine(['cursor'], 'claude', true)).toEqual(['claude', 'cursor']);
    expect(withEngine(['claude', 'cursor'], 'claude', true)).toEqual(['claude', 'cursor']);
    expect(withEngine(['claude', 'cursor'], 'claude', false)).toEqual(['cursor']);
    expect(withEngine(undefined, 'codex', true)).toEqual(['codex']);
  });
});

describe('AI sign-in in place', () => {
  const port = (over: Partial<EngineLinkPort> = {}): EngineLinkPort => ({ status: vi.fn(async () => status()), trust: vi.fn(async () => {}), login: vi.fn(async () => {}), ...over });

  it('reads a status check: absent, signed out, signed in, unknown', () => {
    expect(linkFromStatus(null).phase).toBe('unknown');
    expect(linkFromStatus(status({ found: false })).phase).toBe('missing');
    expect(linkFromStatus(status({ loggedIn: false })).phase).toBe('signedOut');
    expect(linkFromStatus(status({ loggedIn: null })).phase).toBe('unknown');
    expect(linkFromStatus(status({ loggedIn: true, account: 'demo-account' }))).toEqual({ phase: 'connected', account: 'demo-account', checkedAt: expect.any(Number) });
    expect(canSignIn({ phase: 'signedOut' })).toBe(true);
    expect(canSignIn({ phase: 'missing' })).toBe(false);
    expect(canSignIn({ phase: 'connected' })).toBe(false);
  });

  it('"Collega" trusts the engine, opens its sign-in and waits: the setup modal stays open on the same step', async () => {
    openModal('setup');
    const p = port();
    const link = await openSignIn(p, 'claude');
    expect(link).toEqual({ phase: 'waiting', note: null });
    expect(p.trust).toHaveBeenCalledWith('claude');
    expect(p.login).toHaveBeenCalledWith('claude');
    expect(p.status).not.toHaveBeenCalled();
    expect(ui.get().modal).toBe('setup');
    closeModal();
  });

  it('a sign-in that cannot open says why and stays on the card (no close, retry possible)', async () => {
    openModal('setup');
    const link = await openSignIn(port({ login: async () => { throw new Error("Error invoking remote method 'cli:login': Error: Codex CLI not found"); } }), 'codex');
    expect(link).toEqual({ phase: 'error', error: 'Codex CLI not found' });
    expect(canSignIn(link)).toBe(true);
    expect(ui.get().modal).toBe('setup');
    closeModal();
  });

  it('"Verifica" connects a finished sign-in, keeps waiting on an unfinished one, never guesses', async () => {
    expect(await verifySignIn(port({ status: async () => status({ loggedIn: true, account: 'a' }) }), 'claude')).toEqual({ phase: 'connected', account: 'a', checkedAt: expect.any(Number) });
    expect(await verifySignIn(port({ status: async () => status({ loggedIn: false }) }), 'claude')).toEqual({ phase: 'waiting', note: 'notYet' });
    expect(await verifySignIn(port({ status: async () => status({ loggedIn: null }) }), 'claude')).toEqual({ phase: 'unknown', note: 'unverifiable' });
    expect(await verifySignIn(port({ status: async () => status({ found: false }) }), 'claude')).toEqual({ phase: 'missing' });
    expect(await verifySignIn(port({ status: async () => { throw new Error('timeout'); } }), 'claude')).toEqual({ phase: 'waiting', error: 'timeout' });
  });

  it('keeps the app\'s own sentence of an IPC error', () => {
    expect(plainError(new Error("Error invoking remote method 'cli:login': Error: Accendi prima Codex"))).toBe('Accendi prima Codex');
    expect(plainError('plain')).toBe('plain');
  });
});
