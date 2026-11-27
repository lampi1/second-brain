// The Grindhouse as strips grouped by Strategist (ADR 0366, issue #491; it replaces the benches of ADR 0311, 0312): three
// sections in this order, «Ti aspetta» (amber on the left edge), «Al lavoro» and «Finite oggi» (lib/grind-groups.ts);
// in each, one unit per root chat in the Orchestrator's order (lib/agent-order.ts): its lead strip (ChatTile.tsx closed:
// the role's little person, title, «Role · what it does now», the plan's dots, the state, time · cost, the ⓘ) and every
// chat it delegated under it as an indented strip joined by a thin tree line, the ones that need someone first; a chat
// with no team is a strip alone. A finished unit is one still line. The people are today's (AgentSprite.tsx), on no
// stage. A click on a strip opens its chat in place of the page: only that chat, its views (Chat · Affiancati · Browser,
// ADR 0287) in its head, and above it the team as tabs (the chat that delegated and every chat under it) with
// «← Grindhouse» to go back; a delegated chat opens as its card (DelegationCard.tsx). The Orchestrator stays beside it.
// There is no drag and no saved order (SPEC 10-11); F11 still takes a chat to full screen (FullScreen.tsx). A browser
// without a strip is a row of its own after the sections; a root chat the app started or resumed by itself says so
// above its strip (Origin, ADR 0102).
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { ChatSummary } from '@shared/contract';
import { tileKey, type TileRef } from '../lib/grid';
import { type TreeNode } from '../lib/chat-tree';
import { originFor, sameOrigin, sameTree, stripTiles, stripTree, tabOwners } from '../lib/chat-derived';
import { sameRecord } from '../lib/memo';
import { schedule } from '../lib/viewports';
import { app, useApp } from '../store/store';
import { leaveGhost } from '../lib/leave-ghost';
import { sameList, showsWork } from '../store/state';
import { useHandoffTabs } from '../store/handoffs';
import { setPrefs, ui } from '../store/ui';
import { t as tr, locale } from '../i18n';
import { ChatTile } from './ChatTile';
import { BrowserTile } from './BrowserTile';
import { ChildStrips } from './ChildStrips';
import { DelegationCard } from './DelegationCard';
import { AgentAvatar } from './AgentAvatar';
import { IconArrowLeft } from './Icons';
import { childState, type ChildState } from '../lib/chat-tree';
import { grindSections, holdStatuses, kidCount, kidStatus, rootStatus, visualOrder, type GrindKid, type GrindStatus } from '../lib/grind-groups';
import { useDayStart } from '../lib/clock';
import { LINE } from './DelegationCard';
import type { StripRow } from './ChatTile';
import { setChatExpanded } from '../store/ui';
import { go } from '../actions';
import { GrindhouseEmpty } from './MorningBlock';
import '../styles/alive.css';
import '../styles/agent-strips.css';

const equalTiles = (a: TileRef[], b: TileRef[]) => a === b || sameList(a.map(tileKey), b.map(tileKey));
/** The dot's tone of a delegated chat's state (the same tints as its thread line). */
const kidTone = (state: ChildState): string => LINE[state];

