// Preference metadata remains usable in Node; native page IPC is loaded only when the page is mounted.
import { expect, it } from 'vitest';
import { BRAIN_PAGES, isBrainPage } from '../../src/renderer/brain';
import { loadPrefs } from '../../src/renderer/store/ui';

it('loads table navigation and preferences without a browser or a fake native bridge', () => {
  expect(typeof window).toBe('undefined');
  expect(isBrainPage('sezioni')).toBe(true);
  expect(BRAIN_PAGES.find(page => page.id === 'sezioni')?.key).toBe('G Z');
  expect(loadPrefs(null, 0)).toBeDefined();
});
