// The usage strip in the top bar: today's spend, the Claude plan windows (5 hours and week, each with its reset time),
// Cursor and Kimi's tokens today (when Kimi is on this machine), always visible, with a detail panel on click. Why: the user wants their subscriptions' usage in sight at
// all times (2026-10-11), and an honest "n/d" with the reason where a number does not exist (Cursor's plan usage has no
// source; see Usage.cursorPlanNote). Data: the 'usage' snapshot from the main process (brain/usage.ts) and the chats'
// own costs (live estimate included). Used by TopBar.tsx.
import { useRef, useState } from 'react';
import type { ChatSummary, Usage } from '@shared/contract';
import { chatCost, formatCost, tokensShort, until } from '../lib/format';
import { useNow } from '../lib/clock';
import { useApp } from '../store/store';
import { HarnessMark } from './Icons';
import { Popover } from './ui';

type Tone = 'green' | 'amber' | 'red' | 'none';
const toneOf = (pct: number | null | undefined): Tone => (pct == null ? 'none' : pct >= 90 ? 'red' : pct >= 70 ? 'amber' : 'green');
const pctText = (pct: number) => `${Math.round(pct)}%`;

const hhmm = (t: number) => new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' }).format(new Date(t));
const dayKey = (t: number) => new Date(t).toDateString();
/** "18:40" today, "dom 18:40" tomorrow or later in the week, "12/10 18:40" further away. */
export function resetAt(t: number, now: number): string {
  if (dayKey(t) === dayKey(now)) return hhmm(t);
  const wd = new Intl.DateTimeFormat('it-IT', { weekday: 'short' }).format(new Date(t)).replace('.', '');
  if (t - now < 6.5 * 864e5) return `${wd} ${hhmm(t)}`;
  return `${new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit' }).format(new Date(t))} ${hhmm(t)}`;
}
/** "tra 2 h 13 min" within a day, "tra 4 g 1 h" beyond. */
const inTime = (t: number, now: number) => {
  const h = Math.floor((t - now) / 36e5);
  if (h < 24) return until(t, now);
  const d = Math.floor(h / 24), r = h % 24;
  return r ? `tra ${d} g ${r} h` : `tra ${d} g`;
};
const ago = (t: number, now: number) => { const m = Math.round((now - t) / 6e4); return m <= 1 ? 'adesso' : m < 60 ? `${m} min fa` : `${Math.round(m / 60)} h fa`; };

/** Today's total: Claude (cost.mjs) + Cursor (ledger estimate or export). null = not known; estimated = Cursor's part
 *  is an estimate. */
export function todayTotal(u: Usage | null): { usd: number; partial: boolean; estimated: boolean } | null {
  if (!u || u.costKnown === false) return null;
  return { usd: u.todayUsd + (u.cursorTodayUsd ?? 0), partial: u.cursorTodayUsd == null, estimated: u.cursorTodayUsd != null && u.cursorExact === false };
}

/** Kimi's model id as a name: "k3-256k" → "K3-256k"; others as they are ("kimi-for-coding"). */
const kimiModel = (m: string) => m.replace(/^k(\d)/, 'K$1');

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
      <div className="ub-plan-foot">{pct == null ? 'Nessun dato recente' : resets ? `Si azzera ${dayKey(resets) === dayKey(now) ? 'alle ' : ''}${resetAt(resets, now)} · ${inTime(resets, now)}` : 'Orario di azzeramento non noto'}</div>
    </div>
  );
}

