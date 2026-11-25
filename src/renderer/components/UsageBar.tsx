// The usage figure in the top bar (ADR 0287, ADR 0298, ADR 0334): today's spend and the pinned harnesses' weekly/plan
// limits (default: Claude 7g, plus 5h from 70%); one click opens a direct popover listing every harness (Claude,
// Cursor, Codex, OpenCode, Antigravity) with session/weekly windows, reset countdowns, one-click pin toggles and
// today's spend by chat. Data: the 'usage' snapshot from the main process (brain/usage.ts + brain/provider-usage.ts)
// and each chat's live cost (lib/live-costs.ts). Used by TopBar.tsx.
import { t as auditText, locale } from '../i18n';
import { useRef, useState } from 'react';
import type { ChatSummary, Harness, HarnessUsage, HarnessUsageWindow, Usage } from '@shared/contract';
import { formatCost, until } from '../lib/format';
import { costRows, liveTotal } from '../lib/live-costs';
import { go, focusChat } from '../actions';
import { LiveCostList } from './LiveCosts';
import { useNow } from '../lib/clock';
import { refreshUsage, useApp } from '../store/store';
import { setPrefs, ui } from '../store/ui';
import { chatList } from '../lib/chat-derived';
import { HarnessMark, IconChevronDown, IconChevronRight, IconPin, IconRefresh } from './Icons';
import { Popover } from './ui';
import { sb } from '../sb';

type Tone = 'green' | 'amber' | 'red' | 'none';
const toneOf = (pct: number | null | undefined): Tone => (pct == null ? 'none' : pct >= 90 ? 'red' : pct >= 70 ? 'amber' : 'green');
const pctText = (pct: number) => `${Math.round(pct)}%`;

const HARNESS_ORDER: readonly { id: Harness; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'codex', label: 'Codex' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'antigravity', label: 'Antigravity' },
];
const ORDER_INDEX = new Map(HARNESS_ORDER.map((h, i) => [h.id, i]));