export function AgentStrips() {
  const ready = useApp(s => s.ready);
  const panelsVersion = ui.use(s => s.prefs.chatPanelsV);
  const expansion = ui.use(s => s.prefs.chatExpanded);
  const hidden = ui.use(s => s.hidden, sameList), hiddenTabs = ui.use(s => s.hiddenTabs, sameList);
  // derived once per chats object for every subscriber (lib/chat-derived.ts), compared without JSON.stringify
  const tree = useApp(s => stripTree(s.order, s.chats), sameTree);
  const tiles = useApp(s => stripTiles(s.order, s.chats, s.tabs), equalTiles);
  const nodes = new Map<string, TreeNode>(tree.map(n => [n.id, n]));
  // where each chat stands (a root by its state, a delegated chat by its delegation), a stop between turns held a moment
  const statuses = useApp(s => statusesOf(tree, s.chats), sameRecord);
  const shownStatus = useHeldStatuses(statuses);
  // when each chat last stopped: «Finite oggi» keeps today's (local day) only
  const ended = useApp(s => endedOf(tree, s.chats), sameRecord);
  const today = useDayStart();
  // the finished units whose helpers the user unfolded
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
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
  const byChat = new Map(shown.filter(t => t.kind === 'chat').map(t => [t.id, t]));
  const sections = grindSections(tree.filter(n => byChat.has(n.id)), id => shownStatus[id] ?? 'work', id => ended[id] ?? 0, today);
  // Ctrl+2…9 follow the strips as they show, never a folded one (actions.ts focusTile)
  const order = visualOrder(sections, unfolded);
  const onPage = new Set(order);
  const chatIndices = new Map(order.map((id, i) => [`chat:${id}`, i + 1]));
  // native browser views follow their strip when strips open, close, move or change
  useLayoutEffect(() => { schedule(); }, [shown.map(tileKey).join('|'), order.join('|'), expansion]);

  const pane = (tile: TileRef, row?: StripRow, index = chatIndices.get(tileKey(tile))) => {
    const key = tileKey(tile);
    const closed = tile.kind === 'chat' && expansion[tile.id] !== true;
    return <div className={`agent-pane${closed ? ' strip-pane' : ''}${tile.kind === 'browser' ? ' browser-pane' : ''}`} data-workspace-pane={key} key={key}>
      <div className="agent-pane-content">{tile.kind === 'chat' ? <ChatTile chatId={tile.id} index={index} row={row} still={row !== undefined && shownStatus[tile.id] !== 'work'} /> : <BrowserTile tabId={tile.id} />}</div>
    </div>;
  };
  const openRef = useRef<HTMLDivElement>(null);
  const shownOpen = shown.some(t => t.kind === 'chat' && expansion[t.id] === true);
  useLayoutEffect(() => { if (shownOpen) openRef.current?.scrollIntoView({ block: 'start' }); }, [shownOpen, opened]);
  // the chat on screen: the one opened last, else any open one (one at a time; the others stay as they were)
  const open = shown.filter(t => t.kind === 'chat' && expansion[t.id] === true).map(t => t.id);
  const openId = opened && open.includes(opened) ? opened : open[0];
  // a browser on the page: under the strip of the chat that owns it (a hand-off waiting for the user), else a row of its
  // own after the sections (the user's, the Orchestrator's, one whose chat is not on the page)
  const tabsOf = new Map<string, TileRef[]>();
  const rows: TileRef[] = [];
  for (const t of shown) {
    if (t.kind !== 'browser') continue;
    const o = owners[t.id];
    if (o && onPage.has(o)) tabsOf.set(o, [...(tabsOf.get(o) ?? []), t]);
    else rows.push(t);
  }
  // no strip: the morning block for a user with history, the first-run text otherwise (ADR 0102)
  if (!openId && !sections.length && !rows.length) return <GrindhouseEmpty />;
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
      <div className="bench-open-chat">{depth > 0 ? <DelegationCard chatId={openId} /> : pane(lead, undefined, 1)}</div>
    </div>;
  }
  // a strip with the hand-off tab that hangs under it
  const strip = (id: string, row: StripRow) => <>
    {pane(byChat.get(id)!, row)}
    {(tabsOf.get(id) ?? []).map(t => <div key={tileKey(t)} className="agent-pane-wrap owned-pane grind-tab">{pane(t)}</div>)}
  </>;
  // the chats under a lead, each with the ones it delegated in turn; the thread lines are the list's (agent-strips.css)
  const kidList = (kids: readonly GrindKid[]) => kids.length > 0 && <div className="grind-kids" role="group" aria-label={tr('product.benchTeam')}>
    {kids.map(k => <div key={k.id} className="grind-kid" data-testid={`grind-kid-${k.id}`} data-status={shownStatus[k.id]}>{strip(k.id, 'kid')}{kidList(k.kids)}</div>)}
  </div>;
  const toggle = (lead: string) => setUnfolded(u => { const n = new Set(u); if (n.has(lead)) n.delete(lead); else n.add(lead); return n; });
  // one flat list of section heads and teams, each keyed by itself: a team that changes section moves, its strips stay
  // mounted (focus, menus and browser views kept)
  return <div className="agent-strips grind" data-testid="view-agents">
    {sections.flatMap(sec => [
      <h3 key={`sec-${sec.id}`} className={`grind-sec-h is-${sec.id}`} data-testid={`grind-sec-${sec.id}`}>
        <span>{tr(`grind.sec.${sec.id}`)}</span><small data-testid={`grind-count-${sec.id}`}>{sec.units.reduce((n, u) => n + 1 + kidCount(u.kids), 0)}</small>
      </h3>,
      ...sec.units.map(u => {
        const done = sec.id === 'done', unfold = !done || unfolded.has(u.lead), n = kidCount(u.kids);
        return <div key={`team-${u.lead}`} className={`grind-team in-${sec.id}${u.kids.length && unfold ? ' has-kids' : ''}`} data-testid={`grind-team-${u.lead}`} data-sec={sec.id} ref={leaveRef(u.lead)}>
          <Origin chatId={u.lead} />
          {strip(u.lead, done ? 'done' : 'lead')}
          {done && n > 0 && <button type="button" className="grind-fold" aria-expanded={unfold} onClick={() => toggle(u.lead)} data-tip={tr('grind.helpersTip')} data-testid={`grind-fold-${u.lead}`}>
            {tr('grind.helpers', { n })}
          </button>}
          {u.kids.length > 0 && <div hidden={!unfold} className="grind-kids-wrap">{kidList(u.kids)}</div>}
        </div>;
      }),
    ])}
    {rows.map(r => <div key={tileKey(r)} className={`agent-pane-wrap grind-row${owners[r.id] ? ' owned-pane' : ''}`}>{pane(r)}</div>)}
  </div>;
}

