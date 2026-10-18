// The agents' strips in the Grindhouse (brain/pages/Home.tsx; SPEC 19: the one place for agents): one column, one
// strip under the other, in the Orchestrator's order (lib/agent-order.ts: grouped by area, start order inside a
// group); each browser tab sits right under the chat that drives it. There is no drag and no saved order (SPEC 10-11):
// the user expands, maximizes or opens a strip in focus mode, the Orchestrator decides where it goes.
import { useEffect, useLayoutEffect, type CSSProperties } from 'react';
import { workspaceTiles, tileKey, type TileRef } from '../lib/grid';
import { agentOrder, areaOf } from '../lib/agent-order';
import { schedule } from '../lib/viewports';
import { useApp } from '../store/store';
import { sameList } from '../store/state';
import { useHandoffTabs } from '../store/handoffs';
import { toggleBrowsers, setPrefs, ui } from '../store/ui';
import { t as tr } from '../i18n';
import { ChatTile } from './ChatTile';
import { BrowserTile } from './BrowserTile';
import { toggleMaximize } from '../actions';
import '../styles/agent-strips.css';

const equalTiles = (a: TileRef[], b: TileRef[]) => sameList(a.map(tileKey), b.map(tileKey));

/** The strips' own controls, shown in the head of the Grindhouse's agents section. */
export function AgentStripsActions() {
  const maximized = ui.use(s => s.maximized);
  const hide = ui.use(s => s.prefs.browsersHidden);
  return <>
    {maximized && maximized !== 'regia' && <button type="button" className="btn btn-ghost btn-s" onClick={() => toggleMaximize(maximized)}>{tr('product.restoreLayout')}</button>}
    <button type="button" className="btn btn-ghost btn-s" onClick={toggleBrowsers}>{tr(hide ? 'product.showBrowsers' : 'product.hideBrowsers')}</button>
  </>;
}

export function AgentStrips() {
  const ready = useApp(s => s.ready);
  const panelsVersion = ui.use(s => s.prefs.chatPanelsV);
  const expansion = ui.use(s => s.prefs.chatExpanded);
  const hidden = ui.use(s => s.hidden, sameList), hiddenTabs = ui.use(s => s.hiddenTabs, sameList);
  const tiles = useApp(s => workspaceTiles(agentOrder(s.order, s.chats), s.chats, s.tabs), equalTiles);
  const owners = useApp(s => Object.fromEntries(s.tabs.filter(t => t.ownerChatId).map(t => [t.id, t.ownerChatId!])), (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const areas = useApp(s => tiles.map(t => t.kind === 'chat' ? areaOf(s.chats[t.id] ?? { cwd: '' }) : ''), sameList);
  const maximized = ui.use(s => s.maximized);
  const hide = ui.use(s => s.prefs.browsersHidden);
  const keep = useHandoffTabs();
  const keySignature = tiles.map(tileKey).join('|');
  useEffect(() => {
    if (ready && panelsVersion === 0) setPrefs({ chatPanelsV: 1, chatExpanded: { ...Object.fromEntries(tiles.filter(tile => tile.kind === 'chat').map(tile => [tile.id, true])), ...ui.get().prefs.chatExpanded } });
  }, [ready, panelsVersion, keySignature]);
  const isVisible = (t: TileRef) => t.kind === 'chat' ? !hidden.includes(t.id) : !hiddenTabs.includes(t.id) && !hidden.includes(owners[t.id] ?? '') && (!hide || keep.includes(t.id));
  const visible = tiles.filter(isVisible);
  const max = maximized ? visible.find(t => tileKey(t) === maximized) ?? null : null;
  const shown = max ? [max] : visible;
  const chatIndices = new Map(visible.filter(t => t.kind === 'chat').map((t, index) => [tileKey(t), index + 1]));
  let lastArea: string | null = null;
  // native browser views follow their strip when strips expand, collapse or change
  useLayoutEffect(() => { schedule(); }, [shown.map(tileKey).join('|'), expansion]);

  if (!shown.length) return <p className="home-calm" data-testid="agents-empty">{tr('home.emptyAgents')}</p>;
  return <div className="agent-strips" data-testid="view-agents">
    <div className={`workspace-column${max ? ' workspace-max' : ''}`} {...(max ? { 'data-testid': 'maximized', 'data-key': tileKey(max) } : {})}>
      {shown.map((tile, i) => {
        const key = tileKey(tile), area = areas[tiles.indexOf(tile)] ?? '';
        const firstOfArea = !max && tile.kind === 'chat' && area !== lastArea;
        if (tile.kind === 'chat') lastArea = area;
        const compact = tile.kind === 'chat' && panelsVersion === 1 && expansion[tile.id] !== true && !max;
        // the strips enter in turn (agent-strips.css, off under reduced motion)
        return <div className="agent-pane-wrap" key={key} style={{ '--row-index': Math.min(i, 8) } as CSSProperties}>
          {firstOfArea && <h3 className="workspace-area">{area || tr('product.noArea')}</h3>}
          <div className={`agent-pane${compact ? ' strip-pane' : ''}${tile.kind === 'browser' ? ' browser-pane' : ''}`} data-workspace-pane={key}>
            <div className="agent-pane-content">{tile.kind === 'chat' ? <ChatTile chatId={tile.id} index={chatIndices.get(key)} maximized={!!max} /> : <BrowserTile tabId={tile.id} maximized={!!max} />}</div>
          </div>
        </div>;
      })}
    </div>
  </div>;
}
