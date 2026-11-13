// Settings → Avanzate «Coda e avvii» (ADR 0222): how many agents' cold starts run at once (0 = automatic, half the
// cores, shown with this PC's core count from app:info) and the emergency brake's CPU and free-RAM thresholds. Each
// is a protected setting (coldStartSlots, loadQueueCpu, loadQueueRam): the user's pick here goes through settings:set
// like any row; an agent can only propose it. Its own block and anchor (st-queue), so a sibling block of the same
// group stays separate. Used by SettingsPage.tsx; main applies the values at the next admission (wiring.ts limits).
import type { ReactNode } from 'react';
import { autoColdSlots } from '@shared/cold-slots';
import { Select } from './Select';
import { IconShield } from './Icons';
import { setSetting, useApp } from '../store/store';
import { cpuChoices, ramChoices, slotChoices } from '../lib/queue-settings';
import { t } from '../i18n';

function QueueRow({ id, title, hint, children }: { id: string; title: string; hint: string; children: ReactNode }) {
  return <div className="st-row" data-testid={`st-queue-${id}`}>
    <div className="st-text">
      <span className="st-title-line"><label className="st-title">{title}</label><span className="st-protected" title={t('stx.protectedTip')} aria-label={t('stx.protected')}><IconShield size={12} /><span>{t('stx.protected')}</span></span></span>
      <p className="st-desc">{hint}</p>
    </div>
    <div className="st-ctl">{children}</div>
  </div>;
}

export function QueueSettings() {
  const cores = useApp(s => s.info?.cores ?? 0);
  const slots = useApp(s => s.settings?.coldStartSlots ?? 0);
  const cpu = useApp(s => s.settings?.loadQueueCpu ?? 95);
  const ram = useApp(s => s.settings?.loadQueueRam ?? 10);
  const auto = autoColdSlots(cores || 2);
  return <div id="st-queue" data-testid="st-queue">
    <div className="st-row"><div className="st-text"><span className="st-title">{t('queueSt.title')}</span><p className="st-desc">{t('queueSt.lead')}</p></div></div>
    <QueueRow id="slots" title={t('queueSt.slots')} hint={cores ? t('queueSt.slotsHint', { cores, auto }) : ''}>
      <Select aria-label={t('queueSt.slots')} data-testid="st-queue-slots-select" value={slots} onChange={e => void setSetting({ coldStartSlots: Number(e.target.value) })}>
        {slotChoices(cores, slots).map(n => <option key={n} value={n}>{n ? String(n) : t('queueSt.slotsAuto', { auto })}</option>)}
      </Select>
    </QueueRow>
    <QueueRow id="cpu" title={t('queueSt.cpu')} hint={t('queueSt.cpuHint')}>
      <Select aria-label={t('queueSt.cpu')} data-testid="st-queue-cpu-select" value={cpu} onChange={e => void setSetting({ loadQueueCpu: Number(e.target.value) })}>
        {cpuChoices(cpu).map(n => <option key={n} value={n}>{t('queueSt.pct', { n })}</option>)}
      </Select>
    </QueueRow>
    <QueueRow id="ram" title={t('queueSt.ram')} hint={t('queueSt.ramHint')}>
      <Select aria-label={t('queueSt.ram')} data-testid="st-queue-ram-select" value={ram} onChange={e => void setSetting({ loadQueueRam: Number(e.target.value) })}>
        {ramChoices(ram).map(n => <option key={n} value={n}>{n ? t('queueSt.pct', { n }) : t('queueSt.ramOff')}</option>)}
      </Select>
    </QueueRow>
  </div>;
}
