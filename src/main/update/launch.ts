// The pure part of "Aggiorna" (Settings → Aggiornamenti, ADR 0075): how the last start went (the new version came up, or
// the launcher went back to the previous one and why), what to remember so a fallback is told once, and the step of a
// release.mjs run in Italian. No I/O here, so the unit tests cover every case; update/source.ts reads the inputs and
// calls these. Moved from the retired "Migliora l'app" section (ADR 0079). Used by update/source.ts.
import type { LaunchNotice } from '../../shared/contract';

export interface ReleaseState { current: string | null; previous: string | null; bad: string[]; history?: { id: string }[] }

/** "0.1.0-91967ec" → "91967ec" (null for 'dev' or anything else). */
export function shaOfRelease(id: string | null | undefined): string | null {
  const m = /-([0-9a-f]{7,40})$/.exec(id ?? '');
  return m ? m[1]! : null;
}

/** <base>/launch-result.json, written by the launcher (scripts/release.mjs launch) after every start */
export interface LaunchResult {
  at: string; wanted: string | null; started: string | null;
  attempts?: { id: string; outcome: string; reason?: string }[];
}
/** <userData>/launch-seen.json (improve-seen.json before ADR 0079): the version this app saw at its last start, and the discarded one it already told
 *  the user about (so a release that stays bad is announced once, not at every start) */
export interface Seen { running: string; at: number; fallbackOf?: string }

/** Italian, one line: why a release did not start, from the launcher's words (release.mjs launch() writes them in
 *  launch-result.json: "exited with code 1 after 4 s", "window not ready within 30 s", "marked bad by an earlier start"). */
export function reasonText(a: { outcome: string; reason?: string } | undefined): string {
  // an older launcher says nothing: it discards a release that exits or shows no window within 30 s
  if (!a) return 'il launcher l’ha scartata: si è chiusa o non ha aperto la finestra entro 30 secondi';
  const r = a.reason ?? '';
  const exited = /exited with code (-?\d+) after (\d+) s/.exec(r);
  if (exited) return `si è chiusa da sola dopo ${exited[2]} secondi (codice ${exited[1]})`;
  if (/not ready within/.test(r) || (a.outcome === 'bad' && !r)) return 'non ha aperto la finestra entro 30 secondi';
  if (a.outcome === 'skipped-bad' || /marked bad/.test(r)) return 'era già stata scartata a un avvio precedente';
  return r ? `non è partita (${r})` : 'non è partita';
}

/** How the start that brought up `running` went, compared with the last start this app saw. null = nothing to say
 *  (same version as last time, a fallback already told, a first start ever, or a dev build). */
export function launchOutcome(o: { running: string; stable: boolean; state: ReleaseState; result: LaunchResult | null; seen: Seen | null; now: number }): LaunchNotice | null {
  if (!o.stable) return null;
  const { running } = o;
  // the launcher's own record of this start: fresh (last 10 minutes) and about the release current.json wants now (the
  // launcher writes it after "ready", so at this point it may still be the record of the start before)
  const r = o.result && Date.parse(o.result.at) > o.now - 10 * 60_000 && o.result.wanted === o.state.current ? o.result : null;
  const wanted = o.state.current;
  if (wanted && wanted !== running) {
    const attempt = r?.attempts?.find(a => a.id === wanted);
    const failed = attempt?.outcome === 'bad' || attempt?.outcome === 'skipped-bad' || o.state.bad.includes(wanted);
    const told = o.seen?.running === running && o.seen.fallbackOf === wanted;
    if (failed && !told) {
      return { outcome: 'fallback', running, wanted, reason: reasonText(attempt), at: o.now };
    }
  }
  if (!o.seen || o.seen.running === running) return null;
  // back to an older release (rollback): not "the new version"
  const at = (id: string) => (o.state.history ?? []).map(h => h.id).lastIndexOf(id);
  if (at(o.seen.running) >= 0 && at(running) < at(o.seen.running)) return null;
  return { outcome: 'new', running, wanted: running, reason: '', at: o.now };
}

/** What to remember after this start. */
export function nextSeen(running: string, launch: LaunchNotice | null, seen: Seen | null, now: number): Seen {
  const fallbackOf = launch?.outcome === 'fallback' ? launch.wanted : seen?.running === running ? seen.fallbackOf : undefined;
  return { running, at: now, ...(fallbackOf ? { fallbackOf } : {}) };
}

/** The step of a promotion, in Italian, from the last meaningful line release.mjs printed. */
export function promoteStep(log: string): string {
  const lines = log.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!;
    if (/^promoted /.test(l)) return 'Versione pronta';
    if (/sharing|cookie encryption|build/i.test(l) && !/test/i.test(l)) return 'Copia della versione';
    if (/npm run test:stable/.test(l)) return 'Prova della versione stabile';
    if (/npm run check/.test(l)) return 'Test in corso (typecheck, lint, unit, e2e)';
  }
  return 'Avvio';
}
