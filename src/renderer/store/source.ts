// "Aggiorna" in the renderer (Settings → Aggiornamenti, ADR 0075): main's AppSourceService pushes its state on
// 'source:state' (after each read of the code folder, every step of an update, the restart notice); this store starts
// itself on first use (the settings card or the restart banner), loads 'source:get' and keeps the last value.
// Actions: the GitHub check (checkSource), the one-click update after the user's confirm (askUpdateNow) and dismissing
// the restart notice. Used by components/AppUpdateSettings.tsx and components/LaunchBanner.tsx.
import type { AppSourceState } from '@shared/contract';
import { createStore } from './createStore';
import { askConfirm, toast } from './ui';
import { t } from '../i18n';
import { errText } from '../lib/ipc-error';

export const source = createStore<AppSourceState | null>(null);

let listening = false;
let loading = false;
function start(): void {
  if (source.get() || loading) return;
  try {
    if (!listening) { window.sb.on('source:state', s => source.set(s)); listening = true; }
    loading = true;
    void window.sb.invoke('source:get', {}).then(s => { source.set(x => x ?? s); }, () => {}).finally(() => { loading = false; });
  } catch { /* no bridge (brain test route) */ }
}

export function useSource<T>(sel: (s: AppSourceState | null) => T): T {
  start();
  return source.use(sel);
}

export function dismissLaunch(): void {
  source.set(s => (s ? { ...s, launch: null } : s));
  void window.sb.invoke('source:dismissLaunch', undefined).then(s => source.set(s), () => {});
}

/** What GitHub has that this copy does not (git fetch only). */
export function checkSource(): void {
  void window.sb.invoke('source:check', undefined).then(s => source.set(s), () => {});
}

/** "Aggiorna" in Settings: one confirm, then pull, build and restart on the new version, no tests (ADR 0075). */
export function askUpdateNow(stable: boolean): void {
  askConfirm({
    title: t('update.confirmTitle'),
    body: t('update.confirmBody'),
    items: [t('update.confirmChats'), t('update.confirmLocal'), stable ? t('update.confirmFallback') : t('update.confirmDevFail')],
    confirmLabel: t('update.confirmOk'),
    onConfirm: () => {
      const cur = source.get();
      if (cur) source.set({ ...cur, source: { ...cur.source, state: 'updating', canUpdate: false } });
      void window.sb.invoke('source:updateNow', undefined).then(st => source.set(st), e => { toast(`${t('update.failed')}: ${errText(e)}`, 'err'); checkSource(); });
    },
  });
}
