// What a full-screen window keeps of the rest of the app (ADR 0287), at the end of its one bar: how many questions wait
// elsewhere (a click or Ctrl+J opens them in the Orchestrator beside the window) and the Orchestrator itself (Ctrl+R: the
// column opens beside the window and closes again; it is where every request starts, so it stays one key away).
// Used by ChatTile.tsx (a chat in full screen) and BrowserTile.tsx (a browser tab without a strip in full screen).
import { useApp } from '../store/store';
import { ui } from '../store/ui';
import { nextThing, toggleOrchestrator } from '../actions';
import { Keys } from './ui';
import { t } from '../i18n';

export function FullTools({ chatId }: { chatId?: string }) {
  const others = useApp(s => s.pending.filter(p => p.chatId !== chatId).length);
  const open = ui.use(s => s.fullOrch);
  return <span className="full-tools">
    {others > 0 && <button type="button" className="btn btn-amber btn-s" onClick={() => nextThing()} data-testid="focus-waiting">{t('chat.focus.waiting', { n: others })} <Keys combo="Ctrl+J" /></button>}
    <button type="button" className={`btn btn-ghost btn-s full-orch-btn${open ? ' on' : ''}`} aria-pressed={open} onClick={toggleOrchestrator} data-testid="full-orchestrator" data-tip={t(open ? 'aw.orchestratorHide' : 'aw.orchestratorShow')}>
      <span className="orchestrator-column-mark" aria-hidden="true">✦</span>Orchestrator <Keys combo="Ctrl+R" />
    </button>
  </span>;
}
