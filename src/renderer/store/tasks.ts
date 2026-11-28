// The DevOps read's state in the renderer: main's TaskService pushes it on 'tasks:state' (after each read, a mark as read, a
// settings change); this store starts itself on the first use and loads 'tasks:get' once. The Task page is gone (ADR 0374,
// «Attività pianificate» took its place): the read stays as the source of the DevOps activities, the morning brief, the
// feed and the chats' dev links, so only the state is kept here. Used by components/ChatLinkChips.tsx.
import type { TasksState } from '@shared/contract';
import { createStore } from './createStore';

export const tasks = createStore<TasksState | null>(null);

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
