// Warning authorization requires the complete notice inside every clipping ancestor and outside modal occlusion.
import { afterEach, expect, it, vi } from 'vitest';
import { noticeVisible } from '../../src/renderer/lib/notice-visible';

afterEach(() => vi.unstubAllGlobals());
it('does not acknowledge an off-scroll warning that still lies inside the window coordinates', () => {
  const parent = { parentElement: null, getBoundingClientRect: () => ({ left: 0, right: 400, top: 600, bottom: 780 }) };
  const el = { isConnected: true, offsetParent: parent, parentElement: parent, contains: () => true,
    getBoundingClientRect: () => ({ left: 10, right: 390, top: 580, bottom: 620, width: 380, height: 40 }) } as unknown as HTMLElement;
  vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 800 });
  vi.stubGlobal('document', { hidden: false, elementFromPoint: () => el });
  vi.stubGlobal('getComputedStyle', (target: unknown) => ({ opacity: '1', visibility: 'visible', display: 'block', overflowX: 'visible', overflowY: target === parent ? 'auto' : 'visible' }));
  expect(noticeVisible(el)).toBe(false);
});
it('acknowledges an entirely visible notice but rejects a covering dialog or invisible ancestor', () => {
  const el = { isConnected: true, offsetParent: {}, parentElement: null, contains: () => false,
    getBoundingClientRect: () => ({ left: 10, right: 390, top: 600, bottom: 640, width: 380, height: 40 }) } as unknown as HTMLElement;
  let target: unknown = el, opacity = '1';
  vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 800 });
  vi.stubGlobal('document', { hidden: false, elementFromPoint: () => target });
  vi.stubGlobal('getComputedStyle', () => ({ opacity, visibility: 'visible', display: 'block', overflowX: 'visible', overflowY: 'visible' }));
  expect(noticeVisible(el)).toBe(true);
  target = {}; expect(noticeVisible(el)).toBe(false);
  target = el; opacity = '0'; expect(noticeVisible(el)).toBe(false);
});
