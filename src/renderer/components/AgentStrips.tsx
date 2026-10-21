// The agents' strips in the Grindhouse (brain/pages/Home.tsx; SPEC 19: the one place for agents): one column, one
// strip under the other, in the Orchestrator's order (lib/agent-order.ts: grouped by area, start order inside a
// group); each browser tab sits right under the chat that drives it. There is no drag and no saved order (SPEC 10-11):
// the user expands, maximizes or opens a strip in focus mode, the Orchestrator decides where it goes. Delegated chats
// (ADR 0083) sit under the chat that delegated them (lib/chat-tree.ts), each a thread card on a curved thread line
// that expands in place into its chat (DelegationCard.tsx); a parent's KidsBar folds and unfolds its children (the fold
// is kept across restarts); a root chat the Orchestrator started, or the app started or resumed by itself, says so above
// it (Origin, ADR 0102).
import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';
import { workspaceTiles, tileKey, type TileRef } from '../lib/grid';
import { areaOf } from '../lib/agent-order';
import { chatTree, childState, visibleTree, type TreeNode } from '../lib/chat-tree';
import { schedule } from '../lib/viewports';
import { useApp } from '../store/store';
import { sameList } from '../store/state';
import { useHandoffTabs } from '../store/handoffs';
import { setPrefs, ui } from '../store/ui';
import { t as tr } from '../i18n';
import { ChatTile } from './ChatTile';
import { BrowserTile } from './BrowserTile';
import { ChildStrips } from './ChildStrips';
import { DelegationCard, KidsBar, TreeRails } from './DelegationCard';
import { AgentAvatar } from './AgentAvatar';
import { go, toggleMaximize } from '../actions';
import { originOf } from '../lib/chat-origin';
import { GrindhouseEmpty } from './MorningBlock';
import '../styles/alive.css';
import { pairOf, pairStyle } from '../lib/pairs';
import { useCloudIds } from '../store/cloud';
import '../styles/agent-strips.css';

/** Below this column width a chat and its browser stack instead of sitting side by side. */
const NARROW_PX = 640;

const equalTiles = (a: TileRef[], b: TileRef[]) => sameList(a.map(tileKey), b.map(tileKey));

/** The one control above the strips: back from a maximized strip. */
export function AgentStripsActions() {
  const maximized = ui.use(s => s.maximized);
  if (!maximized || maximized === 'orchestrator') return null;
  return <div className="agent-strips-actions"><button type="button" className="btn btn-ghost btn-s" onClick={() => toggleMaximize(maximized)}>{tr('product.restoreLayout')}</button></div>;
}

