// Explicit coordination request: read fresh evidence and present actionable decisions in the shared modal queue.
// This control stays in the Orchestrator; Home contains only agent strips.
import { t } from '../i18n';
import { useApp, send } from '../store/store';
import { openQueue } from '../lib/later';
import { reloadWorkflows, reloadLessons } from '../store/workflows';
import { toast } from '../store/ui';
import '../styles/work-cockpit.css';
export const RECAP = 'Fai il punto: leggi ora app_work_list, app_digest e agent_lessons_waiting e aggiorna i fili dalle evidenze. Proponimi il prossimo passo concreto da decidere nei popup Sì / No, una decisione alla volta, con breve contesto, azione consigliata e ambito esatto. Usa app_work_report propose per le decisioni dei fili; riusa i piani e le richieste già aperti senza duplicarli. Per le altre decisioni usa il tuo strumento nativo di domanda. Riprendi le correzioni registrate ancora da trattare, senza ripetere quelle già risolte. Apri app_unblock, incluse le richieste rimandate. Produzione e supporto hanno precedenza. Non scrivere un riepilogo testuale, elenchi di lavori o domande per chiedere se voglio un riepilogo. Continua da solo i passi già autorizzati. Non inventare approvazioni. Se non serve alcuna decisione, basta una sola breve frase di stato; spiega soltanto se te lo chiedo.';
export function RecapButton() {
  const orch = useApp(s => Object.values(s.chats).find(c => c.isOrchestrator && !c.closedAt));
  const queued = useApp(s => orch ? (s.queued[orch.id] ?? []).some(m => m.text === RECAP) : false);
  return <button className="btn btn-primary btn-s" type="button" data-testid="work-recap" disabled={!orch || queued}
    title={t('cmp.durable.cockpit.title')} onClick={() => {
      if (!orch) return;
      void reloadWorkflows(); void reloadLessons();
      if (orch.pending || orch.state === 'waiting') openQueue(null);
      const result = send(orch.id, RECAP);
      if (result !== 'empty') toast(result === 'queued' ? t('cmp.durable.cockpit.queuedToast') : t('cmp.durable.cockpit.preparing'), 'ok');
    }}>{queued ? t('cmp.durable.cockpit.queued') : t('cmp.durable.cockpit.recap')}</button>;
}
