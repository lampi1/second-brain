// What happened while the user was away («Modalità notte», ADR 0191): every choice the app made for him (a recommended
// answer, a plan or a workflow proposal approved) and every request it left for his return (a permission refused and
// parked), so the recap he gets when he turns the mode off says it all in one place, without opening the chats. Kept in
// userData/away-log.json so a restart in the night loses nothing; bounded (MAX entries, the oldest go). Built by
// wiring.ts, written by ChatManager (onAway) and workflows/tools.ts; read once by recapOf when the mode goes off.
// Pinned by test/unit/away.test.ts.
import { errText, log } from '../log';
import { readLocal, writeLocal } from '../agents/local-store';

export type AwayKind = 'picked' | 'parked' | 'plan' | 'proposal';
export interface AwayEntry { at: number; kind: AwayKind; chatId?: string; title: string; text: string }
interface Saved { since: number | null; entries: AwayEntry[] }

const MAX = 200;
const cut = (s: string, n: number): string => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export class AwayLog {
  private state: Saved | null = null;
  constructor(private readonly file: string, private readonly now: () => number = Date.now) {}

  private load(): Saved {
    if (this.state) return this.state;
    let s: Saved = { since: null, entries: [] };
    try {
      const raw = readLocal(this.file) as Partial<Saved> | undefined;
      if (raw && Array.isArray(raw.entries)) s = { since: typeof raw.since === 'number' ? raw.since : null, entries: raw.entries.filter(e => e && typeof e.text === 'string').slice(-MAX) };
    } catch (e) { log.warn('away', 'night log not read', { cause: errText(e), hint: 'the recap starts empty; the file is kept as it was' }); }
    return (this.state = s);
  }

  private save(): void {
    try { writeLocal(this.file, this.load()); } catch (e) { log.warn('away', 'night log not saved', { cause: errText(e), hint: 'check that userData is writable; the recap keeps what is in memory' }); }
  }

  /** When the mode went on (null = off). */
  since(): number | null { return this.load().since; }

  /** The mode went on: a new night (a night whose recap never found an Orchestrator keeps its entries). */
  start(): void { const s = this.load(); if (s.since !== null) return; this.state = { since: this.now(), entries: s.entries }; this.save(); }

  add(e: Omit<AwayEntry, 'at'>): void {
    const s = this.load();
    s.entries = [...s.entries, { ...e, title: cut(e.title, 80), text: cut(e.text, 240), at: this.now() }].slice(-MAX);
    this.save();
  }

  /** What the night held so far. */
  peek(): { since: number | null; entries: AwayEntry[] } { const s = this.load(); return { since: s.since, entries: [...s.entries] }; }

  /** The mode went off: what the night held, once; the log starts empty next time. */
  finish(): { since: number | null; entries: AwayEntry[] } {
    const s = this.load(), out = { since: s.since, entries: s.entries };
    this.state = { since: null, entries: [] };
    this.save();
    return out;
  }
}

const LABEL: Record<AwayKind, string> = { picked: 'Scelto il consigliato', plan: 'Piano approvato', proposal: 'Proposta approvata', parked: 'Lasciato per te' };

/** The recap shown in the Orchestrator's chat when the user is back: what the app chose for him, then what waits for
 *  him (the parked requests and the ones still open now). Plain Italian, at most ~20 lines. */
export function recapOf(night: { since: number | null; entries: AwayEntry[] }, open: { title: string; what: string }[], now = Date.now()): string {
  const hours = night.since !== null ? Math.max(0, Math.round((now - night.since) / 360_000) / 10) : null;
  const chosen = night.entries.filter(e => e.kind !== 'parked'), parked = night.entries.filter(e => e.kind === 'parked');
  const line = (e: AwayEntry) => `- ${LABEL[e.kind]} · «${e.title}»: ${e.text}`;
  const list = (xs: string[], n: number) => xs.length > n ? [...xs.slice(0, n), `- … e altre ${xs.length - n}`] : xs;
  const out = [`Modalità notte spenta${hours !== null ? ` dopo ${String(hours).replace('.', ',')} h` : ''}.`];
  out.push(chosen.length ? `Scelte prese dall’app al posto tuo (la consigliata): ${chosen.length}.` : 'Nessuna scelta presa al posto tuo.');
  out.push(...list(chosen.map(line), 8));
  const waiting = [...parked.map(line), ...open.map(o => `- Ancora aperto · «${o.title}»: ${o.what}`)];
  if (waiting.length) out.push('Aspettano te:', ...list(waiting, 8));
  else out.push('Niente aspetta te.');
  return out.join('\n');
}

/** What attachAway needs: the chats (ChatManager), the setting's changes and Electron's powerSaveBlocker. */
export interface AwayDeps {
  on(): boolean;
  log: AwayLog;
  chats: { settleForAway(): number; openForUser(): { title: string; what: string }[]; awayRecap(text: string): boolean };
  onSettingChange(fn: (c: { key: string }) => void): unknown;
  blocker: { start(type: 'prevent-app-suspension'): number; stop(id: number): void };
  /** wait before the recap is tried again when no Orchestrator was open (default 60 s) */
  retryMs?: number;
}
/** how many times a recap with no Orchestrator open is tried again (about ten minutes) */
const RECAP_TRIES = 10;

/** The mode's life (wiring.ts): on = a new night log, what already waits is settled, the PC may not sleep (the work goes on
 *  all night; the screen may still turn off); off = the recap in the Orchestrator's chat and sleep allowed again. A
 *  restart with the mode on keeps the night going. */
export function attachAway(d: AwayDeps): void {
  let blockId: number | null = null, tries = 0;
  const awake = (want: boolean) => {
    if (want && blockId === null) blockId = d.blocker.start('prevent-app-suspension');
    else if (!want && blockId !== null) { d.blocker.stop(blockId); blockId = null; }
  };
  const went = (on: boolean) => {
    awake(on);
    if (on) { tries = 0; d.log.start(); d.chats.settleForAway(); log.info('away', 'night mode on'); return; }
    if (d.log.since() === null) return;
    // the log is emptied only once the recap is in an Orchestrator's chat; else it waits for the next start
    const placed = d.chats.awayRecap(recapOf(d.log.peek(), d.chats.openForUser()));
    if (placed) d.log.finish();
    else if (tries++ < RECAP_TRIES) setTimeout(() => { if (!d.on()) went(false); }, d.retryMs ?? 60_000).unref?.();
    log.info('away', 'night mode off', { data: { recap: placed } });
  };
  if (d.on()) { awake(true); d.log.start(); }
  else if (d.log.since() !== null) went(false); // turned off while the app was closed: the recap is still due
  d.onSettingChange(c => { if (c.key === 'awayMode') went(d.on()); });
}
