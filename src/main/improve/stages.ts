// "Migliora l'app" (ADR 0020), the pure part: from what git, the releases folder and the launcher say, the stage of each
// branch (in lavoro → testata → approvata → in uso), what "Aggiorna" would take and whether it may, and how the last
// start went (the new version, or back to the previous one and why). No I/O here, so the unit tests cover every case;
// service.ts reads the inputs and calls these. Used by improve/service.ts.
import type { ImproveBranch, ImproveLaunch, ImproveStage } from '../../shared/contract';

export interface RefRow { name: string; sha: string; at: number; subject: string }
/** <git-common-dir>/sb-checks.json, written by scripts/check-pass.mjs after a green check on a clean tree: kind
 *  'light' = `npm run check:branch`, 'full' = `npm run check` (entries written before ADR 0027 have no kind: full) */
export type Checks = Record<string, { at: string; kind?: 'light' | 'full' }>;
export interface ReleaseState { current: string | null; previous: string | null; bad: string[]; history?: { id: string }[] }

const BRANCH_DAYS = 14;
const MAX_BRANCHES = 20;

/** "0.1.0-91967ec" → "91967ec" (null for 'dev' or anything else). */
export function shaOfRelease(id: string | null | undefined): string | null {
  const m = /-([0-9a-f]{7,40})$/.exec(id ?? '');
  return m ? m[1]! : null;
}

/** The green check of a commit (full or short sha), as ms; null when none. kind 'full': only a full check counts
 *  (main's tip before "Aggiorna"); otherwise a light one does too (a branch, before it is merged). */
export function checkAt(checks: Checks, sha: string, kind?: 'full'): number | null {
  const hit = checks[sha] ?? Object.entries(checks).find(([k]) => k.startsWith(sha) || sha.startsWith(k))?.[1];
  if (hit && kind === 'full' && (hit.kind ?? 'full') !== 'full') return null;
  const t = hit ? Date.parse(hit.at) : NaN;
  return Number.isFinite(t) ? t : null;
}

/** Each recent branch with its stage. merged = branches whose tip is in main; inUse = branches whose tip is in the
 *  version in use (both from `git branch --merged <ref>`). worktreeChat: the app chat working on a branch. */
export function branchStages(o: {
  refs: RefRow[]; main: string; mainSha?: string | null; merged: ReadonlySet<string>; inUse: ReadonlySet<string> | null; checks: Checks; now: number;
  chatOf?: (branch: string) => { id: string; title: string } | null;
}): ImproveBranch[] {
  const since = o.now - BRANCH_DAYS * 86_400_000;
  return o.refs
    .filter(r => r.name !== o.main && r.at >= since)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_BRANCHES)
    .map(r => {
      const ck = checkAt(o.checks, r.sha);
      // a branch just created from main (tip = main's tip, nothing of its own yet, never checked) is work, not merged
      const fresh = r.sha === o.mainSha && !ck;
      const stage: ImproveStage = fresh ? 'work' : o.inUse?.has(r.name) ? 'promoted' : o.merged.has(r.name) ? 'approved' : ck ? 'tested' : 'work';
      const chat = o.chatOf?.(r.name) ?? null;
      return { name: r.name, sha: r.sha.slice(0, 7), subject: r.subject, at: r.at, stage, checkAt: ck, ...(chat ? { chatId: chat.id, chatTitle: chat.title } : {}) };
    });
}

/** Whether "Aggiorna" may run now, and the Italian reason when not. */
export function promoteGate(o: {
  stable: boolean; repo: string | null; repoProblem: string | null; branch: string | null; main: string; dirty: boolean;
  mainSha: string | null; runningSha: string | null; busy: boolean; node: boolean; failedBefore?: boolean;
  /** main's tip passed the full `npm run check` (a light check of a branch is not enough to promote, ADR 0027) */
  mainChecked: boolean;
}): { ok: boolean; why: string } {
  const no = (why: string) => ({ ok: false, why });
  if (o.busy) return no('Aggiornamento in corso.');
  if (!o.stable) return no("Si aggiorna solo dall'app stabile (questa è la versione di sviluppo).");
  if (!o.repo) return no(o.repoProblem ?? "Imposta la cartella del codice dell'app nelle Impostazioni.");
  if (o.repoProblem) return no(o.repoProblem);
  if (!o.node) return no('Serve Node.js installato: i test dell’aggiornamento girano con npm.');
  if (o.branch !== o.main) return no(`La cartella del codice è sul ramo «${o.branch ?? '?'}»: l’aggiornamento prende «${o.main}».`);
  if (o.dirty) return no('Nella cartella del codice ci sono modifiche non salvate in un commit.');
  if (!o.mainSha) return no(`Il ramo «${o.main}» non si legge.`);
  if (o.runningSha && o.mainSha.startsWith(o.runningSha)) return no('Niente di nuovo: questa versione è già in uso.');
  if (!o.mainChecked) return no(`«${o.main}» non ha ancora passato i test completi: la Regia dell’app lancia \`npm run check\` su ${o.main}, poi aggiorni.`);
  if (o.failedBefore) return no('Questa versione non è partita all’ultimo avvio: la Regia dell’app la corregge, poi aggiorni.');
  return { ok: true, why: '' };
}

/** <base>/launch-result.json, written by the launcher (scripts/release.mjs launch) after every start */
export interface LaunchResult {
  at: string; wanted: string | null; started: string | null;
  attempts?: { id: string; outcome: string; reason?: string }[];
}
/** <userData>/improve-seen.json: the version this app saw at its last start, and the discarded one it already told
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
export function launchOutcome(o: { running: string; stable: boolean; state: ReleaseState; result: LaunchResult | null; seen: Seen | null; now: number }): ImproveLaunch | null {
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
export function nextSeen(running: string, launch: ImproveLaunch | null, seen: Seen | null, now: number): Seen {
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
