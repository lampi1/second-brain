// The usage strip in the top bar: today's spend, the Claude plan windows (5 hours and week, each with its reset time),
// Cursor usage today, always visible, with a detail panel on click. Why: the user wants their subscriptions' usage in sight at
// all times (2026-10-11), and an honest "n/d" with the reason where a number does not exist (Cursor's plan usage has no
// source; see Usage.cursorPlanNote). Data: the 'usage' snapshot from the main process (brain/usage.ts) and the chats'
// own costs (live estimate included): today's total moves at each message and the popup lists every chat of the day by
// cost (lib/live-costs.ts, LiveCosts.tsx). Used by TopBar.tsx.
import { t as auditText, locale } from '../i18n';
import { useRef, useState } from 'react';
import type { ChatSummary, Usage } from '@shared/contract';
import { formatCost, until } from '../lib/format';
import { costRows, liveTotal } from '../lib/live-costs';
import { go, focusChat } from '../actions';
import { LiveCostList } from './LiveCosts';
import { useNow } from '../lib/clock';
import { useApp } from '../store/store';
import { chatList } from '../lib/chat-derived';
import { HarnessMark } from './Icons';
import { Popover } from './ui';

type Tone = 'green' | 'amber' | 'red' | 'none';
const toneOf = (pct: number | null | undefined): Tone => (pct == null ? 'none' : pct >= 90 ? 'red' : pct >= 70 ? 'amber' : 'green');
const pctText = (pct: number) => `${Math.round(pct)}%`;

const hhmm = (t: number) => new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(t));
const dayKey = (t: number) => new Date(t).toDateString();
/** "18:40" today, "dom 18:40" tomorrow or later in the week, "12/10 18:40" further away. */
export function resetAt(t: number, now: number): string {
  if (dayKey(t) === dayKey(now)) return hhmm(t);
  const wd = new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(new Date(t)).replace('.', '');
  if (t - now < 6.5 * 864e5) return `${wd} ${hhmm(t)}`;
  return `${new Intl.DateTimeFormat(locale(), { day: '2-digit', month: '2-digit' }).format(new Date(t))} ${hhmm(t)}`;
}
/** "tra 2 h 13 min" within a day, "tra 4 g 1 h" beyond. */
const inTime = (t: number, now: number) => {
  const h = Math.floor((t - now) / 36e5);
  if (h < 24) return until(t, now);
  const d = Math.floor(h / 24), r = h % 24;
  return auditText('appText.format.in', { time: r ? `${auditText('appText.format.days', { n: d })} ${r} h` : auditText('appText.format.days', { n: d }) });
};
const ago = (t: number, now: number) => { const m = Math.round((now - t) / 6e4); return m <= 1 ? auditText('appText.usageBar.justNow') : auditText('appText.usageBar.ago', { time: m < 60 ? `${m} min` : `${Math.round(m / 60)} h` }); };

/** Cursor today as shown: "n/d", the exact $ of an export, or "≈ $" of the ledger estimate (with "±x%" when long). */
export function cursorText(u: Usage | null, long = false): string {
  if (u?.cursorTodayUsd == null) return 'n/d';
  if (u.cursorExact !== false) return formatCost(u.cursorTodayUsd);
  return `≈ ${formatCost(u.cursorTodayUsd)}${long && u.cursorMarginPct != null ? ` ±${u.cursorMarginPct}%` : ''}`;
}

