// The notification center: a side panel openable from anywhere (bell in the top bar, Ctrl+Shift+N). Every feed event,
// newest first, filterable by kind, unread marked (remembered), "Segna tutto letto", do-not-disturb (1 h / until
// tomorrow / off) and mute per kind; each item leads to its exact place (page + element highlighted). It hides the
// browser views it covers (registered as an overlay). Used by App.tsx.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FeedEvent } from '@shared/contract';
import { ago } from '../lib/format';
import { useNow } from '../lib/clock';
import { isUnread, linkOfEvent, markAllRead, markRead, tierOf } from '../lib/notify';
import { registerOverlay } from '../lib/viewports';
import { dndUntil, muteKind, setDnd, useApp } from '../store/store';
import { setCenter, setRead, ui } from '../store/ui';
import { copyLink, openLink } from '../actions';
import { IconBell, IconCheck, IconLink, IconMoon, IconX } from './Icons';
import { Keys } from './ui';

const TONE: Record<string, string> = {
  idea: 'blue', error: 'red', win: 'green', 'chat-done': 'green', 'chat-waiting': 'amber', reflection: 'violet', budget: 'amber', login: 'amber',
  'sync-error': 'red', 'sync-blocked': 'red', 'mail-blocked': 'red',
};

function Row({ e, unread, now }: { e: FeedEvent; unread: boolean; now: number }) {
  const muted = useApp(s => !!s.settings?.mute?.[e.kind]);
  const open = () => { setRead(r => markRead(r, [e.id])); setCenter(false); openLink(linkOfEvent(e)); };
  return (
    <li className={`nc-item ${unread ? 'unread' : ''}`} data-testid={`nc-item-${e.id}`} data-kind={e.kind} data-unread={unread || undefined}>
      <button type="button" className="nc-main" onClick={open} data-testid={`nc-open-${e.id}`}>
        <span className={`nc-kind tone-${TONE[e.kind] ?? 'dim'}`}>{e.label}</span>
        <span className="nc-text"><b>{e.title}</b>{e.detail && <span>{e.detail}</span>}</span>
        <span className="nc-age">{e.away ? 'mentre eri via' : ago(e.at, now)}</span>
      </button>
      <span className="nc-tools">
        <button type="button" className="icon-btn" onClick={() => void copyLink(linkOfEvent(e))} aria-label="Copia link" data-tip="Copia link" data-testid={`nc-link-${e.id}`}><IconLink size={13} /></button>
        <button type="button" className="icon-btn" onClick={() => void muteKind(e.kind, e.label, !muted)} aria-label={muted ? `Riattiva «${e.label}»` : `Silenzia «${e.label}»`}
          data-tip={muted ? 'Riattiva gli avvisi di questo tipo' : tierOf(e.kind) === 'toast' ? 'Silenzia gli avvisi di questo tipo' : 'Silenzia questo tipo'} data-testid={`nc-mute-${e.id}`}>
          <IconBell size={13} style={{ opacity: muted ? 0.4 : 1 }} />
        </button>
      </span>
    </li>
  );
}

export function NotificationCenter() {
  const now = useNow(30_000);
  const feed = useApp(s => s.feed);
  const read = ui.use(s => s.read);
  const dnd = useApp(s => !!s.settings && (s.settings.dnd || (!!s.settings.dndUntil && s.settings.dndUntil > now)));
  const [kind, setKind] = useState<string>('all');
  const [dndMenu, setDndMenu] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => (ref.current ? registerOverlay(ref.current) : undefined), []);
  const kinds = useMemo(() => {
    const m = new Map<string, { label: string; n: number }>();
    for (const e of feed) { const k = m.get(e.kind) ?? { label: e.label, n: 0 }; k.n++; m.set(e.kind, k); }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [feed]);
  const list = kind === 'all' ? feed : kind === 'unread' ? feed.filter(e => isUnread(e, read)) : feed.filter(e => e.kind === kind);
  const unread = feed.filter(e => isUnread(e, read)).length;
  const until = dndUntil();
  const tomorrow = () => { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return d.getTime(); };
  return (
    <aside ref={ref} className="center" role="dialog" aria-label="Notifiche" data-testid="center">
      <header className="nc-head">
        <h2>Notifiche</h2>
        {unread > 0 && <span className="count" data-testid="nc-unread">{unread}</span>}
        <span className="sp" />
        <button type="button" className="btn btn-ghost btn-s" onClick={() => setRead(r => markAllRead(r, now))} disabled={!unread} data-testid="nc-read-all"><IconCheck size={13} /> Segna tutto letto</button>
        <span className="nc-dnd">
          <button type="button" className={`btn btn-s ${dnd ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setDndMenu(m => !m)} aria-expanded={dndMenu} data-testid="nc-dnd"
            data-tip={dnd && until ? `Fino alle ${new Date(until).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}` : 'Nessun avviso a comparsa (restano qui)'}>
            <IconMoon size={13} /> {dnd ? 'Non disturbare' : 'Disturba'}
          </button>
          {dndMenu && (
            <span className="nc-dnd-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { void setDnd(now + 3600_000); setDndMenu(false); }} data-testid="nc-dnd-1h">Per 1 ora</button>
              <button type="button" role="menuitem" onClick={() => { void setDnd(tomorrow()); setDndMenu(false); }} data-testid="nc-dnd-tomorrow">Fino a domani</button>
              {dnd && <button type="button" role="menuitem" onClick={() => { void setDnd(null); setDndMenu(false); }} data-testid="nc-dnd-off">Disattiva</button>}
            </span>
          )}
        </span>
        <button type="button" className="icon-btn" onClick={() => setCenter(false)} aria-label="Chiudi (Esc)" data-tip="Chiudi|Esc" data-testid="nc-close"><IconX size={14} /></button>
      </header>
      <div className="nc-filters" role="tablist" aria-label="Filtra">
        <button type="button" role="tab" aria-selected={kind === 'all'} className={kind === 'all' ? 'on' : ''} onClick={() => setKind('all')} data-testid="nc-filter-all">Tutte</button>
        <button type="button" role="tab" aria-selected={kind === 'unread'} className={kind === 'unread' ? 'on' : ''} onClick={() => setKind('unread')} data-testid="nc-filter-unread">Da leggere</button>
        {kinds.map(([k, v]) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)} data-testid={`nc-filter-${k}`}>{v.label} <span className="nc-n">{v.n}</span></button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="nc-empty" data-testid="nc-empty">{kind === 'unread' ? 'Hai letto tutto.' : 'Qui arrivano le novità: chat finite, errori, idee, avvisi.'}</p>
      ) : (
        <ul className="nc-list" data-testid="nc-list">{list.slice(0, 200).map(e => <Row key={e.id} e={e} unread={isUnread(e, read)} now={now} />)}</ul>
      )}
      <footer className="nc-foot"><Keys combo="Ctrl+Shift+N" /> apre e chiude · i link si incollano in <Keys combo="Ctrl+K" /></footer>
    </aside>
  );
}
