// "Nuovo Orchestrator" confirm (Ctrl+Shift+R, the palette, the Orchestrator's ⋯ menu): pick the engine among the registry's (the
// same one = "Ricomincia da capo", another = "Cambia motore"), choose whether the new Orchestrator starts from a summary of
// the old one, confirm.
// The old Orchestrator stays among the chats, closed, with its history (renewOrchestrator in actions.ts does the work). Why one
// dialog for both: same mechanism, one place to learn. Used by App.tsx (modal 'orchestratorRenew').
import { useState } from 'react';
import type { Harness } from '@shared/contract';
import { useApp } from '../store/store';
import { closeModal, ui } from '../store/ui';
import { t } from '../i18n';
import { renewOrchestrator } from '../actions';
import { engineName, useEngines } from '../lib/engines';
import { useEngineBlocks } from './ChatMenu';
import { HarnessMark } from './Icons';
import { Keys, Modal } from './ui';

export function OrchestratorRenewDialog() {
  const spec = ui.use(s => s.orchestratorRenew);
  const chat = useApp(s => (spec ? s.chats[spec.chatId] ?? null : null));
  const [to, setTo] = useState<Harness>(spec?.to ?? '');
  const [summary, setSummary] = useState(true);
  const [busy, setBusy] = useState(false);
  const engines = useEngines();
  const blockOf = useEngineBlocks();
  // a Cursor Orchestrator restored after a restart has no exchanges until it is reopened: the summary would carry only now.md
  const loaded = useApp(s => !!spec && (s.items[spec.chatId] ?? []).some(i => i.kind === 'user' || i.kind === 'assistant'));
  if (!spec || !chat) return null;
  const same = to === chat.harness;
  const block = blockOf(to);
  const go = async () => {
    if (busy || block) return;
    setBusy(true);
    const ok = await renewOrchestrator(chat.id, to, summary);
    setBusy(false);
    if (ok) closeModal();
  };
  const action = same ? t('dialogs.orchestratorRenew.restartButton') : t('dialogs.orchestratorRenew.switchButton', { engine: engineName(to) });
  return (
    <Modal onClose={closeModal} label={t('dialogs.orchestratorRenew.title')} testid="orchestrator-renew" className="modal-renew" size="m" onSubmit={() => void go()}
      icon={<HarnessMark harness={chat.harness} orchestrator size={20} />} title={t('dialogs.orchestratorRenew.title')} subtitle={t('dialogs.orchestratorRenew.hint')}
      aside={<Keys combo={t('dialogs.orchestratorRenew.shortcutCombo')} />}
      footer={<>
        <button type="button" className="btn btn-ghost btn-m" onClick={closeModal} data-testid="orchestrator-renew-cancel">{t('dialogs.orchestratorRenew.cancelButton')} <Keys combo="Esc" /></button>
        <button type="submit" className="btn btn-orchestrator btn-m" autoFocus data-autofocus disabled={busy || !!block} data-testid="orchestrator-renew-go">{busy ? t('dialogs.orchestratorRenew.restarting') : action}</button>
      </>}>
      <div className="harness-pick" role="radiogroup" aria-label={t('dialogs.orchestratorRenew.engineLabel')}>
        {engines.map(({ id: h, name }) => (
          <button key={h} type="button" role="radio" aria-checked={to === h} className={`harness-card ${to === h ? 'on' : ''}`} disabled={!!blockOf(h)}
            onClick={() => setTo(h)} data-testid={`orchestrator-renew-${h}`}>
            <HarnessMark harness={h} size={28} />
            <span><b>{name}</b><small>{blockOf(h) ?? (h === chat.harness ? t('dialogs.orchestratorRenew.restart') : t('dialogs.orchestratorRenew.switchEngine', { engine: name }))}</small></span>
          </button>
        ))}
      </div>
      <label className="check">
        <input type="checkbox" checked={summary} onChange={e => setSummary(e.target.checked)} data-testid="orchestrator-renew-summary" />
        <span>{t('dialogs.orchestratorRenew.bringingSummary')} <small data-testid="orchestrator-renew-summary-what">{loaded ? t('dialogs.orchestratorRenew.summaryExplain') : t('dialogs.orchestratorRenew.summaryNone')}</small></span>
      </label>
      <p className="orchestrator-note" data-testid="orchestrator-renew-note">
        <HarnessMark harness={chat.harness} size={16} />
        <span>{t('dialogs.orchestratorRenew.note')} <b>«{chat.title}»</b> {t('dialogs.orchestratorRenew.noteSuffix')}</span>
      </p>
    </Modal>
  );
}
