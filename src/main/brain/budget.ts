// Spending limits (the user, 2026-10-11: a limit they can switch off, per day and optionally per chat, separate for Claude
// and Cursor). evaluateBudget() is pure: settings + current spend → thresholds crossed (80 % and 100 %). BudgetWatcher
// remembers what it already reported (userData/budget-state.json), so each threshold is reported once per day / chat /
// plan window. The module NEVER stops or interrupts anything: it reports a 'budget:alert' (and a feed event); with mode
// 'ask' the chat manager turns it into a "stop or continue?" question to the user. Sources: Claude $ at list price from
// cost.mjs (an equivalent cost on a subscription) plus the plan's 5 h / 7 d windows when known; Cursor only from its
// usage export (else unknown: no alert, never a guess). Used by brain/index.ts after every usage refresh.
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { BudgetAlert, BudgetSettings, Harness } from '../../shared/contract';
import { uiLocale } from '../locale';

export interface ChatSpend { id: string; title: string; usd: number }
export interface Spend {
  day: string; // Rome day (YYYY-MM-DD): the window of 'day' and 'chat' thresholds
  claude: { dayUsd: number | null; chats: ChatSpend[]; fiveHourPct: number | null; fiveHourResetsAt: number | null; weekPct: number | null; weekResetsAt: number | null };
  cursor: { dayUsd: number | null; chats: ChatSpend[] };
}
export type Crossing = Omit<BudgetAlert, 'id' | 'at'> & { key: string };

const HN: Record<Harness, string> = { claude: 'Claude', cursor: 'Cursor' };
const money = (v: number) => `${v >= 100 ? Math.round(v) : v.toFixed(v >= 10 ? 0 : 2)} $`;
const hhmm = (t: number) => new Intl.DateTimeFormat(uiLocale(), { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }).format(new Date(t));
const level = (pct: number): 80 | 100 | null => (pct >= 100 ? 100 : pct >= 80 ? 80 : null);
// A plan window is identified by its reset time rounded to the minute: Claude reports it with the server's clock
// fraction (…:00.231987 one read, …:00.845 the next) or in whole seconds (stream), all the same window.
const win = (resetsAt: number | null, day: string) => (resetsAt ? String(Math.round(resetsAt / 6e4)) : day);
// Keys hold the limit and the mode too: a raised limit, or warn → ask, is a new decision and alerts again.

export function evaluateBudget(b: BudgetSettings, s: Spend): Crossing[] {
  if (!b.enabled) return [];
  const out: Crossing[] = [];
  for (const h of ['claude', 'cursor'] as const) {
    const lim = b[h];
    if (lim.mode === 'off') continue;
    const mode = lim.mode;
    const sp = s[h];
    const listPrice = h === 'claude' ? ', a prezzo di listino' : '';
    if (lim.dailyUsd && sp.dayUsd !== null) {
      const pct = (100 * sp.dayUsd) / lim.dailyUsd, th = level(pct);
      if (th) out.push({ key: `day|${h}|${s.day}|${lim.dailyUsd}|${mode}|${th}`, harness: h, scope: 'day', pct, threshold: th, usd: sp.dayUsd, limitUsd: lim.dailyUsd, mode,
        text: `${HN[h]} oggi: ${Math.round(pct)}% del limite giornaliero (${money(sp.dayUsd)} di ${money(lim.dailyUsd)}${listPrice})` });
    }
    if (lim.perChatUsd) {
      for (const c of sp.chats) {
        const pct = (100 * c.usd) / lim.perChatUsd, th = level(pct);
        if (th) out.push({ key: `chat|${h}|${c.id}|${s.day}|${lim.perChatUsd}|${mode}|${th}`, harness: h, scope: 'chat', chatId: c.id, chatTitle: c.title, pct, threshold: th, usd: c.usd, limitUsd: lim.perChatUsd, mode,
          text: `Chat "${c.title}": ${Math.round(pct)}% del limite per chat (${money(c.usd)} di ${money(lim.perChatUsd)}${listPrice})` });
      }
    }
    if (h === 'claude') {
      const c = s.claude;
      if (c.fiveHourPct !== null) {
        const th = level(c.fiveHourPct);
        if (th) out.push({ key: `fiveHour|claude|${win(c.fiveHourResetsAt, s.day)}|${mode}|${th}`, harness: 'claude', scope: 'fiveHour', pct: c.fiveHourPct, threshold: th, usd: null, limitUsd: null, mode,
          text: `Piano Claude: ${Math.round(c.fiveHourPct)}% della finestra di 5 ore${c.fiveHourResetsAt ? ` (si azzera alle ${hhmm(c.fiveHourResetsAt)})` : ''}` });
      }
      if (c.weekPct !== null) {
        const th = level(c.weekPct);
        if (th) out.push({ key: `week|claude|${win(c.weekResetsAt, s.day)}|${mode}|${th}`, harness: 'claude', scope: 'week', pct: c.weekPct, threshold: th, usd: null, limitUsd: null, mode,
          text: `Piano Claude: ${Math.round(c.weekPct)}% del limite settimanale` });
      }
    }
  }
  return out;
}

/** Reports each crossing once (a 100 % first seen also silences its 80 %). State survives restarts. */
export class BudgetWatcher {
  private fired: string[] = [];

  constructor(private stateFile: string | null) {
    if (!stateFile) return;
    try { const j = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as unknown; if (Array.isArray(j)) this.fired = j.filter(x => typeof x === 'string'); } catch { /* first run */ }
  }

  check(b: BudgetSettings, s: Spend, now = Date.now()): BudgetAlert[] {
    const out: BudgetAlert[] = [];
    for (const c of evaluateBudget(b, s)) {
      if (this.fired.includes(c.key)) continue;
      this.fired.push(c.key);
      if (c.threshold === 100) { const k80 = c.key.replace(/\|100$/, '|80'); if (!this.fired.includes(k80)) this.fired.push(k80); }
      const { key: _key, ...rest } = c;
      out.push({ id: crypto.randomUUID(), at: now, ...rest });
    }
    if (out.length) {
      if (this.fired.length > 400) this.fired = this.fired.slice(-400);
      if (this.stateFile) try { fs.writeFileSync(this.stateFile, JSON.stringify(this.fired)); } catch { /* best effort */ }
    }
    return out;
  }
}
