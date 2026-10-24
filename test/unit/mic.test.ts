// The microphone picker (src/renderer/lib/mic.ts, owner 2026-10-24: «rilevasse il mio microfono usb»): Chromium's alias
// entries are left out, a chosen microphone is found again by name when its id changed, a microphone plugged in while the
// app runs becomes the one in use (toast with «Annulla»), and a chosen one that went away falls back to the default.
import { beforeEach, expect, it, vi } from 'vitest';

const toast = vi.fn();
vi.mock('../../src/renderer/store/ui', () => ({ toast: (...a: unknown[]) => toast(...a) }));

type Dev = { kind: string; deviceId: string; label: string };
let devices: Dev[] = [];
let onChange: (() => void) | null = null;
const getUserMedia = vi.fn();
const store = new Map<string, string>();

beforeEach(() => {
  vi.resetModules();
  toast.mockReset(); getUserMedia.mockReset(); store.clear(); onChange = null;
  devices = [
    { kind: 'audioinput', deviceId: 'default', label: 'Predefinito - Microfono (Realtek)' },
    { kind: 'audioinput', deviceId: 'communications', label: 'Comunicazioni - Microfono (Realtek)' },
    { kind: 'audioinput', deviceId: 'rt', label: 'Microfono (Realtek)' },
    { kind: 'audiooutput', deviceId: 'spk', label: 'Altoparlanti' },
  ];
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
  vi.stubGlobal('navigator', { mediaDevices: {
    enumerateDevices: async () => devices,
    addEventListener: (_: string, fn: () => void) => { onChange = fn; },
    getUserMedia,
  } });
});

const flush = () => new Promise(r => setTimeout(r, 0));

it('lists only the real inputs and finds a chosen one again by name', async () => {
  const { realInputs, pick } = await import('../../src/renderer/lib/mic');
  const list = realInputs(devices as MediaDeviceInfo[]);
  expect(list).toEqual([{ id: 'rt', label: 'Microfono (Realtek)' }]);
  expect(pick({ id: 'old', label: 'Microfono (Realtek)' }, list)).toEqual(list[0]);
  expect(pick({ id: 'old', label: 'Altro' }, list)).toBeNull();
  expect(pick({ id: 'x', label: '' }, [{ id: 'y', label: '' }])).toBeNull();
});

it('uses a USB microphone plugged in while the app runs, and «Annulla» goes back', async () => {
  const m = await import('../../src/renderer/lib/mic');
  m.startMics();
  await flush();
  expect(m.micAudio().deviceId).toBeUndefined(); // the system's default
  devices.push({ kind: 'audioinput', deviceId: 'usb', label: 'Microfono (Blue Yeti USB)' });
  onChange!();
  await flush();
  expect(m.micAudio().deviceId).toEqual({ exact: 'usb' });
  expect(JSON.parse(store.get('sb.mic')!)).toEqual({ id: 'usb', label: 'Microfono (Blue Yeti USB)' });
  expect(toast.mock.calls[0]![0]).toContain('Blue Yeti');
  toast.mock.calls[0]![2].run(); // «Annulla»
  expect(m.micAudio().deviceId).toBeUndefined();
});

it('falls back to the default when the chosen microphone is unplugged, and uses it again when it is back', async () => {
  store.set('sb.mic', JSON.stringify({ id: 'usb', label: 'Microfono (Blue Yeti USB)' }));
  devices.push({ kind: 'audioinput', deviceId: 'usb', label: 'Microfono (Blue Yeti USB)' });
  const m = await import('../../src/renderer/lib/mic');
  m.startMics();
  await flush();
  expect(m.mics.get().using).toBe(true);
  const changed = vi.fn();
  m.onMicChange(changed);
  devices = devices.filter(d => d.deviceId !== 'usb');
  onChange!();
  await flush();
  expect(m.micAudio().deviceId).toBeUndefined();
  expect(m.mics.get().chosen?.id).toBe('usb'); // remembered for when it comes back
  expect(changed).toHaveBeenCalled();
  devices.push({ kind: 'audioinput', deviceId: 'usb2', label: 'Microfono (Blue Yeti USB)' }); // another port, another id
  onChange!();
  await flush();
  expect(m.micAudio().deviceId).toEqual({ exact: 'usb2' });
});

it('opens the default when the chosen microphone vanished between the list and the request', async () => {
  store.set('sb.mic', JSON.stringify({ id: 'rt', label: 'Microfono (Realtek)' }));
  const m = await import('../../src/renderer/lib/mic');
  m.startMics();
  await flush();
  const stream = { getTracks: () => [] };
  getUserMedia.mockRejectedValueOnce(Object.assign(new Error('gone'), { name: 'OverconstrainedError' })).mockResolvedValueOnce(stream);
  await expect(m.openMicStream()).resolves.toBe(stream);
  expect(getUserMedia.mock.calls[0]![0].audio.deviceId).toEqual({ exact: 'rt' });
  expect(getUserMedia.mock.calls[1]![0].audio.deviceId).toBeUndefined();
  // a refusal is not a missing device: it stays an error
  getUserMedia.mockRejectedValueOnce(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
  await expect(m.openMicStream()).rejects.toThrow('no');
});
