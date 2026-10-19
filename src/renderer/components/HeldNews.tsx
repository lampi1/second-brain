// "N novità in attesa" (#88): on the Orchestrator's tile, in the place of the old "Novità" feed (the user, 2026-10-19:
// the feed was not useful there; the live feed stays in the bell, NotificationCenter), the news the app holds back for
// this Orchestrator by the delivery rule (main/chats/orchestrator-delivery.ts): a work chat that finished, failed, asks a
// question or a permission, left a command, or mail to it, not delivered yet because the Orchestrator waits for the
// user, groups news for a few seconds, or lets quiet news ride along with the next delivery. Hidden when nothing waits;
// hover names the first ones, a click lists them all (chat, kind, since when, why it waits) and a row opens its chat.
// Reading it spends nothing: main sends the list ('orchestrator:held', 'orchestrator:heldChanged', main/chats/held-news.ts).
// Used by OrchestratorTile.tsx.
import { useEffect, useState } from 'react';
import type { HeldNewsItem, HeldNewsKind, HeldNewsState, HeldNewsWhy } from '@shared/contract';
import { ago } from '../lib/format';
import { useNow } from '../lib/clock';
import { t, type TextKey } from '../i18n';
import { IconChevronDown } from './Icons';

const EMPTY: HeldNewsState = { items: [] };

/** The list main holds now, then each change. */
export function useHeldNews(): HeldNewsState {
  const [state, setState] = useState<HeldNewsState>(EMPTY);
  useEffect(() => {
    let alive = true;
    let off = () => {};
    try {
      window.sb.invoke('orchestrator:held', undefined).then(s => { if (alive) setState(s); }, () => {});
      off = window.sb.on('orchestrator:heldChanged', s => { if (alive) setState(s); });
    } catch { /* no bridge (tests) */ }
    return () => { alive = false; off(); };
  }, []);
  return state;
}

const TONE: Record<HeldNewsKind, string> = { done: 'green', error: 'red', question: 'amber', permission: 'amber', command: 'amber', started: 'blue', mail: 'violet' };

const KIND: Record<HeldNewsKind, TextKey> = {
  done: 'dialogs.orchestrator.heldKind.done', error: 'dialogs.orchestrator.heldKind.error', question: 'dialogs.orchestrator.heldKind.question',
  permission: 'dialogs.orchestrator.heldKind.permission', command: 'dialogs.orchestrator.heldKind.command', started: 'dialogs.orchestrator.heldKind.started', mail: 'dialogs.orchestrator.heldKind.mail',
};
const WHY: Record<HeldNewsWhy, TextKey> = { user: 'dialogs.orchestrator.heldWhy.user', busy: 'dialogs.orchestrator.heldWhy.busy', group: 'dialogs.orchestrator.heldWhy.group', quiet: 'dialogs.orchestrator.heldWhy.quiet' };

const since = (at: number, now: number): string => { const a = ago(at, now); return a === 'ora' ? t('dialogs.orchestrator.heldNow') : t('dialogs.orchestrator.heldSince', { ago: a }); };
const kindText = (k: HeldNewsKind): string => t(KIND[k]);

/** One line for the tooltip: the first three, then "+N". */
export function heldSummary(items: readonly HeldNewsItem[]): string {
  const head = items.slice(0, 3).map(i => `${i.title}: ${kindText(i.kind)}`);
  return [...head, ...(items.length > 3 ? [`+${items.length - 3}`] : [])].join(' · ');
}

/** The bar and its list, from what it is given (HeldNews below; server-rendered by its unit test). */
export function HeldNewsView({ items, open, now, onToggle, onOpenChat }: { items: readonly HeldNewsItem[]; open: boolean; now: number; onToggle: () => void; onOpenChat: (chatId: string) => void }) {
  if (!items.length) return null;
  return (
    <div className={`held ${open ? 'open' : ''}`} data-testid="orchestrator-held" data-count={items.length}>
      <button type="button" className="held-head" onClick={onToggle} aria-expanded={open} data-testid="orchestrator-held-toggle" data-tip={heldSummary(items)}>
        <span className="held-dot" aria-hidden="true" />
        <span className="held-count" data-testid="orchestrator-held-count">{t('dialogs.orchestrator.heldCount', { count: items.length })}</span>
        <span className="sp" />
        <IconChevronDown size={13} className="held-chev" />
      </button>
      {open && (
        <ul className="held-list" data-testid="orchestrator-held-list">
          {items.map((i, n) => (
            <li key={`${n}:${i.kind}:${i.chatId ?? i.title}:${i.at}`}>
              <button type="button" className={`held-row tone-${TONE[i.kind]}`} disabled={!i.chatId} onClick={() => { if (i.chatId) onOpenChat(i.chatId); }}
                data-testid={`orchestrator-held-${i.kind}`} data-chat={i.chatId ?? undefined}>
                <span className="held-k">{kindText(i.kind)}</span>
                <span className="held-t">{i.title}</span>
                <span className="held-age">{since(i.at, now)}</span>
                <span className="held-why">{t(WHY[i.why])}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** onOpenChat: the caller opens a chat (OrchestratorTile: openLink), so this file stays free of the app's actions */
export function HeldNews({ orchestratorId, onOpenChat }: { orchestratorId: string; onOpenChat: (chatId: string) => void }) {
  const all = useHeldNews();
  const items = all.items.filter(i => i.orchestratorId === orchestratorId);
  const [open, setOpen] = useState(false);
  const now = useNow(15_000);
  useEffect(() => { if (!items.length) setOpen(false); }, [items.length]);
  return <HeldNewsView items={items} open={open} now={now} onToggle={() => setOpen(o => !o)} onOpenChat={onOpenChat} />;
}
