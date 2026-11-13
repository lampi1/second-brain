// The first-run setup's flow (src/renderer/lib/setup-wizard.ts): one modal from start to finish, three moments (ADR
// 0279): welcome (language and name), your AI, the first request. An engine already signed in is put in use by itself;
// "Accedi" opens the official sign-in and leaves the setup waiting in place (it never closes the modal or moves on),
// "Verifica" is a token-free status check, a saved run resumes where it was (never past «your AI») with its answers,
// and only the three explicit exits end it.
import { describe, expect, it, vi } from 'vitest';
import type { SetupDraft, SetupState } from '@shared/agents';
import type { CliStatus } from '@shared/contract';
import { ENGINE_NAMES, LANG_NATIVE, LANG_PROFILE, LAST_RESUMABLE, SETUP_ENGINES, SETUP_STEPS, autoEngines, canAdvance, canSignIn, clampStep, exitStatus, linkFromStatus, openSignIn, openingDraft, plainError, recommendedEngine, stepId, stepProblems, teamStates, usable, verifySignIn, withEngine, withPrimary } from '../../src/renderer/lib/setup-wizard';
import type { EngineLinkPort } from '../../src/renderer/lib/setup-wizard';
import { closeModal, openModal, ui } from '../../src/renderer/store/ui';
import type { ChatSummary } from '@shared/contract';

const blank: SetupDraft = { step: 0, work: '', goals: '', tools: '', style: 'balanced' };
const state = (status: SetupState['status'], preferences: Partial<SetupDraft> = {}): SetupState => ({ version: 1, status, preferences: { ...blank, ...preferences }, updatedAt: 1 });
const status = (patch: Partial<CliStatus> = {}): CliStatus => ({ found: true, path: '/bin/x', version: '1', loggedIn: false, ...patch });

describe('moments', () => {
  it('runs welcome → AI → first request: tools, folders, role and goals are not asked', () => {
    expect(SETUP_STEPS).toEqual(['welcome', 'ai', 'first']);
    expect([NaN, -1, 90, 1.5, 1].map(clampStep)).toEqual([0, 0, 2, 0, 1]);
    expect(stepId(0)).toBe('welcome');
    expect(stepId(2)).toBe('first');
  });
  it('holds only the first moment, and only for a name me.md would refuse', () => {
    const problems = { name: 'bad name', role: 'bad role', language: 'bad language', areas: 'too many' };
    expect(stepProblems(0, problems)).toEqual(['bad name']);
    expect(stepProblems(1, problems)).toEqual([]);
    expect(canAdvance(0, problems)).toBe(false);
    expect(canAdvance(0, { role: 'x' })).toBe(true);
    expect(canAdvance(1, problems)).toBe(true);
  });
  it('writes the picked language into me.md in its own words, one per UI language', () => {
    expect(LANG_PROFILE).toEqual({ it: 'italiano', en: 'English', de: 'Deutsch' });
    expect(Object.values(LANG_NATIVE).map(l => l.name)).toEqual(['Italiano', 'English', 'Deutsch']);
  });
  it('looks for four engines and names each one', () => {
    expect(SETUP_ENGINES).toEqual(['claude', 'codex', 'cursor', 'opencode']);
    expect(SETUP_ENGINES.map(e => ENGINE_NAMES[e])).toEqual(['Claude Code', 'Codex', 'Cursor', 'OpenCode']);
  });
  it('proposes one AI: signed in first, then installed, then Claude Code', () => {
    expect(recommendedEngine({})).toBe('claude');
    expect(recommendedEngine({ claude: { phase: 'signedOut' }, codex: { phase: 'connected' }, cursor: { phase: 'missing' } })).toBe('codex');
    expect(recommendedEngine({ claude: { phase: 'missing' }, codex: { phase: 'missing' }, cursor: { phase: 'signedOut' } })).toBe('cursor');
    expect(recommendedEngine({ claude: { phase: 'signedOut' }, codex: { phase: 'unknown' }, cursor: { phase: 'signedOut' } })).toBe('claude');
    expect(recommendedEngine({ claude: { phase: 'missing' }, codex: { phase: 'missing' }, cursor: { phase: 'missing' } })).toBe('claude');
  });
  it('puts the engines already signed in to use by itself, the proposed one first, and never over a choice', () => {
    expect(autoEngines({ claude: { phase: 'signedOut' }, codex: { phase: 'connected' }, cursor: { phase: 'connected' }, opencode: { phase: 'missing' } }, [])).toEqual(['codex', 'cursor']);
    expect(autoEngines({ claude: { phase: 'connected' }, cursor: { phase: 'connected' } }, [])).toEqual(['claude', 'cursor']);
    expect(autoEngines({ claude: { phase: 'signedOut' }, codex: { phase: 'unknown' } }, [])).toBeNull();
    expect(autoEngines({ claude: { phase: 'connected' } }, ['cursor'])).toBeNull();
  });
  it('starts the first request only on an engine that is signed in or cannot be checked', () => {
    expect(usable({ phase: 'connected' })).toBe(true);
    expect(usable({ phase: 'unknown' })).toBe(true);
    expect((['checking', 'missing', 'signedOut', 'opening', 'waiting', 'verifying', 'error'] as const).some(phase => usable({ phase }))).toBe(false);
    expect(usable(undefined)).toBe(false);
  });
});

