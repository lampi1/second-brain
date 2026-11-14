// The Grindhouse as a workshop (ADR 0311; it replaces the one column of strips of ADR 0287 and 0292): every root chat is
// a square bench in a grid, in the Orchestrator's order (lib/agent-order.ts: grouped by area, start order inside a group),
// its role's person big on a stage and a plate under it (ChatTile.tsx closed); the chats it delegated stand at its
// bench as helpers, one row each on the plate (BenchKids.tsx), and the bench takes two columns. A click on a bench opens
// its chat in place of the workshop: only that chat, its views (Chat · Affiancati · Browser, ADR 0287) in its head,
// and above it the team as tabs (the chat that delegated and every chat under it) with «← Grindhouse» to go back; a
// delegated chat opens as its card (DelegationCard.tsx). The Orchestrator stays beside it. There is no drag and no saved
// order (SPEC 10-11); F11 still takes a chat to full screen (FullScreen.tsx). A browser without a strip is a row of its
// own across the grid; a root chat the app started or resumed by itself says so above its bench (Origin, ADR 0102).
import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { tileKey, type TileRef } from '../lib/grid';
import { type TreeNode } from '../lib/chat-tree';
import { originFor, sameOrigin, sameTree, stripTiles, stripTree, tabOwners } from '../lib/chat-derived';
import { sameRecord } from '../lib/memo';
import { schedule } from '../lib/viewports';
import { app, useApp } from '../store/store';
import { leaveGhost } from '../lib/leave-ghost';
import { sameList } from '../store/state';
import { useHandoffTabs } from '../store/handoffs';
import { setPrefs, ui } from '../store/ui';
import { t as tr, locale } from '../i18n';
import { ChatTile } from './ChatTile';
import { BrowserTile } from './BrowserTile';
import { ChildStrips } from './ChildStrips';
import { DelegationCard } from './DelegationCard';
import { AgentAvatar } from './AgentAvatar';
import { IconArrowLeft } from './Icons';
import { childState } from '../lib/chat-tree';
import { kidTone } from './BenchKids';
import { setChatExpanded } from '../store/ui';
import { go } from '../actions';
import { GrindhouseEmpty } from './MorningBlock';
import '../styles/alive.css';
import '../styles/agent-strips.css';

const equalTiles = (a: TileRef[], b: TileRef[]) => a === b || sameList(a.map(tileKey), b.map(tileKey));

