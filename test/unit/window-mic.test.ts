// The app window's permission rule (ADR 0152, src/main/window.ts micAllowed): only the microphone, only audio, only for
// the app's own page; the camera, screen capture and every other permission stay refused.
import { expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ BrowserWindow: class {}, screen: {}, shell: {} }));
vi.mock('../../src/main/ipc', () => ({ isAppPage: (u: string) => u === 'file:///app/index.html', setAppPage: vi.fn() }));
vi.mock('../../src/main/keyguard', () => ({ swallowCloseKey: vi.fn() }));
vi.mock('../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/health', () => ({ recordRenderer: vi.fn() }));
import { micAllowed } from '../../src/main/window';

const app = 'file:///app/index.html';
it('grants audio alone to the app page', () => {
  expect(micAllowed('media', { mediaTypes: ['audio'], requestingUrl: app }, app)).toBe(true);
  expect(micAllowed('media', { mediaTypes: ['audio'] }, app)).toBe(true);
});
it('refuses video, an empty request, another page or another permission', () => {
  expect(micAllowed('media', { mediaTypes: ['audio', 'video'], requestingUrl: app }, app)).toBe(false);
  expect(micAllowed('media', { mediaTypes: ['video'] }, app)).toBe(false);
  expect(micAllowed('media', { mediaTypes: [] }, app)).toBe(false);
  expect(micAllowed('media', { mediaTypes: ['audio'], requestingUrl: 'https://evil.example' }, app)).toBe(false);
  expect(micAllowed('media', { mediaTypes: ['audio'] }, 'https://evil.example')).toBe(false);
  expect(micAllowed('notifications', undefined, app)).toBe(false);
  expect(micAllowed('display-capture', { mediaTypes: ['audio'] }, app)).toBe(false);
});
