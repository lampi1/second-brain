// A phone decision cannot authorize a proposal whose scope was truncated before its buttons.
import { expect, it } from 'vitest';
import { canUseButtons, decidableText } from '../../../src/main/phone/buttons';
import { MORE } from '../../../src/main/phone/condense';
import type { PhoneDecidable } from '../../../src/shared/contract/phone';

it('keeps a truncated question or plan pending without approval buttons', () => {
  const item: PhoneDecidable = { chatId: 'worker', ref: { kind: 'question', requestId: 'q' }, role: 'Scout', neutralLabel: 'lavoro 1',
    text: `${'Long context. '.repeat(70)}Use the fixture? Yes: change fixture. No: leave it.`, simple: true, reserved: false, orchestrator: true };
  expect(decidableText(item)).toContain(MORE);
  expect(canUseButtons(item)).toBe(false);
  expect(canUseButtons({ ...item, ref: { kind: 'plan', at: '1' } })).toBe(false);
  expect(canUseButtons({ ...item, text: 'Use fixture? Yes: local only. No: stop.' })).toBe(true);
});
