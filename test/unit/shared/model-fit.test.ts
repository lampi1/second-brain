// One rule for a model on an engine (shared/model-fit.ts, ADR 0356, problem 3 of 2026-11-25).
import { describe, expect, it } from 'vitest';
import { modelRefusal } from '../../../src/shared/model-fit';

describe('modelRefusal', () => {
  it('a model on the engine\'s live list runs there, whatever the registry says (claude-opus-5-5 on Cursor)', () => {
    expect(modelRefusal('cursor', 'claude-opus-5-5', ['gpt-5.5', 'claude-opus-5-5'], 'claude')).toBeNull();
    expect(modelRefusal('cursor', 'opus', ['claude-opus-5-5'], 'claude', ['claude-opus-5-5', 'opus'])).toBeNull();
    expect(modelRefusal('claude', 'claude-opus-5-5[1m]', ['claude-opus-5-5'], 'claude')).toBeNull();
  });
  it('off the list: the registry\'s other engine, or a Claude name on another engine, is refused', () => {
    expect(modelRefusal('cursor', 'claude-opus-5-5', ['gpt-5.5'], 'claude')).toMatch(/gira solo su claude, non su cursor/);
    expect(modelRefusal('cursor', 'claude-opus-5-5', null, 'claude')).toMatch(/gira solo su claude/);
    expect(modelRefusal('codex', 'opus-x', [], null)).toMatch(/Claude gira solo/);
  });
  it('an id nobody knows is taken (models.json is never an allow-list): the CLI judges it', () => {
    expect(modelRefusal('claude', 'claude-mistero', ['claude-opus-5-5'], null)).toBeNull();
    expect(modelRefusal('claude', 'sonnet', ['claude-sonnet-5-5'], null)).toBeNull();
    expect(modelRefusal('cursor', null, ['x'], 'claude')).toBeNull();
  });
});

describe('Claude models on Antigravity and Cursor (ADR 0357)', () => {
  const agy = ['gemini-3.8-flash', 'claude-opus-5-5', 'claude-sonnet-5-5', 'gpt-oss-120b'];
  it('accepted on antigravity and cursor when their list offers them, whatever the registry row says', () => {
    expect(modelRefusal('antigravity', 'claude-sonnet-5-5', agy, 'claude')).toBeNull();
    expect(modelRefusal('cursor', 'claude-sonnet-5-5', ['claude-sonnet-5-5'], 'claude')).toBeNull();
  });
  it('refused when the engine does not offer it; unchanged on claude', () => {
    expect(modelRefusal('antigravity', 'claude-haiku-5-5', agy, 'claude')).toMatch(/gira solo su claude/);
    expect(modelRefusal('claude', 'claude-sonnet-5-5', null, 'claude')).toBeNull();
  });
});
