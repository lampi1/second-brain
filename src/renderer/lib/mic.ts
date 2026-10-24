// Which microphone the app opens (owner, 2026-10-24: «vorrei anche che rilevasse il mio microfono usb»): Settings → Voce
// lists the PC's inputs (enumerateDevices) and updates the list the moment one is plugged in or out (devicechange). A
// microphone plugged in while the app runs becomes the one in use at once, with «Annulla» in the toast; the one chosen
// that is unplugged gives way to the system's default until it comes back. The choice is this PC's own (device ids are
// per machine), so it lives in localStorage, not in the brain's settings; an unreadable store only means «Predefinito».
// Used by lib/voice.ts (voice mode) and lib/recorder.ts (call recording) through micAudio(), and by VoiceSettings.tsx.
import { createStore } from '../store/createStore';
import { toast } from '../store/ui';
import { t } from '../i18n';

export interface MicDevice { id: string; label: string }
/** chosen: null = the system's default; using: the chosen one is plugged in now */
export interface MicUi { devices: MicDevice[]; chosen: MicDevice | null; using: boolean }

const KEY = 'sb.mic';
function load(): MicDevice | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown;
    return v && typeof v === 'object' && typeof (v as MicDevice).id === 'string' ? { id: (v as MicDevice).id, label: String((v as MicDevice).label ?? '') } : null;
  } catch { return null; }
}
function save(m: MicDevice | null): void {
  try { if (m) localStorage.setItem(KEY, JSON.stringify(m)); else localStorage.removeItem(KEY); } catch { /* the choice lasts until the app closes */ }
}

export const mics = createStore<MicUi>({ devices: [], chosen: null, using: false });
export const useMics = mics.use;

/** The real inputs: Chromium's «default» and «communications» entries are aliases of one of them. */
export function realInputs(list: readonly Pick<MediaDeviceInfo, 'kind' | 'deviceId' | 'label'>[]): MicDevice[] {
  return list.filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map(d => ({ id: d.deviceId, label: d.label }));
}

/** A microphone's name as shown (Chromium hides the names until the microphone was allowed once). */
export const micName = (m: MicDevice, i = 0): string => m.label || t('mic.unnamed', { n: i + 1 });

/** The chosen microphone among the plugged ones: by id, else by name (Windows may give a USB mic a new id on another
 *  port), else none (the default). */
export function pick(chosen: MicDevice | null, devices: readonly MicDevice[]): MicDevice | null {
  if (!chosen) return null;
  return devices.find(d => d.id === chosen.id) ?? devices.find(d => chosen.label && d.label === chosen.label) ?? null;
}

/** The microphones that were not there before (one plugged in now). */
export const added = (before: readonly MicDevice[], now: readonly MicDevice[]): MicDevice[] => now.filter(d => !before.some(b => b.id === d.id || (b.label && b.label === d.label)));

const changed = new Set<() => void>();
/** The microphone to use changed (chosen in Settings, plugged in, unplugged): voice mode reopens it. */
export const onMicChange = (fn: () => void): (() => void) => { changed.add(fn); return () => changed.delete(fn); };
const tell = () => { for (const fn of changed) { try { fn(); } catch { /* a listener's own problem */ } } };

let seen = false;
async function refresh(): Promise<{ before: MicDevice[]; now: MicDevice[] }> {
  const before = mics.get().devices;
  let now: MicDevice[] = [];
  try { now = realInputs(await navigator.mediaDevices.enumerateDevices()); } catch { /* no media devices here */ }
  const chosen = mics.get().chosen;
  mics.set(s => ({ ...s, devices: now, using: !!pick(chosen, now) }));
  return { before, now };
}

/** Settings → Voce opened: the list again (names may have shown up since). */
export const refreshMics = (): void => { void refresh(); };

/** The user's choice in Settings → Voce (null = the system's default). */
export function chooseMic(m: MicDevice | null): void {
  save(m);
  mics.set(s => ({ ...s, chosen: m, using: !!pick(m, s.devices) }));
  tell();
}

let wired = false;
/** Once (main.tsx): the saved choice, the list, and the plug / unplug watch. */
export function startMics(): void {
  if (wired || typeof navigator === 'undefined' || !navigator.mediaDevices) return;
  wired = true;
  mics.set(s => ({ ...s, chosen: load() }));
  void refresh().then(() => { seen = true; });
  navigator.mediaDevices.addEventListener('devicechange', () => { void plugged(); });
}

async function plugged(): Promise<void> {
  const wasUsing = mics.get().using;
  const { before, now } = await refresh();
  if (!seen) { seen = true; return; }
  const fresh = added(before, now);
  const prev = mics.get().chosen;
  if (fresh.length) {
    const m = fresh[0]!;
    chooseMic(m);
    toast(t('mic.plugged', { name: micName(m) }), 'info', { label: t('mic.undo'), run: () => chooseMic(prev) }, 8000);
    return;
  }
  if (wasUsing && !mics.get().using && prev) { toast(t('mic.gone', { name: micName(prev) }), 'info'); tell(); }
}

/** The constraints for getUserMedia: the voice-friendly filters, on the chosen microphone when it is plugged in. */
export function micAudio(): MediaTrackConstraints {
  const base: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
  const m = pick(mics.get().chosen, mics.get().devices);
  return m ? { ...base, deviceId: { exact: m.id } } : base;
}

/** Opens the microphone; a chosen one that went away meanwhile falls back to the default instead of failing. */
export async function openMicStream(): Promise<MediaStream> {
  const audio = micAudio();
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio });
    if (mics.get().devices.some(d => !d.label)) void refresh(); // the names show once the microphone is allowed
    return s;
  } catch (e) {
    const name = (e as Error)?.name;
    if (!audio.deviceId || (name !== 'OverconstrainedError' && name !== 'NotFoundError' && name !== 'NotReadableError')) throw e;
    const { deviceId: _gone, ...rest } = audio;
    return navigator.mediaDevices.getUserMedia({ audio: rest });
  }
}
