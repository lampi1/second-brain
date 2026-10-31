// The effort a run really gets on its model (shared/agents.ts effortOn, ADR 0211): the asked level when the model takes
// it, the nearest lower one otherwise, none on a model without efforts, the asked one on an unknown model.
import { describe, expect, it } from 'vitest';
import { effortOn } from '../../../src/shared/agents';

describe('effortOn', () => {
  it('keeps a level the model takes', () => expect(effortOn('xhigh', ['low', 'medium', 'high', 'xhigh', 'max'])).toBe('xhigh'));
  it('falls to the nearest lower level', () => expect(effortOn('xhigh', ['low', 'medium', 'high', 'max'])).toBe('high'));
  it('takes the lowest when none is lower', () => expect(effortOn('low', ['medium', 'high'])).toBe('medium'));
  it('drops it on a model without efforts', () => expect(effortOn('high', [])).toBeNull());
  it('passes it through on an unknown model', () => expect(effortOn('max', undefined)).toBe('max'));
  it('nothing asked, nothing sent', () => expect(effortOn(undefined, ['low'])).toBeNull());
});
