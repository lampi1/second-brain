// The Task state of the renderer: main's TaskService pushes it on 'tasks:state' (after each read, a mark as read,
// a settings change); this store starts itself on the first use (the page or the sidebar badge), loads 'tasks:get'
// once and keeps the last value. Actions: "Aggiorna ora" (tasks:refresh) and mark as read (tasks:markRead), with an
// error toast on failure. Used by brain/pages/Task.tsx, components/Sidebar.tsx and the settings menu (TopBar).
import type { TasksState, Settings } from '@shared/contract';
import { createStore } from './createStore';
import { toast } from './ui';
import { t } from '../i18n';
import { errText } from '../lib/ipc-error';

export const tasks = createStore<TasksState | null>(null);
/** The intervals offered by the page and the gear menu (any 5..720 is valid in the settings). */
export const EVERY_CHOICES = [15, 30, 60, 120] as const;

let listening = false;
let loading = false;
function start(): void {
  if (tasks.get() || loading) return;
  try {
    if (!listening) { window.sb.on('tasks:state', s => tasks.set(s)); listening = true; }
    loading = true;
    void window.sb.invoke('tasks:get', undefined).then(s => { tasks.set(x => x ?? s); }, () => {}).finally(() => { loading = false; });
  } catch { /* no bridge (brain test route) */ }
}

export function useTasks<T>(sel: (s: TasksState | null) => T): T {
  start();
  return tasks.use(sel);
}

/** "Aggiorna ora" from anywhere: the outcome is always said (a toast), also when the page is not open. */
export function refreshTasks(): void {
  void window.sb.invoke('tasks:refresh', undefined).then(s => {
    tasks.set(s);
    if (s.error) toast(s.error.kind === 'login' ? t('tools.tasks.notReadTimeout') : `${t('tools.tasks.notRead')} ${s.error.message}`, 'err');
    else toast(s.unread ? t('tools.tasks.updatedWithNews', { unread: s.unread }) : t('tools.tasks.updatedNoNews'), 'ok');
  }, e => toast(`${t('tools.tasks.notRead')} ${errText(e)}`, 'err'));
}

/** The automatic read's settings from the page (window.sb at call time: the brain pages load without a bridge in tests). */
export function setTasks(patch: Partial<Settings['tasks']>): void {
  void window.sb.invoke('settings:set', { tasks: patch }).then(() => toast(t('tools.tasks.settingsSaved'), 'ok'), e => toast(`${t('tools.tasks.settingsNotSaved')} ${errText(e)}`, 'err'));
}

/** Marks some news as read (all of them without keys). */
export function markTasksRead(keys?: string[]): void {
  tasks.set(s => (s ? { ...s, news: s.news.map(n => (!keys || keys.includes(n.key) ? { ...n, unread: false } : n)), unread: keys ? s.news.filter(n => n.unread && !keys.includes(n.key)).length : 0 } : s));
  void window.sb.invoke('tasks:markRead', keys ? { keys } : {}).then(s => tasks.set(s), e => toast(`${t('tools.tasks.notMarkedRead')} ${errText(e)}`, 'err'));
}
