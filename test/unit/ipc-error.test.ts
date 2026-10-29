// The words of a failed IPC call (src/renderer/lib/ipc-error.ts): Electron's wrapper is dropped, the message kept.
import { expect, it } from 'vitest';
import { errText } from '../../src/renderer/lib/ipc-error';

it('drops Electron\'s "Error invoking remote method" wrapper and keeps anything else as is', () => {
  expect(errText(new Error("Error invoking remote method 'chat:send': Error: la chat è chiusa"))).toBe('la chat è chiusa');
  expect(errText(new Error("Error invoking remote method 'chat:send': boom"))).toBe('boom');
  expect(errText(new Error('plain'))).toBe('plain');
  expect(errText('text')).toBe('text');
});