/** Each chat on the page: its lead's status from its state, a delegated chat's from its delegation. */
function statusesOf(tree: readonly TreeNode[], chats: Readonly<Record<string, ChatSummary | undefined>>): Record<string, GrindStatus> {
  const out: Record<string, GrindStatus> = {};
  for (const n of tree) {
    const c = chats[n.id];
    if (!c) continue;
    out[n.id] = n.depth === 0 ? rootStatus(c) : kidStatus(childState(c));
  }
  return out;
}

/** When each chat on the page last stopped: its last turn's end, else its archive, else its last change. */
function endedOf(tree: readonly TreeNode[], chats: Readonly<Record<string, ChatSummary | undefined>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of tree) {
    const c = chats[n.id];
    if (c) out[n.id] = Math.max(c.lastResult?.at ?? 0, c.closedAt ?? 0, c.updatedAt ?? 0);
  }
  return out;
}

/** The statuses as the page shows them: a unit leaves «Al lavoro» only after its stop lasts (lib/grind-groups.ts). While
 *  something is held the timer is armed again at every wake, so a timer that fired early never leaves a chat held. */
function useHeldStatuses(current: Record<string, GrindStatus>): Record<string, GrindStatus> {
  const memory = useRef(new Map<string, { shown: GrindStatus; leftAt: number | null }>());
  const [tick, wake] = useReducer((n: number) => n + 1, 0);
  const { shown, wakeAt } = holdStatuses(current, memory.current, Date.now());
  useEffect(() => {
    if (wakeAt === null) return;
    const timer = setTimeout(wake, Math.max(16, wakeAt - Date.now()));
    return () => clearTimeout(timer);
  }, [wakeAt, tick]);
  return shown;
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
        const name = c.agent?.name || c.title, tone = i === 0 ? (c.state === 'waiting' ? 'wait' : c.state === 'error' ? 'err' : showsWork(c) ? 'run' : 'off') : kidTone(childState(c));
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