describe('exits and resume', () => {
  it('ends only through later (draft), skip or finish, and each one saves', () => {
    expect(exitStatus('later')).toBe('draft');
    expect(exitStatus('skip')).toBe('skipped');
    expect(exitStatus('finish')).toBe('completed');
  });
  it('resumes a run in progress where it was with its answers, never past «your AI»', () => {
    const draft = openingDraft(state('draft', { step: 1, goals: 'meetings', engines: ['codex'], profile: { name: 'Giulia' }, guide: { stage: 'fallback' } }), { claude: true });
    expect(draft).toMatchObject({ step: 1, goals: 'meetings', engines: ['codex'], profile: { name: 'Giulia' }, guide: { stage: 'fallback' } });
    // a draft the six-step wizard saved on its fifth step, or a malformed one: the workspace is prepared again from «your AI»
    expect(LAST_RESUMABLE).toBe(1);
    expect(openingDraft(state('draft', { step: 4 }), {}).step).toBe(1);
    expect(openingDraft(state('draft', { step: 42 }), {}).step).toBe(1);
    expect(openingDraft(state('new'), { claude: true }).engines).toEqual([]);
  });
  it('starts a finished run over from the first moment, without re-writing old answers', () => {
    const draft = openingDraft(state('completed', { step: 2, profile: { role: 'pm' } }), { claude: true, cursor: true });
    expect(draft.step).toBe(0);
    expect(draft.profile).toBeUndefined();
    expect(openingDraft(state('skipped'), { claude: true, cursor: true }).engines).toEqual(['claude', 'cursor']);
  });
  it('keeps the engines in the order chosen: the first is the Orchestrator\'s, a new one joins last', () => {
    expect(withEngine(['cursor'], 'claude', true)).toEqual(['cursor', 'claude']);
    expect(withEngine(['claude', 'cursor'], 'claude', true)).toEqual(['cursor', 'claude']);
    expect(withEngine(['claude', 'cursor'], 'claude', false)).toEqual(['cursor']);
    expect(withEngine(undefined, 'codex', true)).toEqual(['codex']);
    expect(withPrimary(['claude', 'cursor'], 'cursor')).toEqual(['cursor', 'claude']);
    expect(withPrimary(undefined, 'codex')).toEqual(['codex']);
  });
});

describe('the team on the stage', () => {
  const chat = (patch: Partial<ChatSummary>): ChatSummary => ({ id: 'c', state: 'idle', isOrchestrator: false, pending: 0, ...patch } as ChatSummary);
  it('lights a role while a chat delegated to it works, and marks it done once one ended', () => {
    const all = teamStates([
      chat({ id: 'a', state: 'running', delegation: { role: 'scout', goal: 'g', doneWhen: [], at: 1 } }),
      chat({ id: 'b', state: 'idle', agent: { id: 'sentinel', name: 'Sentinel', purpose: '', engine: 'claude', model: null, revision: 1, source: 'catalog' }, lastResult: { at: 2, isError: false } }),
      chat({ id: 'o', state: 'running', isOrchestrator: true, agent: { id: 'orchestrator', name: 'Orchestrator', purpose: '', engine: 'claude', model: null, revision: 1, source: 'catalog' } }),
      chat({ id: 'p', state: 'running' }),
    ]);
    expect(all).toEqual({ strategist: 'idle', scout: 'working', artisan: 'idle', sentinel: 'done', herald: 'idle' });
  });
  it('shows every role ready on a clean install', () => {
    expect(new Set(Object.values(teamStates([])))).toEqual(new Set(['idle']));
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

  it('"Accedi" trusts the engine, opens its sign-in and waits: the setup modal stays open on the same step', async () => {
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
