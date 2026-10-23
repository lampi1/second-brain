// The personal browser's state in the renderer (the Browser page, ADR 0133): main pushes it on 'personal:changed'
// (tabs, bookmarks, sessions, history, saved logins as site + user name only); this store starts itself on first use,
// loads 'personal:state' once and keeps the last value. The actions call main and say a failure with a toast.
// Used by components/BrowserPage.tsx.
import type { PersonalState } from '@shared/contract';
import { createStore } from './createStore';
import { toast } from './ui';
import { t } from '../i18n';

export const personal = createStore<PersonalState | null>(null);

let listening = false;
let loading = false;
function start(): void {
  if (personal.get() || loading) return;
  try {
    if (!listening) { window.sb.on('personal:changed', s => personal.set(s)); listening = true; }
    loading = true;
    void window.sb.invoke('personal:state', undefined).then(s => { personal.set(x => x ?? s); }, () => {}).finally(() => { loading = false; });
  } catch { /* no bridge (tests) */ }
}

export function usePersonal<T>(sel: (s: PersonalState | null) => T, eq?: (a: T, b: T) => boolean): T {
  start();
  return personal.use(sel, eq);
}

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
const fail = (e: unknown) => toast(`${t('pbrowser.failed')} ${errText(e)}`, 'err');

export const openTab = (url?: string) => window.sb.invoke('personal:open', url ? { url } : {}).catch(e => { fail(e); return null; });
export const navigate = (tabId: string, input: string) => void window.sb.invoke('personal:navigate', { tabId, input }).catch(fail);
export const goTab = (tabId: string, dir: 'back' | 'forward' | 'reload' | 'stop') => void window.sb.invoke('personal:go', { tabId, dir }).catch(fail);
export const selectTab = (tabId: string) => void window.sb.invoke('personal:select', { tabId }).catch(fail);
export const closeTab = (tabId: string) => void window.sb.invoke('personal:close', { tabId }).catch(fail);
export const restoreTabs = () => void window.sb.invoke('personal:restore', undefined).catch(fail);

/** Opens an address in the given tab, or in a new one when there is none. */
export function go(tabId: string | null, input: string): void {
  if (!input.trim()) return;
  if (tabId) navigate(tabId, input); else void openTab(input);
}

export const addBookmark = (url: string, title: string) => void window.sb.invoke('personal:bookmarkAdd', { url, title }).then(() => toast(t('pbrowser.bookmarkAdded'), 'ok'), fail);
export const removeBookmark = (id: string) => void window.sb.invoke('personal:bookmarkRemove', { id }).catch(fail);
export const saveSession = (name: string) => void window.sb.invoke('personal:sessionSave', { name }).then(s => toast(t('pbrowser.sessionSaved', { name: s.name, n: s.tabs.length }), 'ok'), fail);
export const openSession = (id: string) => void window.sb.invoke('personal:sessionOpen', { id }).catch(fail);
export const removeSession = (id: string) => void window.sb.invoke('personal:sessionRemove', { id }).catch(fail);
export const clearHistory = () => void window.sb.invoke('personal:historyClear', undefined).then(() => toast(t('pbrowser.historyCleared'), 'ok'), fail);

export function fillLogin(tabId: string, id: string): void {
  void window.sb.invoke('personal:loginFill', { tabId, id }).then(ok => { if (!ok) toast(t('pbrowser.fillFailed'), 'err'); }, fail);
}
export function saveLogin(tabId: string): void {
  void window.sb.invoke('personal:loginSave', { tabId }).then(r => toast(r.ok ? t('pbrowser.loginSaved', { site: r.login?.site ?? '' }) : r.reason ?? t('pbrowser.failed'), r.ok ? 'ok' : 'err'), fail);
}
export const removeLogin = (id: string) => void window.sb.invoke('personal:loginRemove', { id }).catch(fail);
export function copyLogin(id: string, field: 'user' | 'password'): void {
  void window.sb.invoke('personal:loginCopy', { id, field }).then(ok => toast(ok ? (field === 'password' ? t('pbrowser.passwordCopied') : t('pbrowser.userCopied')) : t('pbrowser.failed'), ok ? 'ok' : 'err'), fail);
}
export function importLogins(): void {
  void window.sb.invoke('personal:loginImport', undefined).then(r => {
    if (r.cancelled) return;
    if (r.reason) { toast(r.reason, 'err'); return; }
    toast(t('pbrowser.imported', { added: r.added, updated: r.updated, skipped: r.skipped }), 'ok');
  }, fail);
}
