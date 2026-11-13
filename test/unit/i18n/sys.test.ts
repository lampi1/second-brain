// System ChatItem codes (ADR 0057): SYS_IT/SYS_EN (src/shared/sys.ts) must have the same keys, same "kind" (string vs.
// function) per key, and sysEn()/sysText() must render params correctly, including the encoded multi-value params
// (missFragment, the "later" list, the "n/m" retry attempt).
import { describe, expect, it } from 'vitest';
import { missFragment, SYS_EN, SYS_IT, sysEn } from '../../../src/shared/sys';
import { setLang, sysText } from '../../../src/renderer/i18n';
import type { ChatItem } from '../../../src/shared/contract';

type Sys = Extract<ChatItem, { kind: 'system' }>;
const item = (code: string, params?: Record<string, string | number>): Sys =>
  ({ kind: 'system', id: 's1', at: 0, level: 'info', text: '', code: code as Sys['code'], params } as Sys);

describe('sys.ts: SYS_IT / SYS_EN', () => {
  it('have exactly the same keys', () => {
    expect(Object.keys(SYS_EN).sort()).toEqual(Object.keys(SYS_IT).sort());
  });
  it('agree on string vs. function per key, and no empty string', () => {
    for (const k of Object.keys(SYS_IT) as (keyof typeof SYS_IT)[]) {
      expect(typeof SYS_EN[k], k).toBe(typeof SYS_IT[k]);
      if (typeof SYS_IT[k] === 'string') expect((SYS_IT[k] as string).trim(), k).not.toBe('');
      if (typeof SYS_EN[k] === 'string') expect((SYS_EN[k] as string).trim(), k).not.toBe('');
    }
  });
});

describe('sysEn(): the English rendering main writes into text', () => {
  it('renders plain codes as-is', () => {
    expect(sysEn('stoppedByYou')).toBe('Stopped by you.');
    expect(sysEn('interrupted')).toBe('Interrupted.');
  });
  it('renders a function code with its params', () => {
    expect(sysEn('queueCancelled', { n: 3 })).toBe('Queued messages cancelled: 3.');
    expect(sysEn('apiKeyRejected', { host: 'api.example.com' })).toBe('API key rejected by api.example.com.');
  });
  it('renders the "n/m" retry attempt fragment', () => {
    expect(sysEn('netRetried', { label: 'Cursor', attempt: '1/2' })).toBe('Restarted by itself after a Cursor network error (attempt 1 of 2).');
    expect(sysEn('netRetryScheduled', { label: 'Cursor', seconds: 5, attempt: '2/3' }))
      .toBe('Cursor network error: restarting by itself in 5 s (attempt 2 of 3).');
  });
  it('renders the missFragment-encoded misses list', () => {
    const misses = [missFragment.askedModel('gpt-5'), missFragment.notOffered('effort', 'medium')].join(';;');
    expect(sysEn('runningOther', { label: 'Cursor', variant: 'x', misses }))
      .toBe('Cursor runs x (asked model gpt-5; effort medium not offered).');
  });
  it('keeps engine names with "|" or ";;" whole in the misses list', () => {
    const misses = [missFragment.refused('Thinking | Effort', 'a;;b'), missFragment.notApplied('fast', 'on')].join(';;');
    expect(sysEn('runningOther', { label: 'Cursor', variant: 'x', misses }))
      .toBe('Cursor runs x (Thinking | Effort a;;b refused; fast on not applied).');
  });
  it('renders the comma-joined "later" items list', () => {
    expect(sysEn('appliedLater', { items: 'title,model' })).toBe('Applied from the next start: title, model.');
  });
});

describe('sysText(): a system ChatItem in the current language', () => {
  it('falls back to item.text when there is no code', () => {
    expect(sysText({ kind: 'system', id: 's', at: 0, level: 'info', text: 'old plain text' })).toBe('old plain text');
  });
  it('renders the Italian text for a plain code', () => {
    setLang('it');
    expect(sysText(item('stoppedByYou'))).toBe('Interrotto da te.');
    setLang('en');
  });
  it('renders the English text for a plain code', () => {
    setLang('en');
    expect(sysText(item('stoppedByYou'))).toBe('Stopped by you.');
  });
  it('renders a function code with its params in both languages', () => {
    setLang('it');
    expect(sysText(item('apiKeyRejected', { host: 'x.test' }))).toBe('Chiave API rifiutata da x.test.');
    setLang('en');
    expect(sysText(item('apiKeyRejected', { host: 'x.test' }))).toBe('API key rejected by x.test.');
  });
});
