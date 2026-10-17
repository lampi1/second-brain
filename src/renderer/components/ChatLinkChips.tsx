// The DevOps link chips in a chat tile's header: the PRs, work items, test plans, pipelines and releases the chat
// talked about (lib/devlinks.ts, found locally, no model), newest first, at most four; the rest in a small "+N" menu.
// Each chip shows the title when known (tool result or the DevOps page's cached data), else the type and the id; a
// click opens the link in the system browser, where the user is signed in to DevOps (the internal browser has no
// DevOps session: a click landed on the Microsoft sign-in; the user, 2026-10-14, as the question's context links since
// 2026-10-12). Why: "dammi il link alla PR" without asking the chat (and re-reading its whole context). Used by ChatTile.
import { memo, useMemo, useRef, useState } from 'react';
import type { ChatItem } from '@shared/contract';
import { extractDevLinks, linkKindLabel, linkLabel, type DevLink } from '../lib/devlinks';
import { useDevops } from '../store/devops';
import { useApp } from '../store/store';
import type { AppState } from '../store/state';
import { MenuItem, Popover } from './ui';

const MAX_CHIPS = 4;

// window.open: main's window-open handler hands an http(s) URL to the system browser (window.ts), never a new window
const openLink = (l: DevLink): void => { window.open(l.url, '_blank', 'noopener'); };

const tipOf = (l: DevLink) => `${linkKindLabel(l)} ${l.id}${l.title ? `: ${l.title}` : ''}\n${l.url}\nSi apre nel browser di sistema`;

export const ChatLinkChips = memo(function ChatLinkChips({ chatId }: { chatId: string }) {
  const devops = useDevops(s => s);
  const select = useMemo(() => {
    let previous: readonly ChatItem[] | undefined, links: DevLink[] = [];
    return (s: AppState) => {
      const items = s.items[chatId];
      if (items !== previous) { previous = items; links = items?.length ? extractDevLinks(items, devops) : []; }
      return links;
    };
  }, [chatId, devops]);
  // Mention timestamps affect sorting, not chip rendering; equal visual links keep the entire header asleep.
  const links = useApp(select, (a, b) => a.length === b.length && a.every((link, i) => {
    const other = b[i]!;
    return link.kind === other.kind && link.id === other.id && link.url === other.url && link.title === other.title && link.type === other.type;
  }));
  const more = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (!links.length) return null;
  const shown = links.slice(0, MAX_CHIPS);
  const rest = links.slice(MAX_CHIPS);
  return (
    <div className="th-links" data-testid={`chat-devlinks-${chatId}`} aria-label="Link DevOps della chat">
      {shown.map(l => (
        <button key={`${l.kind}:${l.id}`} type="button" className={`devlink devlink-${l.kind}${l.title ? '' : ' devlink-bare'}`} onClick={() => openLink(l)} data-tip={tipOf(l)}
          data-testid={`chat-devlink-${chatId}-${l.kind}-${l.id}`}>
          <span className="devlink-kind">{linkKindLabel(l)}</span>
          <span className="devlink-text">{l.title ?? l.id}</span>
        </button>
      ))}
      {rest.length > 0 && (<>
        <button ref={more} type="button" className="devlink devlink-more" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}
          data-tip={`Altri ${rest.length} link`} data-testid={`chat-devlinks-more-${chatId}`}>+{rest.length}</button>
        <Popover anchor={more} open={open} onClose={() => setOpen(false)} align="start" width={320} testid={`chat-devlinks-menu-${chatId}`}>
          {rest.map(l => (
            <MenuItem key={`${l.kind}:${l.id}`} onSelect={() => { openLink(l); setOpen(false); }} testid={`chat-devlink-${chatId}-${l.kind}-${l.id}`}>
              {l.title ? `${linkKindLabel(l)} · ${l.title}` : linkLabel(l)}
            </MenuItem>
          ))}
        </Popover>
      </>)}
    </div>
  );
});
