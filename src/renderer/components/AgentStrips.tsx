// The agents' strips in the Grindhouse (brain/pages/Home.tsx; SPEC 19: the one place for agents): one column, one
// one-line strip under the other, in the Orchestrator's order (lib/agent-order.ts: grouped by area, start order inside
// a group). There is no drag and no saved order (SPEC 10-11): the user opens a strip in place or in full screen (F11,
// FullScreen.tsx), the Orchestrator decides where it goes. A chat's browser tabs are inside its own window
// (ChatTile.tsx, ADR 0287), never rows of their own; a browser without a strip is. Delegated chats (ADR 0083) sit under
// the chat that delegated them (lib/chat-tree.ts), each a thread card on a curved thread line that opens in place into
// its chat (DelegationCard.tsx); a parent's KidsBar folds and unfolds its children (the fold is kept across restarts);
// a root chat the app started or resumed by itself says so above it (Origin, ADR 0102).
import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { tileKey, type TileRef } from '../lib/grid';
import { areaOf } from '../lib/agent-order';
import { childState, visibleTree, type TreeNode } from '../lib/chat-tree';
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
import { DelegationCard, KidsBar, TreeRails } from './DelegationCard';
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
  const collapsed = ui.use(s => s.prefs.treeCollapsed);
  const tiles = useApp(s => stripTiles(s.order, s.chats, s.tabs), equalTiles);
  const nodes = new Map<string, TreeNode>(tree.map(n => [n.id, n]));
  const inTree = new Set(visibleTree(tree, collapsed).map(n => n.id));
  const owners = useApp(s => tabOwners(s.tabs), sameRecord);
  const areas = useApp(s => tiles.map(t => t.kind === 'chat' ? areaOf(s.chats[t.id] ?? { cwd: '' }) : ''), sameList);
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
  let lastArea: string | null = null;
  // native browser views follow their strip when strips open, close or change
  useLayoutEffect(() => { schedule(); }, [shown.map(tileKey).join('|'), expansion]);

  const pane = (tile: TileRef) => {
    const key = tileKey(tile);
    const closed = tile.kind === 'chat' && expansion[tile.id] !== true;
    return <div className={`agent-pane${closed ? ' strip-pane' : ''}${tile.kind === 'browser' ? ' browser-pane' : ''}`} data-workspace-pane={key} key={key}>
      <div className="agent-pane-content">{tile.kind === 'chat' ? <ChatTile chatId={tile.id} index={chatIndices.get(key)} /> : <BrowserTile tabId={tile.id} />}</div>
    </div>;
  };
  // no strip: the morning block for a user with history, the first-run text otherwise (ADR 0102)
  if (!shown.length) return <GrindhouseEmpty />;
  return <div className="agent-strips" data-testid="view-agents">
    <div className="workspace-column">
      {shown.map((lead, i) => {
        const key = tileKey(lead), area = areas[tiles.indexOf(lead)] ?? '';
        const node = lead.kind === 'chat' ? nodes.get(lead.id) : undefined, depth = node?.depth ?? 0;
        const firstOfArea = lead.kind === 'chat' && depth === 0 && area !== lastArea;
        if (lead.kind === 'chat' && depth === 0) lastArea = area;
        // a delegated chat is its thread card (opened in place into its chat)
        const card = lead.kind === 'chat' && depth > 0;
        const owned = lead.kind === 'browser' && !!owners[lead.id];
        // the strips enter in turn (agent-strips.css, off under reduced motion)
        return <div className={`agent-pane-wrap${owned ? ' owned-pane' : ''}${depth ? ' tree-child' : ''}${node?.children.length ? ' tree-parent' : ''}`} key={key} data-depth={depth || undefined} style={{ '--row-index': Math.min(i, 8), '--depth': depth } as CSSProperties}
          ref={lead.kind === 'chat' ? leaveRef(lead.id) : undefined}>
          {firstOfArea && <h3 className="workspace-area">{area || tr('product.noArea')}</h3>}
          {card && node && <ChildRails node={node} />}
          {lead.kind === 'chat' && depth === 0 && <Origin chatId={lead.id} />}
          {card ? <DelegationCard chatId={lead.id} /> : pane(lead)}
          {/* Child activity remains visible when its parent is closed or open. */}
          {lead.kind === 'chat' && <ChildStrips chatId={lead.id} />}
          {node && node.children.length > 0 && <KidsBar chatId={lead.id} />}
        </div>;
      })}
    </div>
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

/** A delegated card's thread lines, tinted by its state. */
function ChildRails({ node }: { node: TreeNode }) {
  const state = useApp(s => { const c = s.chats[node.id]; return c ? childState(c) : 'closed'; });
  return <TreeRails node={node} state={state} />;
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