function Meter({ pct, wide }: { pct: number | null | undefined; wide?: boolean }) {
  const tone = toneOf(pct);
  return (
    <span className={`ub-meter ${wide ? 'wide' : ''} tone-${tone}`} aria-hidden="true">
      <b style={{ width: pct == null ? 0 : `${Math.min(100, Math.max(3, pct))}%` }} />
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

function PlanRow({ title, pct, resets, now, testid }: { title: string; pct: number | null | undefined; resets: number | null | undefined; now: number; testid: string }) {
  return (
    <div className="ub-plan" data-testid={testid}>
      <div className="ub-plan-head">
        <span>{title}</span>
        <b className={`ub-plan-pct tone-${toneOf(pct)}`}>{pct == null ? 'n/d' : pctText(pct)}</b>
      </div>
      <Meter pct={pct} wide />
      <div className="ub-plan-foot">{pct == null ? auditText('auditExpression.UsageBar.text216') : resets ? auditText('auditExpression.UsageBar.text217', { v0: dayKey(resets) === dayKey(now) ? auditText('auditExpression.UsageBar.text218') : '', v1: resetAt(resets, now), v2: inTime(resets, now) }) : auditText('auditExpression.UsageBar.text219')}</div>
    </div>
  );
}

/** chats shown in the popup before "Tutte" */
const POP_ROWS = 8;

function Details({ usage, chats, now, close }: { usage: Usage | null; chats: ChatSummary[]; now: number; close: () => void }) {
  const total = liveTotal(usage, chats);
  const rows = costRows(usage, chats);
  return (
    <div className="ub-pop">
      <section className="ub-sec">
        <div className="ub-sec-head"><span>{auditText('audit.UsageBar.todaySSpending')}</span>{usage?.costAt ? <small data-tip={auditText('auditExpression.UsageBar.text220', { v0: hhmm(usage.costAt) })}>{auditText('audit.UsageBar.live')}</small> : usage?.at ? <small>{auditText('audit.UsageBar.updated')}{' '}{ago(usage.at, now)}</small> : null}</div>
        <div className="ub-total" data-testid="usage-pop-total">{total ? `${total.estimated ? '≈ ' : ''}${formatCost(total.usd)}` : 'n/d'}</div>
        <div className="ub-rows">
          <div className="ub-row"><HarnessMark harness="claude" size={16} /><span className="ub-label">Claude</span><b>{usage?.costKnown === false ? 'n/d' : formatCost(usage?.todayUsd ?? 0)}</b></div>
          <div className="ub-row"><HarnessMark harness="cursor" size={16} /><span className="ub-label">Cursor</span>{usage?.cursorExact === false ? <span className="ub-tag" data-testid="usage-pop-cursor-est">{auditText('audit.UsageBar.estimate')}</span> : null}<b>{cursorText(usage, true)}</b></div>
        </div>
        <p className="ub-note">{usage?.costKnown === false ? usage.costNote : auditText('auditExpression.UsageBar.text222')}</p>
        {usage?.cursorNote ? <p className="ub-note">{usage.cursorNote}</p> : null}
      </section>
      <section className="ub-sec">
        <div className="ub-sec-head"><span><HarnessMark harness="claude" size={16} />{' '}{auditText('audit.UsageBar.claudePlan')}</span>{usage?.limitsAt ? <small>{auditText('audit.UsageBar.read')}{' '}{ago(usage.limitsAt, now)}</small> : null}</div>
        <PlanRow title={auditText('audit.UsageBar.5HourWindow')} pct={usage?.fiveHourPct} resets={usage?.fiveHourResetsAt} now={now} testid="usage-pop-5h" />
        <PlanRow title={auditText('audit.UsageBar.week')} pct={usage?.weekPct} resets={usage?.weekResetsAt} now={now} testid="usage-pop-week" />
        {usage?.fiveHourPct == null && usage?.weekPct == null && usage?.limitsNote ? <p className="ub-note">{usage.limitsNote}</p> : null}
      </section>
      <section className="ub-sec">
        <div className="ub-sec-head"><span><HarnessMark harness="cursor" size={16} />{' '}{auditText('audit.UsageBar.cursorPlan')}</span></div>
        <div className="ub-na" data-testid="usage-pop-cursor"><b>{auditText('audit.UsageBar.unavailable')}</b><span>{usage?.cursorPlanNote ?? auditText('auditExpression.UsageBar.text223')}</span></div>
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
  const now = useNow(30_000);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const list = chatList(chats);
  const total = liveTotal(usage, list);
  const tip = [
    total ? auditText(total.partial ? 'cmp.usage.todayPartial' : 'cmp.usage.today', { cost: `${total.estimated ? '≈ ' : ''}${formatCost(total.usd)}` }) : auditText('cmp.usage.todayUnavailable'),
    usage?.cursorTodayUsd != null ? `Cursor ${cursorText(usage, true)}${usage.cursorExact === false ? auditText('cmp.usage.estimateSuffix') : ''}` : null,
    usage?.fiveHourPct != null ? auditText('cmp.usage.fiveHour', { pct: pctText(usage.fiveHourPct) }) : null,
    usage?.weekPct != null ? auditText('cmp.usage.week', { pct: pctText(usage.weekPct) }) : null,
    auditText('cmp.usage.cursorPlanUnavailable'),
  ].filter(Boolean).join(' · ');
  return (
    <>
      <button ref={ref} type="button" className="usagebar" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="dialog" aria-label={auditText('auditExpression.UsageBar.text226', { v0: tip })} data-tip={tip} data-testid="usage">
        <span className="ub-today"><span className="ub-k">{auditText('audit.UsageBar.today')}</span><b className="ub-v" data-testid="usage-today">{total ? `${total.estimated ? '≈ ' : ''}${formatCost(total.usd)}` : 'n/d'}</b></span>
        <span className="ub-sep" />
        <span className="ub-group" data-testid="usage-claude">
          <HarnessMark harness="claude" size={16} />
          <Window label="5h" pct={usage?.fiveHourPct} resets={usage?.fiveHourResetsAt} now={now} testid="usage-5h" />
          <Window label="7g" pct={usage?.weekPct} resets={usage?.weekResetsAt} now={now} testid="usage-week" />
        </span>
        <span className="ub-sep" />
        <span className="ub-group" data-testid="usage-cursor">
          <HarnessMark harness="cursor" size={16} />
          <span className="ub-pill" data-testid="usage-cursor-value">{cursorText(usage)}</span>
        </span>
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} testid="usage-pop" width={360}>
        <Details usage={usage} chats={list} now={now} close={() => setOpen(false)} />
      </Popover>
    </>
  );
}