export function AgentStrips() {
  const ready = useApp(s => s.ready);
  const panelsVersion = ui.use(s => s.prefs.chatPanelsV);
  const expansion = ui.use(s => s.prefs.chatExpanded);
  const hidden = ui.use(s => s.hidden, sameList), hiddenTabs = ui.use(s => s.hiddenTabs, sameList);
  // derived once per chats object for every subscriber (lib/chat-derived.ts), compared without JSON.stringify
  const tree = useApp(s => stripTree(s.order, s.chats), sameTree);
  const tiles = useApp(s => stripTiles(s.order, s.chats, s.tabs), equalTiles);
  const nodes = new Map<string, TreeNode>(tree.map(n => [n.id, n]));
  const inTree = new Set(tree.map(n => n.id));
  const opened = ui.use(s => s.opened);
  const owners = useApp(s => tabOwners(s.tabs), sameRecord);
  const keep = useHandoffTabs();
  const leaveRef = useLeaveRef();
  // every strip starts closed (Brother, 18/10: the strips are the Grindhouse); prefs with another chatPanelsV start closed too
  useEffect(() => { if (ready && panelsVersion !== 2) setPrefs({ chatPanelsV: 2, chatExpanded: {} }); }, [ready, panelsVersion]);
  // a chat's browsers live inside its own window (ChatTile.tsx, ADR 0287), so they are no rows here; the one exception
  // is a tab waiting for the user (a login hand-off) under a CLOSED strip, which hangs under it. A browser without a
  // strip (the user's own, the Orchestrator's) is a row of its own.
  const strips = new Set(tiles.filter(t => t.kind === 'chat').map(t => t.id));
  const folded = (t: TileRef) => strips.has(owners[t.id] ?? '') && !(keep.includes(t.id) && expansion[owners[t.id]!] !== true);
  const isVisible = (t: TileRef) => t.kind === 'chat' ? !hidden.includes(t.id) && inTree.has(t.id) : !hiddenTabs.includes(t.id) && !hidden.includes(owners[t.id] ?? '') && (!owners[t.id] || !nodes.has(owners[t.id]!) || inTree.has(owners[t.id]!)) && !folded(t);
  const shown = tiles.filter(isVisible);
  const chatIndices = new Map(shown.filter(t => t.kind === 'chat').map((t, index) => [tileKey(t), index + 1]));
  // native browser views follow their strip when strips open, close or change
  useLayoutEffect(() => { schedule(); }, [shown.map(tileKey).join('|'), expansion]);

  const pane = (tile: TileRef) => {
    const key = tileKey(tile);
    const closed = tile.kind === 'chat' && expansion[tile.id] !== true;
    return <div className={`agent-pane${closed ? ' strip-pane' : ''}${tile.kind === 'browser' ? ' browser-pane' : ''}`} data-workspace-pane={key} key={key}>
      <div className="agent-pane-content">{tile.kind === 'chat' ? <ChatTile chatId={tile.id} index={chatIndices.get(key)} /> : <BrowserTile tabId={tile.id} />}</div>
    </div>;
  };
  const openRef = useRef<HTMLDivElement>(null);
  const shownOpen = shown.some(t => t.kind === 'chat' && expansion[t.id] === true);
  useLayoutEffect(() => { if (shownOpen) openRef.current?.scrollIntoView({ block: 'start' }); }, [shownOpen, opened]);
  // no strip: the morning block for a user with history, the first-run text otherwise (ADR 0102)
  if (!shown.length) return <GrindhouseEmpty />;
  // the chat on screen: the one opened last, else any open one (one at a time; the others stay as they were)
  const open = shown.filter(t => t.kind === 'chat' && expansion[t.id] === true).map(t => t.id);
  const openId = opened && open.includes(opened) ? opened : open[0];
  if (openId) {
    // the open chat starts at the top of the page, its head and its team in sight
    let root = openId;
    while (nodes.get(root)?.parentId && nodes.has(nodes.get(root)!.parentId!)) root = nodes.get(root)!.parentId!;
    const team = tree.filter(n => n.id === root || isUnder(n, root, nodes)).map(n => n.id);
    const lead = shown.find(t => t.kind === 'chat' && t.id === openId)!;
    const depth = nodes.get(openId)?.depth ?? 0;
    // back to the workshop: every open chat of the team folds (their drafts and transcripts stay mounted elsewhere)
    const back = () => { for (const id of new Set([...team, ...open])) if (expansion[id] === true) setChatExpanded(id, false); };
    return <div ref={openRef} className="agent-strips bench-open" data-testid="view-agents" data-open={openId}>
      <TeamTabs team={team} openId={openId} onBack={back} />
      <ChildStrips chatId={openId} />
      <div className="bench-open-chat">{depth > 0 ? <DelegationCard chatId={openId} /> : pane(lead)}</div>
    </div>;
  }
  return <div className="agent-strips" data-testid="view-agents">
    <div className="workspace-column bench-grid">
      {shown.map((lead, i) => {
        const key = tileKey(lead);
        const node = lead.kind === 'chat' ? nodes.get(lead.id) : undefined, depth = node?.depth ?? 0;
        // a delegated chat stands at its parent's bench (BenchKids.tsx), never a bench of its own
        if (depth > 0) return null;
        const owned = lead.kind === 'browser' && !!owners[lead.id];
        const kids = node?.children.length ?? 0;
        // the benches enter in turn (agent-strips.css, off under reduced motion)
        return <div className={`agent-pane-wrap${owned ? ' owned-pane' : ''}${lead.kind === 'browser' ? ' bench-row' : ''}${kids ? ' bench-wide tree-parent' : ''}`} key={key} style={{ '--row-index': Math.min(i, 8) } as CSSProperties}
          ref={lead.kind === 'chat' ? leaveRef(lead.id) : undefined}>
          {lead.kind === 'chat' && <Origin chatId={lead.id} />}
          {pane(lead)}
        </div>;
      })}
    </div>
  </div>;
}

