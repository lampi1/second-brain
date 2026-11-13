// The Task page's reading settings, in Settings → Notifiche (ADR 0101; C-ux audit: they sat at the top of a work page,
// labels touching the controls): the automatic read of Azure DevOps (on/off), how often, and the alerts' sound. The
// same store and actions as before (store/tasks.ts setTasks), so nothing changes in what they do; the Task page keeps a
// small link here ("Lettura automatica: ogni 15 min · Impostazioni"). Rendered by SettingsPage.tsx (notifications group)
// only once the first read answered (no flash of defaults); testid task-auto, as on the Task page before.
import type { ReactNode } from 'react';
import { EVERY_CHOICES, setTasks, useTasks } from '../store/tasks';
import { t } from '../i18n';
import { fmt } from '../brain/lib/format';
import { Seg } from '../brain/components/ui';

export function TaskReadSettings() {
  const s = useTasks(x => x);
  if (!s) return null;
  const every = (EVERY_CHOICES as readonly number[]).includes(s.everyMin) ? s.everyMin : null;
  const onOff = [{ id: 'off', label: t('brainPages.task.off') }, { id: 'on', label: t('brainPages.task.on') }];
  const row = (title: string, desc: string | null, ctl: ReactNode) => <div className="st-row"><div className="st-text"><span className="st-title">{title}</span>{desc && <p className="st-desc">{desc}</p>}</div><div className="st-ctl">{ctl}</div></div>;
  return <div className="st-task-read" data-testid="task-auto">
    {row(t('brainPages.task.autoLabel'), s.enabled && s.nextAt ? t('brainPages.task.next', { when: fmt.when(s.nextAt) }) : t('brainPages.task.readHint'),
      <Seg label={t('brainPages.task.autoLabel')} value={s.enabled ? 'on' : 'off'} onChange={v => { setTasks({ enabled: v === 'on' }); }} items={onOff} />)}
    {row(t('brainPages.task.everyLabel'), every === null ? `${s.everyMin} min` : null,
      <Seg label={t('brainPages.task.everyLabel')} value={every ?? -1} onChange={v => { setTasks({ everyMin: v }); }}
        items={EVERY_CHOICES.map(m => ({ id: m as number, label: m < 60 ? `${m} min` : `${m / 60} h` }))} />)}
    {row(t('brainPages.task.sound'), t('brainPages.task.soundTip'),
      <Seg label={t('brainPages.task.sound')} value={s.sound ? 'on' : 'off'} onChange={v => { setTasks({ sound: v === 'on' }); }} items={onOff} />)}
  </div>;
}