export function AgentStrips() {
  const ready = useApp(s => s.ready);
  const panelsVersion = ui.use(s => s.prefs.chatPanelsV);
  const expansion = ui.use(s => s.prefs.chatExpanded);
  const browserOpen = ui.use(s => s.prefs.browserOpen);
  const hidden = ui.use(s => s.hidden, sameList), hiddenTabs = ui.use(s => s.hiddenTabs, sameList);
  const tree = useApp(s => chatTree(s.order, s.chats), (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const collapsed = ui.use(s => s.prefs.treeCollapsed);
  const tiles = useApp(s => workspaceTiles(chatTree(s.order, s.chats).map(n => n.id), s.chats, s.tabs), equalTiles);
  const nodes = new Map<string, TreeNode>(tree.map(n => [n.id, n]));
  const inTree = new Set(visibleTree(tree, collapsed).map(n => n.id));
  const owners = useApp(s => Object.fromEntries(s.tabs.filter(t => t.ownerChatId).map(t => [t.id, t.ownerChatId!])), (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const areas = useApp(s => tiles.map(t => t.kind === 'chat' ? areaOf(s.chats[t.id] ?? { cwd: '' }) : ''), sameList);
  const pairs = useApp(s => tiles.map(t => t.kind === 'browser' ? pairOf(s, s.tabs.find(tab => tab.id === t.id)?.ownerChatId) : null), sameList);
  const maximized = ui.use(s => s.maximized);
  const keep = useHandoffTabs();
  const clouds = useCloudIds().length; // cloud agents' strips follow (CloudStrips.tsx, ADR 0080): not an empty Grindhouse
  const [column, setColumn] = useState<HTMLDivElement | null>(null); // a state, not a ref: the column mounts after hydration
  // every strip starts collapsed (Brother, 18/10: the strips are the Grindhouse); prefs with another chatPanelsV start collapsed too
  useEffect(() => { if (ready && panelsVersion !== 2) setPrefs({ chatPanelsV: 2, chatExpanded: {} }); }, [ready, panelsVersion]);
  // a browser shows beside its chat while that strip is expanded AND the user opened its browsers with the strip's globe
  // button (owner, 18/10: collapsed by default, the strip only hints at it); one waiting for the user (a login hand-off)
  // or maximized always shows. Only a browser whose chat has a strip folds (the Orchestrator's own and orphan tabs have
  // no strip to open).
  const strips = new Set(tiles.filter(t => t.kind === 'chat').map(t => t.id));
  const folded = (t: TileRef) => strips.has(owners[t.id] ?? '') && !(expansion[owners[t.id]!] === true && browserOpen[owners[t.id]!] === true) && !keep.includes(t.id) && maximized !== tileKey(t);
  const isVisible = (t: TileRef) => t.kind === 'chat' ? !hidden.includes(t.id) && inTree.has(t.id) : !hiddenTabs.includes(t.id) && !hidden.includes(owners[t.id] ?? '') && (!owners[t.id] || !nodes.has(owners[t.id]!) || inTree.has(owners[t.id]!)) && !folded(t);
  const visible = tiles.filter(isVisible);
  const max = maximized ? visible.find(t => tileKey(t) === maximized) ?? null : null;
  const shown = max ? [max] : visible;
  const chatIndices = new Map(visible.filter(t => t.kind === 'chat').map((t, index) => [tileKey(t), index + 1]));
  // an expanded strip holds its own browsers beside its chat (Brother, 18/10: chat left, browser right, both in view;
  // «deve essere chiaro la strisciolina proprietaria di quel browser»); a browser shown under a collapsed strip (a login
  // hand-off) hangs under it on the strip's accent
  const rows: { lead: TileRef; side: TileRef[] }[] = [];
  for (const t of shown) {
    const last = rows[rows.length - 1];
    if (!max && t.kind === 'browser' && last?.lead.kind === 'chat' && owners[t.id] === last.lead.id && expansion[last.lead.id] === true) last.side.push(t);
    else rows.push({ lead: t, side: [] });
  }
  const narrow = useNarrow(column);
  let lastArea: string | null = null;
  // native browser views follow their strip when strips expand, collapse or change
  useLayoutEffect(() => { schedule(); }, [shown.map(tileKey).join('|'), expansion, browserOpen, narrow]);

  const pane = (tile: TileRef) => {
    const key = tileKey(tile);
    const compact = tile.kind === 'chat' && expansion[tile.id] !== true && !max;
    return <div className={`agent-pane${compact ? ' strip-pane' : ''}${tile.kind === 'browser' ? ' browser-pane' : ''}`} data-workspace-pane={key} key={key}>
      <div className="agent-pane-content">{tile.kind === 'chat' ? <ChatTile chatId={tile.id} index={chatIndices.get(key)} maximized={!!max} /> : <BrowserTile tabId={tile.id} maximized={!!max} />}</div>
    </div>;
  };
  // no strip: the morning block and the Battito's board for a user with history, the first-run text otherwise (ADR 0102)
  if (!shown.length) return clouds ? null : <GrindhouseEmpty />;
  return <div className={`agent-strips${narrow ? ' is-narrow' : ''}`} data-testid="view-agents" ref={setColumn}>
    <div className={`workspace-column${max ? ' workspace-max' : ''}`} {...(max ? { 'data-testid': 'maximized', 'data-key': tileKey(max) } : {})}>
      {rows.map(({ lead, side }, i) => {
        const key = tileKey(lead), area = areas[tiles.indexOf(lead)] ?? '';
        const node = lead.kind === 'chat' ? nodes.get(lead.id) : undefined, depth = max ? 0 : node?.depth ?? 0;
        const firstOfArea = !max && lead.kind === 'chat' && depth === 0 && area !== lastArea;
        if (lead.kind === 'chat' && depth === 0) lastArea = area;
        // a delegated chat is its thread card (expanded in place into its chat), the full strip only maximized
        const card = !max && lead.kind === 'chat' && depth > 0;
        const accent = side.length ? pairs[tiles.indexOf(side[0]!)] ?? null : lead.kind === 'browser' && !max && owners[lead.id] ? pairs[tiles.indexOf(lead)] ?? null : null;
        const owned = lead.kind === 'browser' && !max && !!owners[lead.id];
        // the strips enter in turn (agent-strips.css, off under reduced motion)
        return <div className={`agent-pane-wrap${owned ? ' owned-pane' : ''}${depth ? ' tree-child' : ''}${!max && node?.children.length ? ' tree-parent' : ''}`} key={key} data-depth={depth || undefined} style={{ '--row-index': Math.min(i, 8), '--depth': depth, ...(accent !== null ? pairStyle(accent) : {}) } as CSSProperties}>
          {firstOfArea && <h3 className="workspace-area">{area || tr('product.noArea')}</h3>}
          {/* a chat keeps the same parent with or without its browsers beside it: expanding never remounts it */}
          {card && node && <ChildRails node={node} />}
          {!max && lead.kind === 'chat' && depth === 0 && <Origin chatId={lead.id} />}
          {card ? (side.length ? <div className="strip-pair" data-testid={`strip-pair-${lead.id}`}><DelegationCard chatId={lead.id} /><div className="strip-pair-side">{side.map(pane)}</div></div> : <DelegationCard chatId={lead.id} />) : lead.kind === 'chat'
            ? <div className={side.length ? 'strip-pair' : 'strip-solo'} {...(side.length ? { 'data-testid': `strip-pair-${lead.id}` } : {})}>{pane(lead)}{side.length > 0 && <div className="strip-pair-side">{side.map(pane)}</div>}</div>
            : pane(lead)}
          {/* Child activity remains visible when its parent is collapsed, expanded or maximized. */}
          {lead.kind === 'chat' && <ChildStrips chatId={lead.id} />}
          {!max && node && node.children.length > 0 && <KidsBar chatId={lead.id} />}
        </div>;
      })}
    </div>
  </div>;
}

/** A delegated card's thread lines, tinted by its state. */
function ChildRails({ node }: { node: TreeNode }) {
  const state = useApp(s => { const c = s.chats[node.id]; return c ? childState(c) : 'closed'; });
  return <TreeRails node={node} state={state} />;
}

/** Who started a root chat, above it: "Orchestrator ha avviato questa chat · 09:12"; a chat the app started by itself
 *  ("Avviata dall'app · revisione a campione · 2 di 3 oggi", the Judge's sampled reviews, agents/judge-sample.ts) or
 *  resumed after a restart ("Ripresa dall'app dopo il riavvio · 09:12") says so too (ADR 0102): a strip never appears
 *  from nowhere. */
function Origin({ chatId }: { chatId: string }) {
  const o = useApp(s => originOf(s.chats[chatId], Object.values(s.chats)), (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const judgeDaily = useApp(s => s.settings?.delegation?.judgeDaily ?? 3);
  const avatar = useApp(s => Object.values(s.chats).find(c => c?.isOrchestrator)?.agent?.avatar);
  if (!o) return null;
  const time = (at: number) => new Date(at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  if (o.kind === 'orchestrator') return <div className="tree-origin" data-testid={`tree-origin-${chatId}`} data-origin="orchestrator">
    <AgentAvatar avatar={avatar} name="Orchestrator" size={18} />
    <span><b>Orchestrator</b> {tr('tree.origin', { time: time(o.at) })}</span>
  </div>;
  if (o.kind === 'resumed') return <div className="tree-origin is-app" data-testid={`tree-origin-${chatId}`} data-origin="resumed"><span>{tr('alive.origin.resumed', { time: time(o.at) })}</span></div>;
  return <div className="tree-origin is-app" data-testid={`tree-origin-${chatId}`} data-origin="app">
    <span><b>{tr('alive.origin.app')}</b>{o.review ? <> · {tr('alive.origin.review')} ({tr('alive.origin.reviewOf', { n: o.review, of: Math.max(o.review, judgeDaily) })})</> : null} · {time(o.at)}</span>
    {o.review ? <button type="button" className="link-btn" onClick={() => go({ page: 'impostazioni' })} data-testid={`tree-origin-settings-${chatId}`}>{tr('alive.origin.settings')}</button> : null}
  </div>;
}

/** True while the strips' column is too narrow for a chat and its browser side by side (they stack then). */
function useNarrow(node: HTMLDivElement | null): boolean {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setNarrow((entry?.contentRect.width ?? 0) < NARROW_PX));
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return narrow;
}
