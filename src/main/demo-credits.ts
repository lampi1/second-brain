// Demo cases of the credit rule (ADR 0354), for the screenshots of the thread «Far seguire ai limiti dei motori i dati
// veri»: SB_DEMO_CREDITS=stop|morning|wait|moved seeds the demo with fake usage readings and credit facts, and the
// limits panel reads the real rule through the real wiring (agents/credit-live.ts) with a book in the demo's profile.
// stop    = six limit errors on OpenCode/OpenAI a moment ago, an old reading: a short pause, «Riprova ora»
// morning = the old 24-hour pause in credits.json (version 1) and a fresh 5h 0% · 7d 31% reading: free, the chat on Sol
// wait    = Claude's 5 hours spent: a Scout stopped by the limit, its move to the same level announced with «Annulla»
// moved   = the same Scout gone on on OpenCode in a linked chat, the move said in both chats
// Nothing here runs outside the demo (demo-wiring.ts calls it only with SB_DEMO=1).
import fs from 'node:fs';
import path from 'node:path';
import type { ChatItem, ChatSummary, Usage } from '../shared/contract';
import { sysEn, type SysCode, type SysParams } from '../shared/sys';
import { clock } from '../shared/credit-rule';
import { creditLive, type CreditUsage } from './agents/credit-live';
import type { Seed } from './demo';

export type DemoCreditCase = 'stop' | 'morning' | 'wait' | 'moved';
const MIN = 60e3, HOUR = 60 * MIN;
const SOL = 'openai/gpt-5.5';
const LIMIT = 'The usage limit has been reached';

export function demoCreditCase(env = process.env.SB_DEMO_CREDITS): DemoCreditCase | null {
  return env === 'stop' || env === 'morning' || env === 'wait' || env === 'moved' ? env : null;
}

const sys = (id: string, at: number, code: SysCode, params: SysParams, level: 'info' | 'warn' = 'info'): ChatItem => ({ kind: 'system', id, at, level, code, params, text: sysEn(code, params) });

