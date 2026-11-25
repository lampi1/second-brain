// The credit book's helpers (main/agents/credits.ts, ADR 0218 / 0353): pools per engine and per OpenCode provider,
// which error texts are a limit, and OpenCode's log for the panel. The book's facts and the one rule are tested in
// test/unit/agents/credit-truth.test.ts.
import { describe, expect, it } from 'vitest';
import { limitSignal, opencodeState, poolOf, readOpencodeLog } from '../../../src/main/agents/credits';


describe('pools', () => {
  it('one per engine; OpenCode split by provider prefix', () => {
    expect(poolOf('claude', 'claude-opus-5-5')).toBe('claude');
    expect(poolOf('cursor', 'gpt-5')).toBe('cursor');
    expect(poolOf('opencode', 'openai/gpt-5.1')).toBe('opencode:openai');
    expect(poolOf('opencode', 'opencode/grok-code')).toBe('opencode:zen');
    expect(poolOf('opencode', 'anthropic/claude')).toBe('opencode:anthropic');
    expect(poolOf('opencode', null)).toBe('opencode:default');
  });
  it('a limit text is a signal; a network error is not', () => {
    expect(limitSignal('You have hit your usage limit')).toBe(true);
    expect(limitSignal('insufficient_quota')).toBe(true);
    expect(limitSignal('Free usage limit reached. Add credits to continue')).toBe(true);
    expect(limitSignal('Your credit balance is too low to access the Anthropic API')).toBe(true);
    expect(limitSignal('You exceeded your current quota, please check your plan and billing details')).toBe(true);
  });
  it('generic words and a short throttle are no signal (review 2026-11-01)', () => {
    expect(limitSignal('Ho aggiornato la logica di billing e la quota fatture; poi il test è fallito')).toBe(false);
    expect(limitSignal('rate limit per minute exceeded, retry in 20s')).toBe(false);
    expect(limitSignal('Error 429 Too Many Requests')).toBe(false);
    expect(limitSignal('402 payment of the invoice failed in the test')).toBe(false);
    expect(limitSignal('ECONNRESET while rate limit check')).toBe(false);
    expect(limitSignal('the model refused')).toBe(false);
    expect(limitSignal(null)).toBe(false);
  });
});

describe('OpenCode log', () => {
  const line = (iso: string, rest: string) => `timestamp=${iso} ${rest}`;
  it('reads the last limit error and stream per provider', () => {
    const text = [
      line('2026-11-01T10:00:00.000Z', 'level=INFO service=llm providerID=openai message=stream'),
      line('2026-11-01T10:00:30.000Z', 'level=ERROR service=llm providerID=openai message=stream error error.error=You have hit your usage limit'),
      line('2026-11-01T09:00:00.000Z', 'level=INFO service=llm providerID=opencode message=stream'),
    ].join('\n');
    const facts = readOpencodeLog(text);
    const now = Date.parse('2026-11-01T11:00:00.000Z');
    expect(opencodeState('opencode:openai', facts.get('openai'), now)).toMatchObject({ status: 'exhausted', at: Date.parse('2026-11-01T10:00:30.000Z') });
    expect(opencodeState('opencode:zen', facts.get('opencode'), now)).toMatchObject({ status: 'ok', source: 'log' });
    expect(opencodeState('opencode:x', undefined, now)).toBeNull();
  });
  it('a stream well after the limit error means it works again', () => {
    const facts = { limitAt: 1_000_000, streamAt: 1_000_000 + 10 * 60e3 };
    expect(opencodeState('opencode:openai', facts, 1_000_000 + 20 * 60e3)?.status).toBe('ok');
  });
});

