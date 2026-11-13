// Local and global Modal instances share shortcut isolation without suppressing native text editing or disclosure focus.
import { expect, it, vi } from 'vitest';
import { isolateModalKey, modalTabStops } from '../../src/renderer/lib/modal-keyboard';
const event = (key: string, code: string, ctrlKey = false) => ({ key, code, ctrlKey, altKey: false, metaKey: false, shiftKey: false, stopPropagation: vi.fn(), preventDefault: vi.fn() });
it('blocks workspace shortcuts and Electron close defaults at the modal boundary', () => {
  for (const [key, code] of [['w', 'KeyW'], ['1', 'Digit1'], ['n', 'KeyN'], ['j', 'KeyJ']]) {
    const e = event(key!, code!, true); isolateModalKey(e);
    expect(e.stopPropagation).toHaveBeenCalledOnce(); expect(e.preventDefault).toHaveBeenCalledOnce();
  }
});
it('contains go-sequence letters and editing keys while preserving their native actions', () => {
  for (const e of [event('g', 'KeyG'), event('c', 'KeyC', true), event('v', 'KeyV', true), event('a', 'KeyA', true), event('Tab', 'Tab'), event('Enter', 'Enter')]) {
    isolateModalKey(e); expect(e.stopPropagation).toHaveBeenCalledOnce(); expect(e.preventDefault).not.toHaveBeenCalled();
  }
});
it('includes visible summary disclosures in tab order and omits hidden, disabled and negative-tabindex controls', () => {
  const control = (tag: string, extra: Record<string, unknown> = {}) => ({ tagName: tag, offsetParent: {}, hasAttribute: () => false, getAttribute: () => null, ...extra });
  const button = control('BUTTON'), summary = control('SUMMARY');
  const querySelectorAll = vi.fn().mockReturnValue([button, summary, control('SUMMARY', { offsetParent: null }), control('BUTTON', { hasAttribute: () => true }), control('SUMMARY', { getAttribute: () => '-1' })]);
  expect(modalTabStops({ querySelectorAll })).toEqual([button, summary]);
  expect(querySelectorAll.mock.calls[0]![0]).toContain('summary');
});