/** Seeds the case into the demo's chats, items and usage; returns the panel's decoration (the real rule). */
export function applyDemoCredits(s: Seed, mode: DemoCreditCase, E: number, userData: string): (u: Usage) => Usage {
  const opencode = s.usage.harnesses!.find(h => h.harness === 'opencode')!;
  const claude = s.usage.harnesses!.find(h => h.harness === 'claude')!;
  opencode.pool = 'opencode:openai'; claude.pool = 'claude';
  const base = s.chats.find(c => c.id === 'fix')!;
  const scout = (p: Partial<ChatSummary>): ChatSummary => ({ ...base, id: 'scout-log', title: 'Scout · Log', state: 'idle', costUsd: 0.4, workMs: 4 * MIN, agentChildren: undefined, browserTabIds: [],
    agent: { id: 'scout', name: 'Scout', purpose: '', engine: 'opencode', model: SOL, revision: 1, version: 1, source: 'catalog' }, lastText: 'Leggo i log del servizio ordini.', ...p });
  const file = path.join(userData, 'credits.json');
  if (mode === 'stop') {
    opencode.at = E - 12 * MIN;
    opencode.windows = [{ kind: 'five-hour', label: '5h', usedPercent: 62, resetsAt: E + 3 * HOUR }, { kind: 'weekly', label: '7g', usedPercent: 31, resetsAt: E + 80 * HOUR }];
    s.chats.unshift(scout({ harness: 'opencode', model: SOL, updatedAt: E - 30e3, creditWait: { at: E - 30e3, model: SOL, card: `opencode:${SOL}` } }));
    s.items['scout-log'] = [
      ...Array.from({ length: 6 }, (_, i): ChatItem => ({ kind: 'system', id: `sl-e${i}`, at: E - 3 * MIN + i * 36e3, level: 'error', text: LIMIT })),
      sys('sl-w', E - 30e3, 'creditWait', { role: 'Scout', model: `${SOL} (opencode)` }, 'warn'),
    ];
  }
  if (mode === 'morning') {
    fs.writeFileSync(file, JSON.stringify({ version: 1, pools: [{ pool: 'opencode:openai', status: 'exhausted', at: E - 11 * HOUR, resetsAt: null, coolMs: 86400000 }] }));
    opencode.at = E - MIN;
    opencode.windows = [{ kind: 'five-hour', label: '5h', usedPercent: 0, resetsAt: E + 5 * HOUR }, { kind: 'weekly', label: '7g', usedPercent: 31, resetsAt: E + 80 * HOUR }];
    s.chats.unshift(scout({ harness: 'opencode', model: SOL, state: 'running', updatedAt: E - 20e3 }));
    s.items['scout-log'] = [{ kind: 'user', id: 'sl-u', at: E - 40e3, text: 'Leggi i log del servizio ordini e trova la causa degli errori 500.' } as ChatItem,
      { kind: 'assistant', id: 'sl-a', at: E - 20e3, text: 'Parto dai log di stanotte.' } as ChatItem];
  }
  if (mode === 'wait' || mode === 'moved') {
    claude.at = E - MIN;
    s.usage.fiveHourPct = 100; s.usage.fiveHourResetsAt = E + 2 * HOUR;
    claude.windows = [{ kind: 'five-hour', label: '5h', usedPercent: 100, resetsAt: E + 2 * HOUR }, { kind: 'weekly', label: '7g', usedPercent: 54, resetsAt: E + 90 * HOUR }];
    opencode.at = E - MIN;
    opencode.windows = [{ kind: 'five-hour', label: '5h', usedPercent: 8, resetsAt: E + 4 * HOUR }, { kind: 'weekly', label: '7g', usedPercent: 31, resetsAt: E + 80 * HOUR }];
    const back = clock(E + 2 * HOUR, E);
    const note = { from: 'claude-sonnet-4-6 (claude)', to: `${SOL} (opencode)`, level: 'Base', why: `claude-sonnet-4-6 (claude) saltato: credito finito, 5h al 100%, torna alle ${back}` };
    const old = scout({ harness: 'claude', model: 'claude-sonnet-4-6', agent: { id: 'scout', name: 'Scout', purpose: '', engine: 'claude', model: 'claude-sonnet-4-6', revision: 1, version: 1, source: 'catalog' }, updatedAt: E - 20e3 });
    const before: ChatItem[] = [
      { kind: 'user', id: 'sl-u', at: E - 5 * MIN, text: 'Leggi i log del servizio ordini e trova la causa degli errori 500.' } as ChatItem,
      { kind: 'assistant', id: 'sl-a', at: E - 4 * MIN, text: 'Ho letto metà dei log: gli errori partono alle 02:14.' } as ChatItem,
      { kind: 'system', id: 'sl-e', at: E - MIN, level: 'error', text: 'Claude AI usage limit reached' },
      sys('sl-w', E - MIN, 'creditWait', { role: 'Scout', model: 'claude-sonnet-4-6 (claude)' }, 'warn'),
    ];
    if (mode === 'wait') {
      const card = `opencode:${SOL}`;
      s.chats.unshift({ ...old, creditWait: { at: E - MIN, model: 'claude-sonnet-4-6', card: 'claude:claude-sonnet-4-6', next: { card, at: E + 6e3 } } });
      s.items['scout-log'] = [...before, sys('sl-soon', E - 2e3, 'creditSwitchSoon', { to: SOL, engine: 'OpenCode', secs: 8, card, from: note.from, level: note.level, why: note.why })];
    } else {
      const next: ChatSummary = scout({ id: 'scout-log-2', harness: 'opencode', model: SOL, state: 'running', updatedAt: E - 5e3, continuedFrom: { id: 'scout-log', at: E - 10e3 } as never, creditMoved: { at: E - 10e3, ...note }, lastText: 'Riprendo dai log delle 02:14.' });
      s.chats.unshift(next, { ...old, state: 'closed', continuedBy: { id: 'scout-log-2', at: E - 10e3 } as never, creditMoved: { at: E - 10e3, ...note } });
      s.items['scout-log'] = [...before, sys('sl-m', E - 10e3, 'creditMoved', note)];
      s.items['scout-log-2'] = [sys('sl2-m', E - 10e3, 'creditMoved', note), { kind: 'assistant', id: 'sl2-a', at: E - 5e3, text: 'Riprendo dai log delle 02:14: il resto è già letto.' } as ChatItem];
    }
  }
  const usage: CreditUsage = {
    usageReading: pool => s.usage.harnesses!.find(h => h.pool === pool),
    decorateUsage: fn => { decorate = fn; },
  };
  let decorate: (u: Usage) => Usage = u => u;
  const live = creditLive({ file, usage, changed: () => {}, now: () => E, later: () => ({ cancel() {} }) });
  if (mode === 'stop') for (let i = 0; i < 6; i++) live.book.observe('opencode', SOL, LIMIT, true, E - 3 * MIN + i * 36e3 - 20e3);
  return u => decorate(u);
}