function Details({ usage, chats, now }: { usage: Usage | null; chats: ChatSummary[]; now: number }) {
  const total = todayTotal(usage);
  const top = chats.filter(c => c.costUsd > 0 || c.costLiveUsd).sort((a, b) => b.costUsd - a.costUsd).slice(0, 4);
  return (
    <div className="ub-pop">
      <section className="ub-sec">
        <div className="ub-sec-head"><span>Spesa di oggi</span>{usage?.at ? <small>aggiornata {ago(usage.at, now)}</small> : null}</div>
        <div className="ub-total" data-testid="usage-pop-total">{total ? `${total.estimated ? '≈ ' : ''}${formatCost(total.usd)}` : 'n/d'}</div>
        <div className="ub-rows">
          <div className="ub-row"><HarnessMark harness="claude" size={16} /><span className="ub-label">Claude</span><b>{usage?.costKnown === false ? 'n/d' : formatCost(usage?.todayUsd ?? 0)}</b></div>
          <div className="ub-row"><HarnessMark harness="cursor" size={16} /><span className="ub-label">Cursor</span>{usage?.cursorExact === false ? <span className="ub-tag" data-testid="usage-pop-cursor-est">stima</span> : null}<b>{cursorText(usage, true)}</b></div>
        </div>
        <p className="ub-note">{usage?.costKnown === false ? usage.costNote : 'Claude a prezzo di listino API: sull’abbonamento è un costo equivalente, non una fattura.'}</p>
        {usage?.cursorNote ? <p className="ub-note">{usage.cursorNote}</p> : null}
      </section>
      <section className="ub-sec">
        <div className="ub-sec-head"><span><HarnessMark harness="claude" size={16} /> Piano Claude</span>{usage?.limitsAt ? <small>letto {ago(usage.limitsAt, now)}</small> : null}</div>
        <PlanRow title="Finestra di 5 ore" pct={usage?.fiveHourPct} resets={usage?.fiveHourResetsAt} now={now} testid="usage-pop-5h" />
        <PlanRow title="Settimana" pct={usage?.weekPct} resets={usage?.weekResetsAt} now={now} testid="usage-pop-week" />
        {usage?.fiveHourPct == null && usage?.weekPct == null && usage?.limitsNote ? <p className="ub-note">{usage.limitsNote}</p> : null}
      </section>
      <section className="ub-sec">
        <div className="ub-sec-head"><span><HarnessMark harness="cursor" size={16} /> Piano Cursor</span></div>
        <div className="ub-na" data-testid="usage-pop-cursor"><b>Non disponibile</b><span>{usage?.cursorPlanNote ?? 'Cursor non espone l’uso del piano.'}</span></div>
      </section>
      {usage?.kimi ? (
        <section className="ub-sec" data-testid="usage-pop-kimi">
          <div className="ub-sec-head"><span><HarnessMark harness="kimi" size={16} /> Kimi oggi</span>{usage.kimi.lastAt ? <small>ultimo turno {ago(usage.kimi.lastAt, now)}</small> : null}</div>
          <div className="ub-total" data-testid="usage-pop-kimi-total">{usage.kimi.tokens ? `${tokensShort(usage.kimi.tokens)} token` : 'Nessun turno oggi'}</div>
          {usage.kimi.tokens ? (
            <div className="ub-rows">
              {usage.kimi.models.slice(0, 4).map(m => <div key={m.model} className="ub-row"><span className="ub-label">{kimiModel(m.model)}</span><b>{tokensShort(m.tokens)}</b></div>)}
              <div className="ub-row"><span className="ub-label">di cui letti dalla cache</span><b>{tokensShort(usage.kimi.cacheRead)}</b></div>
            </div>
          ) : null}
          <div className="ub-na"><b>Quota del piano non disponibile</b><span>{usage.kimi.planNote}</span></div>
        </section>
      ) : null}
      {top.length > 0 && (
        <section className="ub-sec">
          <div className="ub-sec-head"><span>Chat aperte</span><small>da quando l’app è aperta</small></div>
          <div className="ub-rows">
            {top.map(c => (
              <div key={c.id} className="ub-row"><HarnessMark harness={c.harness} regia={c.isRegia} size={16} /><span className="ub-label ub-chat">{c.title}</span><b>{chatCost(c)}</b></div>
            ))}
          </div>
          {top.some(c => c.costLiveUsd) ? <p className="ub-note">≈ turno in corso: stima dai token, corretta col costo reale ogni pochi minuti e alla fine del turno.</p> : null}
        </section>
      )}
    </div>
  );
}

export function UsageBar() {
  const usage = useApp(s => s.usage);
  const chats = useApp(s => s.chats);
  const now = useNow(30_000);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const total = todayTotal(usage);
  const list = Object.values(chats);
  const tip = [
    total ? `Oggi ${total.estimated ? '≈ ' : ''}${formatCost(total.usd)}${total.partial ? ' (Cursor escluso: sconosciuto)' : ''}` : 'Spesa di oggi non disponibile',
    usage?.cursorTodayUsd != null ? `Cursor ${cursorText(usage, true)}${usage.cursorExact === false ? ' (stima)' : ''}` : null,
    usage?.fiveHourPct != null ? `5 ore al ${pctText(usage.fiveHourPct)}` : null,
    usage?.weekPct != null ? `settimana al ${pctText(usage.weekPct)}` : null,
    'Cursor: uso del piano non disponibile',
    usage?.kimi ? `Kimi oggi ${tokensShort(usage.kimi.tokens)} token` : null,
  ].filter(Boolean).join(' · ');
  return (
    <>
      <button ref={ref} type="button" className="usagebar" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="dialog" aria-label={`Utilizzo: ${tip}`} data-tip={tip} data-testid="usage">
        <span className="ub-today"><span className="ub-k">Oggi</span><b className="ub-v" data-testid="usage-today">{total ? `${total.estimated ? '≈ ' : ''}${formatCost(total.usd)}` : 'n/d'}</b></span>
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
        {usage?.kimi ? (
          <>
            <span className="ub-sep" />
            <span className="ub-group" data-testid="usage-kimi">
              <HarnessMark harness="kimi" size={16} />
              <span className="ub-pill" data-testid="usage-kimi-value">{tokensShort(usage.kimi.tokens)} tok</span>
            </span>
          </>
        ) : null}
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} testid="usage-pop" width={360}>
        <Details usage={usage} chats={list} now={now} />
      </Popover>
    </>
  );
}
