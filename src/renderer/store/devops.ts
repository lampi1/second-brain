// The DevOps state of the renderer: main's DevopsService pushes it on 'devops:state' (after each read, a mark as read,
// a settings change); this store starts itself on the first use (the page or the sidebar badge), loads 'devops:get'
// once and keeps the last value. Actions: "Aggiorna ora" (devops:refresh) and mark as read (devops:markRead), with an
// error toast on failure. Used by brain/pages/Devops.tsx, components/Sidebar.tsx and the settings menu (TopBar).
import type { DevopsState, Settings } from '@shared/contract';
import { createStore } from './createStore';
import { toast } from './ui';
import { t } from '../i18n';

export const devops = createStore<DevopsState | null>(null);
/** The intervals offered by the page and the gear menu (any 5..720 is valid in the settings). */
export const EVERY_CHOICES = [15, 30, 60, 120] as const;

let listening = false;
let loading = false;
function start(): void {
  if (devops.get() || loading) return;
  try {
    if (!listening) { window.sb.on('devops:state', s => devops.set(s)); listening = true; }
    loading = true;
    void window.sb.invoke('devops:get', undefined).then(s => { devops.set(x => x ?? s); }, () => {}).finally(() => { loading = false; });
  } catch { /* no bridge (brain test route) */ }
}

export function useDevops<T>(sel: (s: DevopsState | null) => T): T {
  start();
  return devops.use(sel);
}

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

/** "Aggiorna ora" from anywhere: the outcome is always said (a toast), also when the page is not open. */
export function refreshDevops(): void {
  void window.sb.invoke('devops:refresh', undefined).then(s => {
    devops.set(s);
    if (s.error) toast(s.error.kind === 'login' ? t('tools.devops.notReadTimeout') : `${t('tools.devops.notRead')} ${s.error.message}`, 'err');
    else toast(s.unread ? t('tools.devops.updatedWithNews', { unread: s.unread }) : t('tools.devops.updatedNoNews'), 'ok');
  }, e => toast(`${t('tools.devops.notRead')} ${errText(e)}`, 'err'));
}

/** The automatic read's settings from the page (window.sb at call time: the brain pages load without a bridge in tests). */
export function setDevops(patch: Partial<Settings['devops']>): void {
  void window.sb.invoke('settings:set', { devops: patch }).then(() => toast(t('tools.devops.settingsSaved'), 'ok'), e => toast(`${t('tools.devops.settingsNotSaved')} ${errText(e)}`, 'err'));
}

/** Marks some news as read (all of them without keys). */
export function markDevopsRead(keys?: string[]): void {
  devops.set(s => (s ? { ...s, news: s.news.map(n => (!keys || keys.includes(n.key) ? { ...n, unread: false } : n)), unread: keys ? s.news.filter(n => n.unread && !keys.includes(n.key)).length : 0 } : s));
  void window.sb.invoke('devops:markRead', keys ? { keys } : {}).then(s => devops.set(s), e => toast(`${t('tools.devops.notMarkedRead')} ${errText(e)}`, 'err'));
}
