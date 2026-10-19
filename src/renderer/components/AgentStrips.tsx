// The agents' strips in the Grindhouse (brain/pages/Home.tsx; SPEC 19: the one place for agents): one column, one
// strip under the other, in the Orchestrator's order (lib/agent-order.ts: grouped by area, start order inside a
// group); each browser tab sits right under the chat that drives it. There is no drag and no saved order (SPEC 10-11):
// the user expands, maximizes or opens a strip in focus mode, the Orchestrator decides where it goes.
import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';
import { workspaceTiles, tileKey, type TileRef } from '../lib/grid';
import { agentOrder, areaOf } from '../lib/agent-order';
import { schedule } from '../lib/viewports';
import { useApp } from '../store/store';
import { sameList } from '../store/state';
import { useHandoffTabs } from '../store/handoffs';
import { setPrefs, ui } from '../store/ui';
import { t as tr } from '../i18n';
import { ChatTile } from './ChatTile';
import { BrowserTile } from './BrowserTile';
import { ChildStrips } from './ChildStrips';
import { toggleMaximize } from '../actions';
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
  const tiles = useApp(s => workspaceTiles(agentOrder(s.order, s.chats), s.chats, s.tabs), equalTiles);
  const owners = useApp(s => Object.fromEntries(s.tabs.filter(t => t.ownerChatId).map(t => [t.id, t.ownerChatId!])), (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const areas = useApp(s => tiles.map(t => t.kind === 'chat' ? areaOf(s.chats[t.id] ?? { cwd: '' }) : ''), sameList);
  const pairs = useApp(s => tiles.map(t => t.kind === 'browser' ? pairOf(s, s.tabs.find(tab => tab.id === t.id)?.ownerChatId) : null), sameList);
  const maximized = ui.use(s => s.maximized);
  const keep = useHandoffTabs();
  const clouds = useCloudIds().length; // cloud agents' strips follow (CloudStrips.tsx, ADR 0080): not an empty Grindhouse
  const [column, setColumn] = useState<HTMLDivElement | null>(null); // a state, not a ref: the column mounts after hydration
  // every strip starts collapsed (Brother, 18/10: the strips are the Grindhouse); prefs from before v2 expanded them all
  useEffect(() => { if (ready && panelsVersion !== 2) setPrefs({ chatPanelsV: 2, chatExpanded: {} }); }, [ready, panelsVersion]);
  // a browser shows beside its chat while that strip is expanded AND the user opened its browsers with the strip's globe
  // button (owner, 18/10: collapsed by default, the strip only hints at it); one waiting for the user (a login hand-off)
  // or maximized always shows. Only a browser whose chat has a strip folds (the Orchestrator's own and orphan tabs have
  // no strip to open).
  const strips = new Set(tiles.filter(t => t.kind === 'chat').map(t => t.id));
  const folded = (t: TileRef) => strips.has(owners[t.id] ?? '') && !(expansion[owners[t.id]!] === true && browserOpen[owners[t.id]!] === true) && !keep.includes(t.id) && maximized !== tileKey(t);
  const isVisible = (t: TileRef) => t.kind === 'chat' ? !hidden.includes(t.id) : !hiddenTabs.includes(t.id) && !hidden.includes(owners[t.id] ?? '') && !folded(t);
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
  if (!shown.length) return clouds ? null : <p className="home-calm" data-testid="agents-empty">{tr('home.emptyAgents')}</p>;
  return <div className={`agent-strips${narrow ? ' is-narrow' : ''}`} data-testid="view-agents" ref={setColumn}>
    <div className={`workspace-column${max ? ' workspace-max' : ''}`} {...(max ? { 'data-testid': 'maximized', 'data-key': tileKey(max) } : {})}>
      {rows.map(({ lead, side }, i) => {
        const key = tileKey(lead), area = areas[tiles.indexOf(lead)] ?? '';
        const firstOfArea = !max && lead.kind === 'chat' && area !== lastArea;
        if (lead.kind === 'chat') lastArea = area;
        const accent = side.length ? pairs[tiles.indexOf(side[0]!)] ?? null : lead.kind === 'browser' && !max && owners[lead.id] ? pairs[tiles.indexOf(lead)] ?? null : null;
        const owned = lead.kind === 'browser' && !max && !!owners[lead.id];
        // the strips enter in turn (agent-strips.css, off under reduced motion)
        return <div className={`agent-pane-wrap${owned ? ' owned-pane' : ''}`} key={key} style={{ '--row-index': Math.min(i, 8), ...(accent !== null ? pairStyle(accent) : {}) } as CSSProperties}>
          {firstOfArea && <h3 className="workspace-area">{area || tr('product.noArea')}</h3>}
          {/* a chat keeps the same parent with or without its browsers beside it: expanding never remounts it */}
          {lead.kind === 'chat'
            ? <div className={side.length ? 'strip-pair' : 'strip-solo'} {...(side.length ? { 'data-testid': `strip-pair-${lead.id}` } : {})}>{pane(lead)}{side.length > 0 && <div className="strip-pair-side">{side.map(pane)}</div>}</div>
            : pane(lead)}
          {/* Child activity remains visible when its parent is collapsed, expanded or maximized. */}
          {lead.kind === 'chat' && <ChildStrips chatId={lead.id} />}
        </div>;
      })}
    </div>
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