/** Whether a node sits anywhere under `root`. */
function isUnder(n: TreeNode, root: string, nodes: ReadonlyMap<string, TreeNode>): boolean {
  for (let p = n.parentId; p; p = nodes.get(p)?.parentId ?? null) if (p === root) return true;
  return false;
}

/** The open chat's bar: back to the workshop, then the team as tabs (only when there is a team): the chat that delegated
 *  and every chat under it, each with its state dot, its face, its name and what it does now. */
function TeamTabs({ team, openId, onBack }: { team: readonly string[]; openId: string; onBack: () => void }) {
  const chats = useApp(s => team.map(id => s.chats[id]), sameList);
  return <div className="bench-bar">
    <button type="button" className="bench-back" onClick={onBack} data-testid="bench-back"><IconArrowLeft size={13} />{tr('product.benchBack')}</button>
    {team.length > 1 && <div className="bench-tabs" role="tablist" aria-label={tr('product.benchTeam')}>
      {chats.map((c, i) => {
        if (!c) return null;
        const name = c.agent?.name || c.title, tone = i === 0 ? (c.state === 'waiting' ? 'wait' : c.state === 'error' ? 'err' : c.state === 'running' ? 'run' : 'off') : kidTone(childState(c));
        return <button key={c.id} type="button" role="tab" aria-selected={c.id === openId} className={`bench-tab${c.id === openId ? ' on' : ''}`} data-testid={`bench-tab-${c.id}`} onClick={() => setChatExpanded(c.id, true)}>
          <span className={`bench-dot tone-${tone}`} aria-hidden="true" /><AgentAvatar avatar={c.agent?.avatar} name={name} size={16} /><b>{name}</b>{c.id === openId && <span>{i === 0 ? c.title : c.delegation?.goal || c.title}</span>}
        </button>;
      })}
    </div>}
  </div>;
}

/** One stable ref per chat row: when the row leaves because the app closed its chat by itself, a copy of it fades and
 *  folds in its place (lib/leave-ghost.ts) instead of the rows under it jumping up. A row folded away under its parent,
 *  or a chat the user closed, just goes. */
function useLeaveRef(): (chatId: string) => (el: HTMLDivElement | null) => () => void {
  const refs = useRef(new Map<string, (el: HTMLDivElement | null) => () => void>());
  return chatId => {
    let ref = refs.current.get(chatId);
    if (!ref) {
      ref = el => () => {
        const c = app.get().chats[chatId];
        if (!c?.closedAt) return; // folded away or remounted (StrictMode): the same ref serves it again
        refs.current.delete(chatId);
        if (el && c.closedBy === 'auto') leaveGhost(el);
      };
      refs.current.set(chatId, ref);
    }
    return ref;
  };
}

/** Who started a root chat, above it, only when it was not the Orchestrator (every chat is, so that line said nothing; the
 *  owner, 2026-10-22): a chat the app started by itself
 *  ("Avviata dall'app · revisione indipendente", the Sentinel's automatic reviews, agents/judge-sample.ts) or
 *  resumed after a restart ("Ripresa dall'app dopo il riavvio · 09:12") says so too (ADR 0102): a strip never appears
 *  from nowhere. */
function Origin({ chatId }: { chatId: string }) {
  const o = useApp(s => originFor(s.chats, chatId), sameOrigin);
  if (!o || o.kind === 'orchestrator') return null;
  const time = (at: number) => new Date(at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  if (o.kind === 'resumed') return <div className="tree-origin is-app" data-testid={`tree-origin-${chatId}`} data-origin="resumed"><span>{tr('alive.origin.resumed', { time: time(o.at) })}</span></div>;
  return <div className="tree-origin is-app" data-testid={`tree-origin-${chatId}`} data-origin="app">
    <span><b>{tr('alive.origin.app')}</b>{o.review ? <> · {tr('alive.origin.review')}</> : null} · {time(o.at)}</span>
    {o.review ? <button type="button" className="link-btn" onClick={() => go({ page: 'agenti' })} data-testid={`tree-origin-settings-${chatId}`}>{tr('alive.origin.settings')}</button> : null}
  </div>;
}