const hhmm = (t: number) => new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(t));
const dayKey = (t: number) => new Date(t).toDateString();
/** "18:40" today, "dom 18:40" tomorrow or later in the week, "12/10 18:40" further away. */
export function resetAt(t: number, now: number): string {
  if (dayKey(t) === dayKey(now)) return hhmm(t);
  const wd = new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(new Date(t)).replace('.', '');
  if (t - now < 6.5 * 864e5) return `${wd} ${hhmm(t)}`;
  return `${new Intl.DateTimeFormat(locale(), { day: '2-digit', month: '2-digit' }).format(new Date(t))} ${hhmm(t)}`;
}
/** Short countdown ("2h 13m", "4g 1h", "now") like Cloudroom's provider-usage rows. */
function shortCountdown(t: number | null, now: number): string {
  if (t == null) return '—';
  const rem = t - now;
  if (!Number.isFinite(rem)) return '—';
  if (rem <= 0) return auditText('appText.usageBar.justNow');
  const mins = Math.ceil(rem / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return mins % 60 === 0 ? `${hours}h` : `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  const r = hours % 24;
  return r === 0 ? `${days}g` : `${days}g ${r}h`;
}
/** "tra 2 h 13 min" within a day, "tra 4 g 1 h" beyond. */
const inTime = (t: number, now: number) => {
  const h = Math.floor((t - now) / 36e5);
  if (h < 24) return until(t, now);
  const d = Math.floor(h / 24), r = h % 24;
  return auditText('appText.format.in', { time: r ? `${auditText('appText.format.days', { n: d })} ${r} h` : auditText('appText.format.days', { n: d }) });
};
const ago = (t: number, now: number) => {
  const m = Math.round((now - t) / 6e4);
  return m <= 1 ? auditText('appText.usageBar.justNow') : auditText('appText.usageBar.ago', { time: m < 60 ? `${m} min` : `${Math.round(m / 60)} h` });
};

/** Cursor today as shown: "n/d", the exact $ of an export, or "≈ $" of the ledger estimate (with "±x%" when long). */
export function cursorText(u: Usage | null, long = false): string {
  if (u?.cursorTodayUsd == null) return 'n/d';
  if (u.cursorExact !== false) return formatCost(u.cursorTodayUsd);
  return `≈ ${formatCost(u.cursorTodayUsd)}${long && u.cursorMarginPct != null ? ` ±${u.cursorMarginPct}%` : ''}`;
}

/** Pick the primary weekly/plan window for a harness's pinned top-bar indicator. */
export function primaryWeeklyWindow(h: HarnessUsage | undefined): HarnessUsageWindow | null {
  if (!h || h.status !== 'ok' || !h.windows.length) return null;
  return h.windows.find(w => w.kind === 'weekly' && !w.model)
    ?? h.windows.find(w => w.kind === 'plan' && !w.model)
    ?? h.windows.find(w => w.kind === 'weekly')
    // never a 5 h or daily window: the pin promises the weekly/plan limit
    ?? h.windows.find(w => w.kind !== 'five-hour' && w.kind !== 'daily')
    ?? null;
}

/** Synthesize the ordered harness list even when a snapshot predates `Usage.harnesses`. */
function harnessListOf(usage: Usage | null, now: number): HarnessUsage[] {
  if (usage?.harnesses?.length) return usage.harnesses;
  const claudeWindows: HarnessUsageWindow[] = [];
  if (usage?.fiveHourPct != null) claudeWindows.push({ kind: 'five-hour', label: '5h', usedPercent: usage.fiveHourPct, resetsAt: usage.fiveHourResetsAt ?? null });
  if (usage?.weekPct != null) claudeWindows.push({ kind: 'weekly', label: '7g', usedPercent: usage.weekPct, resetsAt: usage.weekResetsAt ?? null });
  return HARNESS_ORDER.map(({ id, label }): HarnessUsage => {
    if (id === 'claude') {
      return {
        harness: id, label, status: claudeWindows.length ? 'ok' : 'unavailable', planLabel: null, accountEmail: null,
        windows: claudeWindows, message: claudeWindows.length ? null : (usage?.limitsNote ?? auditText('auditExpression.UsageBar.text216')),
        source: claudeWindows.length ? 'stream' : 'none', at: usage?.limitsAt ?? now,
      };
    }
    return { harness: id, label, status: 'unavailable', planLabel: null, accountEmail: null, windows: [], message: auditText('auditExpression.UsageBar.text216'), source: 'none', at: now };
  });
}

function Meter({ pct, wide }: { pct: number | null | undefined; wide?: boolean }) {
  const tone = toneOf(pct);
  return (
    <span className={`ub-meter ${wide ? 'wide' : ''} tone-${tone}`} aria-hidden="true">
      <b style={{ width: pct == null ? 0 : `${Math.min(100, Math.max(3, pct))}%` }} />
    </span>
  );
}

const SEGMENTS = 12;
function SegmentedMeter({ pct }: { pct: number }) {
  const tone = toneOf(pct);
  const lit = pct <= 0 ? 0 : Math.max(1, Math.round((Math.min(100, pct) / 100) * SEGMENTS));
  return (
    <span className={`ub-segs tone-${tone}`} aria-hidden="true">
      {Array.from({ length: SEGMENTS }, (_, i) => <i key={i} className={i < lit ? 'on' : undefined} />)}
    </span>
  );
}

function Window({ label, pct, resets, now, testid }: { label: string; pct: number | null | undefined; resets: number | null | undefined; now: number; testid: string }) {
  return (
    <span className={`ub-win ub-win-${testid.replace('usage-', '')}`} data-testid={testid} data-tone={toneOf(pct)}>
      <span className="ub-k">{label}</span>
      <Meter pct={pct} />
      <b className="ub-v">{pct == null ? '—' : pctText(pct)}</b>
      {pct != null && resets ? <span className="ub-reset">↻ {resetAt(resets, now)}</span> : null}
    </span>
  );
}

function WindowRow({ win, now, stopped }: { win: HarnessUsageWindow; now: number; stopped?: boolean }) {
  // an engine the app skips never shows a green bar (ADR 0354): its windows read as stopped
  const tone: Tone = stopped ? 'red' : toneOf(win.usedPercent);
  const resetTip = win.resetsAt
    ? auditText('appText.usageBar.resets', { when: `${dayKey(win.resetsAt) === dayKey(now) ? auditText('auditExpression.UsageBar.text218') : ''}${resetAt(win.resetsAt, now)} · ${inTime(win.resetsAt, now)}` })
    : auditText('appText.usageBar.noReset');
  const costText = win.cost ? `${formatCost(win.cost.usedUsdCents / 100)} / ${formatCost(win.cost.limitUsdCents / 100)}` : null;
  return (
    <div className="ub-w-row" data-tone={tone} data-tip={costText ? `${resetTip} · ${costText}` : resetTip}>
      <span className="ub-w-label">{win.label}</span>
      <SegmentedMeter pct={win.usedPercent} />
      <b className={`ub-w-pct tone-${tone}`}>{pctText(win.usedPercent)}</b>
      <span className="ub-w-reset">{win.resetsAt ? `↻ ${shortCountdown(win.resetsAt, now)}` : costText ?? '—'}</span>
    </div>
  );
}

/** The app's verdict on an engine (ADR 0354): why it skips it, until when, and «Riprova ora». */
function CreditLine({ credit, now }: { credit: NonNullable<HarnessUsage['credit']>; now: number }) {
  const [busy, setBusy] = useState(false);
  if (credit.state === 'free' || credit.state === 'unknown') return null;
  const retry = () => { setBusy(true); void sb.invoke('agents:creditRetry', { pool: credit.pool }).finally(() => { setBusy(false); void refreshUsage(); }); };
  const text = credit.state === 'out' ? auditText('appText.usageBar.creditOut', { why: credit.why })
    : credit.state === 'pace' ? auditText('appText.usageBar.creditPace', { why: credit.why }) : auditText('appText.usageBar.creditProbation');
  return (
    <div className="ub-h-credit" data-state={credit.state} data-testid={`usage-credit-${credit.pool}`}>
      <span>{text}{credit.until && credit.state === 'out' && !/torna alle/i.test(credit.why) ? ` · ${auditText('appText.usageBar.creditBack', { when: `${dayKey(credit.until) === dayKey(now) ? '' : `${resetAt(credit.until, now)} `}${hhmm(credit.until)}` })}` : ''}</span>
      {credit.state !== 'pace' ? <button type="button" className="ub-credit-retry" disabled={busy} onClick={retry} data-testid={`usage-credit-retry-${credit.pool}`}>{busy ? auditText('appText.usageBar.creditRetrying') : auditText('appText.usageBar.creditRetry')}</button> : null}
    </div>
  );
}

function HarnessCard({ item, pinned, onTogglePin, now }: { item: HarnessUsage; pinned: boolean; onTogglePin: (h: Harness) => void; now: number }) {
  const [showExtra, setShowExtra] = useState(false);
  const stopped = item.credit?.state === 'out';
  const primary = item.windows.filter(w => !w.model);
  const extra = item.windows.filter(w => !!w.model);
  const shown = primary.length && extra.length && !showExtra ? primary : item.windows;
  const pinLabel = pinned ? auditText('appText.usageBar.unpin') : auditText('appText.usageBar.pin');
  return (
    <div className="ub-harness" data-testid={`usage-harness-${item.harness}`} data-status={item.status} data-credit={item.credit?.state ?? 'unknown'}>
      <div className="ub-h-head">
        <span className="ub-h-name" data-tip={item.accountEmail ?? undefined}>
          <HarnessMark harness={item.harness} size={16} />
          <b>{item.label}</b>
          {item.planLabel ? <span className="ub-plan-pill">{item.planLabel}</span> : null}
        </span>
        <button
          type="button"
          className={`ub-pin-btn ${pinned ? 'is-pinned' : ''}`}
          aria-pressed={pinned}
          aria-label={`${item.label}: ${pinLabel}`}
          data-tip={pinLabel}
          data-testid={`usage-pin-toggle-${item.harness}`}
          onClick={() => onTogglePin(item.harness)}
        >
          <IconPin size={13} filled={pinned} />
        </button>
      </div>
      {item.credit ? <CreditLine credit={item.credit} now={now} /> : null}
      {shown.length > 0 ? (
        <div className="ub-h-wins">
          {shown.map(w => <WindowRow key={`${w.kind}-${w.label}`} win={w} now={now} stopped={stopped} />)}
          {primary.length > 0 && extra.length > 0 ? (
            <button type="button" className="ub-extra-btn" onClick={() => setShowExtra(v => !v)}>
              {showExtra ? <IconChevronDown size={11} /> : <IconChevronRight size={11} />}
              <span>{showExtra ? auditText('appText.usageBar.showLess') : `${auditText('appText.usageBar.showMore')} (${extra.length})`}</span>
            </button>
          ) : null}
          {item.creditsDetail ? <div className="ub-h-credits">{auditText('appText.usageBar.creditsOn')} · {item.creditsDetail}</div> : null}
          {item.message ? <div className="ub-h-msg">{item.message}</div> : null}
        </div>
      ) : (
        <div className="ub-h-msg">{item.message ?? auditText('auditExpression.UsageBar.text216')}</div>
      )}
    </div>
  );
}

/** chats shown in the popup before "Tutte" */
const POP_ROWS = 6;

function Details({
  usage, harnesses, pinned, onTogglePin, chats, now, close,
}: {
  usage: Usage | null; harnesses: HarnessUsage[]; pinned: Set<Harness>;
  onTogglePin: (h: Harness) => void; chats: ChatSummary[]; now: number; close: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const total = liveTotal(usage, chats);
  const rows = costRows(usage, chats);
  const onRefresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    void refreshUsage().finally(() => setRefreshing(false));
  };
  return (
    <div className="ub-pop">
      <section className="ub-sec ub-sec-harnesses" data-testid="usage-pop-harnesses">
        <div className="ub-sec-head">
          <span>{auditText('appText.usageBar.title')}</span>
          <span className="ub-head-actions">
            {usage?.at ? <small>{ago(usage.at, now)}</small> : null}
            <button
              type="button"
              className={`ub-refresh-btn ${refreshing ? 'is-spin' : ''}`}
              aria-label={auditText('appText.usageBar.refresh')}
              data-tip={auditText('appText.usageBar.refresh')}
              data-testid="usage-refresh"
              onClick={onRefresh}
              disabled={refreshing}
            >
              <IconRefresh size={13} />
            </button>
          </span>
        </div>
        <div className="ub-h-list">
          {harnesses.map(h => (
            <HarnessCard key={h.harness} item={h} pinned={pinned.has(h.harness)} onTogglePin={onTogglePin} now={now} />
          ))}
        </div>
      </section>
      <section className="ub-sec">
        <div className="ub-sec-head">
          <span>{auditText('audit.UsageBar.todaySSpending')}</span>
          {usage?.costAt ? <small data-tip={auditText('auditExpression.UsageBar.text220', { v0: hhmm(usage.costAt) })}>{auditText('audit.UsageBar.live')}</small> : null}
        </div>
        <div className="ub-spend-line">
          <div className="ub-total" data-testid="usage-pop-total">{total ? `${total.estimated ? '≈ ' : ''}${formatCost(total.usd)}` : 'n/d'}</div>
          <div className="ub-spend-pills">
            <span className="ub-spend-pill"><HarnessMark harness="claude" size={14} /><b>{usage?.costKnown === false ? 'n/d' : formatCost(usage?.todayUsd ?? 0)}</b></span>
            <span className="ub-spend-pill"><HarnessMark harness="cursor" size={14} />{usage?.cursorExact === false ? <span className="ub-tag" data-testid="usage-pop-cursor-est">{auditText('audit.UsageBar.estimate')}</span> : null}<b>{cursorText(usage, true)}</b></span>
          </div>
        </div>
        {usage?.costKnown === false && usage.costNote ? <p className="ub-note">{usage.costNote}</p> : null}
      </section>
      <section className="ub-sec" data-testid="usage-pop-chats">
        <div className="ub-sec-head"><span>{auditText('audit.UsageBar.todaySChatsMostExpensiveFirst')}</span><small>{auditText('audit.UsageBar.live')}</small></div>
        <LiveCostList rows={rows} limit={POP_ROWS} testid="usage-pop-list" unpricedModels={usage?.cursorUnpriced?.models}
          onOpen={id => { close(); focusChat(id); }} onMore={() => { close(); go({ page: 'andamento', arg: 'costi/1' }); }} />
      </section>
    </div>
  );
}

export function UsageBar() {
  const usage = useApp(s => s.usage);
  const chats = useApp(s => s.chats);
  const pinnedRaw = ui.use(s => s.prefs.usagePinned);
  const now = useNow(30_000);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const list = chatList(chats);
  const total = liveTotal(usage, list);
  const harnesses = harnessListOf(usage, now);
  const byId = new Map(harnesses.map(h => [h.harness, h]));
  const pinnedList = (pinnedRaw ?? ['claude']).filter(h => byId.has(h));
  const pinnedSet = new Set(pinnedList);
  const togglePin = (h: Harness) => {
    const next = pinnedSet.has(h)
      ? pinnedList.filter(x => x !== h)
      : [...pinnedList, h].sort((a, b) => (ORDER_INDEX.get(a) ?? 99) - (ORDER_INDEX.get(b) ?? 99));
    setPrefs({ usagePinned: next });
  };

  const tip = [
    total ? auditText(total.partial ? 'cmp.usage.todayPartial' : 'cmp.usage.today', { cost: `${total.estimated ? '≈ ' : ''}${formatCost(total.usd)}` }) : auditText('cmp.usage.todayUnavailable'),
    ...harnesses.map(h => {
      const w = primaryWeeklyWindow(h);
      return w ? `${h.label} ${w.label} ${pctText(w.usedPercent)}` : null;
    }),
  ].filter(Boolean).join(' · ');

  const showMarks = pinnedList.length > 1 || (pinnedList.length === 1 && pinnedList[0] !== 'claude');

  return (
    <>
      <button ref={ref} type="button" className="usagebar" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="dialog" aria-label={auditText('auditExpression.UsageBar.text226', { v0: tip })} data-tip={tip} data-testid="usage">
        <span className="ub-today"><b className="ub-v" data-testid="usage-today">{total ? `${total.estimated ? '≈ ' : ''}${formatCost(total.usd)}` : 'n/d'}</b></span>
        {pinnedList.map(hId => {
          const h = byId.get(hId);
          if (hId === 'claude') {
            const wPct = primaryWeeklyWindow(h)?.usedPercent ?? usage?.weekPct ?? null;
            const fPct = h?.windows.find(w => w.kind === 'five-hour')?.usedPercent ?? usage?.fiveHourPct ?? null;
            return (
              <span key={hId} className="ub-group" data-testid="usage-claude">
                {showMarks ? <HarnessMark harness="claude" size={14} /> : null}
                <Window label={showMarks ? '' : '7g'} pct={wPct} resets={null} now={now} testid="usage-week" />
                {(fPct ?? 0) >= 70 && <Window label="5h" pct={fPct} resets={null} now={now} testid="usage-5h" />}
              </span>
            );
          }
          const w = primaryWeeklyWindow(h);
          const pct = w?.usedPercent ?? null;
          return (
            <span key={hId} className="ub-pin" data-testid={`usage-pin-${hId}`} data-tone={h?.credit?.state === 'out' ? 'red' : toneOf(pct)}>
              <HarnessMark harness={hId} size={14} />
              <Meter pct={pct} />
              <b className="ub-v">{pct == null ? '—' : pctText(pct)}</b>
            </span>
          );
        })}
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} testid="usage-pop" width={380}>
        <Details usage={usage} harnesses={harnesses} pinned={pinnedSet} onTogglePin={togglePin} chats={list} now={now} close={() => setOpen(false)} />
      </Popover>
    </>
  );
}
