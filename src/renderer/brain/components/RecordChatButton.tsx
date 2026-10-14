// The "Apri chat" button of a DevOps record (work item, PR, test plan, test case): one click starts a work chat through
// the app's own create-chat path (DiscussBridge.newChat: the page stays, a toast "Chat aperta: <title>" leads to it),
// with the title, first message and folder of lib/devops-chat.ts; its engine, model and effort come from the routing
// table (ADR 0032) on the record's kind of work and area. No dialog; the button waits while the chat is being
// created, so a double click never opens two. Hidden without the app (the brain's standalone test route).
// Used by pages/Devops.tsx and pages/DevopsQa.tsx.
import { useContext, useState, type MouseEvent } from 'react';
import { useDevops } from '../../store/devops';
import { recordChat, type DevopsRecord } from '../lib/devops-chat';
import { DiscussContext } from './Discuss';

const idOf = (r: DevopsRecord): number => (r.kind === 'workitem' ? r.item.id : r.kind === 'pr' ? r.pr.id : r.kind === 'testplan' ? r.plan.id : r.point.id);

export function RecordChatButton({ rec }: { rec: DevopsRecord }) {
  const bridge = useContext(DiscussContext);
  const repoDirs = useDevops(s => s?.repoDirs);
  const [busy, setBusy] = useState(false);
  if (!bridge) return null;
  const open = (e: MouseEvent) => {
    // inside a <summary>: the row must not open or close
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    const c = recordChat(rec, repoDirs ?? {});
    setBusy(true);
    void bridge.newChat(c.title, c.prompt, { ...(c.cwd ? { cwd: c.cwd } : {}), route: c.route }).finally(() => setBusy(false));
  };
  return (
    <button type="button" className="bx-btn s dv-chat" disabled={busy} onClick={open} title="Apri una chat di lavoro su questo record"
      data-testid={`devops-chat-${rec.kind}-${idOf(rec)}`}>
      {busy ? 'Apro…' : 'Apri chat'}
    </button>
  );
}
