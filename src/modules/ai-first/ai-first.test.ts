// Offline policy/persistence regressions: no real provider, home/profile config, GUI or credentials.
import { describe, expect, it } from 'vitest';
import type { ChatItem } from '../../shared/contract';
import { checkSetup } from '../../main/agents/setup';
import { guidePrompt, installation, replyProof } from './model';
import type { SetupState } from '../../shared/agents';
import { guideChatId, guideHasCenter, visibleGuideItems } from './presentation';
const user: ChatItem = { kind: 'user', id: 'u', at: 1, text: 'Guide me' };
const reply: ChatItem = { kind: 'assistant', id: 'a', at: 2, text: 'How do you work?' };
const result: ChatItem = { kind: 'result', id: 'r', at: 3, isError: false, costUsd: 0, durationMs: 1, turns: 1 };
describe('AI connection evidence', () => {
  it('keeps the private brief in protocol history but starts the guide display at the assistant response', () => {
    for (const language of ['it', 'en'] as const) {
      const brief = { ...user, text: guidePrompt(language) };
      const later = { ...brief, id: 'later' };
      const history = [brief, reply, result, later];
      expect(visibleGuideItems(history, 'guide', 'guide')).toEqual([reply, result, later]);
      expect(history[0]).toBe(brief);
      expect(replyProof(history.slice(0, 3))).toBe('verified');
      expect(visibleGuideItems(history, 'other', 'guide')).toBe(history);
      expect(visibleGuideItems(history, 'guide', null)).toBe(history);
      for (const person of [{ ...brief, text: brief.text + ' copied' }, { ...brief, from: 'Colleague' }, { ...brief, images: 1 }]) {
        const visible = [person, reply];
        expect(visibleGuideItems(visible, 'guide', 'guide')).toBe(visible);
      }
    }
  });
  it('temporarily gives an active guide the empty Orchestrator space and restores normal layout afterwards', () => {
    const setup: SetupState = { version: 1, status: 'draft', updatedAt: 0, preferences: { step: 0, work: '', goals: '', tools: '', style: 'balanced', agentIds: [], guide: { stage: 'guided', engine: 'claude', chatId: 'guide' } } };
    expect(guideChatId(setup)).toBe('guide');
    expect(guideHasCenter(setup, false)).toBe(true);
    expect(guideHasCenter(setup, true)).toBe(false);
    expect(guideHasCenter({ ...setup, status: 'completed' }, false)).toBe(false);
    expect(guideHasCenter({ ...setup, status: 'skipped' }, false)).toBe(false);
    expect(guideHasCenter({ ...setup, preferences: { ...setup.preferences, guide: { stage: 'fallback' } } }, false)).toBe(false);
    expect(guideHasCenter(null, false)).toBe(false);
    // Completed setup still identifies the reserved brief when its chat is opened again.
    expect(guideChatId({ ...setup, status: 'completed' })).toBe('guide');
  });
  it('requires actual nonempty assistant text AND a successful completed turn', () => {
    expect(replyProof([])).toBe('pending'); expect(replyProof([user, reply])).toBe('pending');
    expect(replyProof([user, result])).toBe('failed'); expect(replyProof([user, { ...reply, text: '' }, result])).toBe('failed');
    expect(replyProof([user, reply, { ...result, isError: true }])).toBe('failed');
    expect(replyProof([user, reply, { ...result, interrupted: true }])).toBe('failed');
    expect(replyProof([user, reply, result])).toBe('verified');
    expect(replyProof([user, reply, result, { ...user, id: 'new' }])).toBe('pending');
  });
  it('does not infer connection from CLI installation or signed-in status', () => {
    expect(installation(undefined)).toBe('unknown');
    expect(installation({ found: true, path: null, version: null, loggedIn: true })).toBe('found');
    expect(replyProof([])).not.toBe('verified');
  });
  it('starts with one work question in the selected language, no tool or credential request', () => {
    expect(guidePrompt('it')).toContain('UNA sola cosa'); expect(guidePrompt('en')).toContain('ONE question');
    expect(guidePrompt('it')).toContain('Non chiedere password'); expect(guidePrompt('en')).toContain('Do not use tools');
  });
});
describe('resumable setup preferences', () => {
  const blank = { step: 0, work: '', goals: '', tools: '', style: 'balanced', agentIds: [] };
  it('preserves verified/connecting chat identity across persistence and permits offline fallback', () => {
    for (const stage of ['connecting', 'guided'] as const) expect(checkSetup({ ...blank, guide: { stage, engine: 'codex', chatId: 'fixture-chat' } }).guide).toEqual({ stage, engine: 'codex', chatId: 'fixture-chat' });
    expect(checkSetup({ ...blank, guide: { stage: 'fallback' } }).guide).toEqual({ stage: 'fallback' });
    expect(checkSetup({ ...blank, guide: { stage: 'choosing' } }).guide).toEqual({ stage: 'choosing' });
    expect(checkSetup({ ...blank, guide: undefined }).guide).toBeUndefined();
  });
  it('rejects unknown engines, invalid chat identity and malformed persisted guide', () => {
    expect(() => checkSetup({ ...blank, guide: { stage: 'guided', engine: 'untrusted', chatId: 'fixture' } })).toThrow();
    expect(() => checkSetup({ ...blank, guide: { stage: 'guided', engine: 'claude', chatId: '../outside' } })).toThrow();
    expect(() => checkSetup({ ...blank, guide: { stage: 'connected' } })).toThrow();
  });
});
