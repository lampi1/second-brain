// The Miglioramento page's data and words (ADR 0030): /api/improve (the brain's ops/improve/improve.mjs status, one row
// per policy of the shared self-improvement loop) normalized defensively, and every number turned into a plain Italian
// line with its n: the typical error (× between estimate and truth, median of the last ones), how often the 80% range
// held, what a proposal gains on the shared items (paired bootstrap, 90% interval), the after-check of the last change.
// DOM-free, unit-tested (test/unit/brain-ui/learn.test.ts); used by pages/Miglioramento.tsx.

export interface Diff { mean: number; lo: number; hi: number }
export interface LearnProposal { id: string; kind: 'cambio' | 'ripristino'; name: string; at: string; shared: number | null; diff: Diff | null }
export interface LearnCheck { state: string; n: number | null; need: number | null; at: string | null }
/** No after-check yet for a version that replaced another: the brain writes one only once it has its 20 cases. */
export const WAITING = `in attesa dei primi ${20} casi dopo il cambio`;
export interface LearnPolicy {
  domain: string; version: number | null; appliedAt: string | null; by: string | null; name: string | null;
  /** the version [Ripristina] goes back to (null: nothing before) */
  previous: number | null;
  pending: LearnProposal | null; lastCheck: LearnCheck | null;
  recorded: { predictions: number; known: number; unknown: number };
  n: number; noData: boolean; unknown: number; noPrediction: number;
  typical: number | null; spark: number[]; coverage: { rate: number; n: number } | null; driftChanged: boolean;
}

/** Below this many measured items a policy says "senza dati" (lib.mjs MIN_CAL). */
export const MIN_N = 20;

/** The page's "?" explanations, in plain words (the user, 2026-10-13: "spiega l'auto miglioramento nell'app, mi piacciono
 *  i punti di domanda con spiegazioni"). */
export const HELP = {
  intro: 'Qui il cervello controlla quanto sbagliano le sue stime di tempo e costo (e, quando avrà dati, la scelta del modello). '
    + 'Ogni tanto rifà le stime sulle chat passate con metodi diversi: se uno sbaglia chiaramente meno, nasce una proposta. '
    + 'Niente cambia finché non premi Applica; ogni cambio si annulla con Ripristina e dopo 20 chat viene controllato da solo.',
  typical: 'Di quanto la stima si allontana dal vero, a metà delle chat: ×1,7 vuol dire che una volta su due il vero sta tra la stima divisa 1,7 e la stima per 1,7. Più vicino a ×1, meglio è.',
  cover: 'La forbice «da … a …» della stima è fatta per contenere il valore vero 8 volte su 10. Qui vedi quante volte ci è riuscita davvero sulle ultime chat.',
  out: 'Chat di cui non si sa come sono finite, o troppo vecchie per avere una stima fatta prima: non entrano nei numeri, ma restano contate qui.',
  noData: `Prima di dire qualcosa servono almeno ${MIN_N} chat con il risultato noto: con meno, i numeri sarebbero rumore.`,
  proposal: 'Il cervello ha rifatto le stime sulle stesse chat passate (almeno 30) con il metodo in uso e con quello nuovo. Propone il nuovo solo se sbaglia meno in modo chiaro, non per caso: anche nel caso peggiore del margine («tra … e …») resta meglio, e non peggiora nient\'altro.',
  check: 'Dopo un cambio, sulle 20 chat successive confronta il metodo nuovo con quello di prima. Se il nuovo è peggio, propone di tornare indietro: non lo fa mai da solo.',
  rollback: 'Torna alla versione precedente con un clic. Nessun dato si perde e puoi riapplicare la proposta quando vuoi.',
  drift: 'Le ultime 20 chat sbagliano più di 1,5 volte le 60 prima: il tipo di lavoro è cambiato e le stime vanno ricalibrate.',
} as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const obj = (v: unknown): Obj => (isObj(v) ? v : {});
const fin = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v: unknown): number => Math.max(0, Math.round(fin(v) ?? 0));
const s = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const diffOf = (v: unknown): Diff | null => {
  const d = obj(v), mean = fin(d.mean), lo = fin(d.lo), hi = fin(d.hi);
  return mean != null && lo != null && hi != null ? { mean, lo, hi } : null;
};

export function normLearn(v: unknown): LearnPolicy[] {
  const list = Array.isArray(obj(v).policies) ? (obj(v).policies as unknown[]) : [];
  return list.filter(isObj).filter(p => typeof p.domain === 'string' && /^[a-z][a-z0-9-]{0,30}$/.test(p.domain)).map(p => {
    const pend = isObj(p.pending) && typeof p.pending.id === 'string' ? p.pending : null;
    // the after-check of the version in force only (the brain keeps the last one written, maybe of an older version)
    const ev = obj(pend?.evidence), chk = isObj(p.lastCheck) && p.lastCheck.version === p.version ? p.lastCheck : null, rec = obj(p.recorded), cov = obj(p.coverage);
    return {
      domain: String(p.domain), version: fin(p.version), appliedAt: s(p.appliedAt), by: s(p.by), name: s(p.name), previous: fin(p.previous),
      pending: pend ? { id: String(pend.id), kind: pend.kind === 'ripristino' ? 'ripristino' : 'cambio', name: s(pend.name) ?? '', at: s(pend.at) ?? '', shared: fin(ev.shared), diff: diffOf(ev.diff) } : null,
      lastCheck: chk ? { state: s(chk.state) ?? '', n: fin(chk.n), need: fin(chk.need), at: s(chk.at) ?? s(chk.since) } : null,
      recorded: { predictions: int(rec.predictions), known: int(rec.known), unknown: int(rec.unknown) },
      n: int(p.n), noData: p.noData !== false, unknown: int(p.unknownItems) + int(rec.unknown), noPrediction: int(p.noPrediction),
      typical: fin(p.typical), spark: (Array.isArray(p.spark) ? p.spark : []).map(fin).filter((x): x is number => x != null),
      coverage: fin(cov.rate) != null && int(cov.n) > 0 ? { rate: fin(cov.rate)!, n: int(cov.n) } : null,
      driftChanged: obj(p.drift).changed === true,
    };
  });
}

/** What each policy decides, in the owner's words. */
export const POLICY_LABEL: Record<string, string> = { estimates: 'Stime di tempo e costo', routing: 'Scelta del modello', notifications: 'Soglie delle notifiche' };
export const policyLabel = (d: string): string => POLICY_LABEL[d] ?? d;

const n1 = (v: number) => v.toLocaleString('it-IT', { maximumFractionDigits: 1, minimumFractionDigits: v < 10 ? 1 : 0 });
const pc = (v: number) => `${Math.round(v * 100)}%`;

/** "×1,9": the estimate is typically off by this factor, either way. */
export const factor = (x: number): string => `×${n1(x)}`;

/** "senza dati: 12 misurati, ne servono 20" or the typical error with its n. */
export function errorLine(p: LearnPolicy): string {
  if (p.noData) return `senza dati: ${p.n} ${p.n === 1 ? 'misurato' : 'misurati'}, ne servono ${MIN_N}`;
  return p.typical == null ? 'errore non misurato' : `errore tipico ${factor(p.typical)} sulle ultime ${p.spark.length}`;
}

/** "l'intervallo dell'80% ha contenuto il reale 84 volte su 100 (su 50)" */
export function coverageLine(c: LearnPolicy['coverage']): string | null {
  return c ? `l'intervallo dell'80% ha contenuto il reale ${pc(c.rate)} delle volte (su ${c.n})` : null;
}

/** What a proposal gains, from the 90% interval of the per-item log-error difference (in force − proposed: > 0 =
 *  better): "errore più piccolo del 12% (tra 4% e 19%), su 42 casi in comune". A revert proposal carries the
 *  after-check's diff (old − in force: < 0 = the old one was better, so going back gains), hence the sign flip. */
export function gainLine(p: LearnProposal): string {
  if (!p.diff) return p.shared ? `su ${p.shared} casi in comune` : 'misura non disponibile';
  const g = (x: number) => Math.round((1 - Math.exp(-x)) * 100);
  const sign = p.kind === 'ripristino' ? -1 : 1, mean = g(sign * p.diff.mean);
  const [a, b] = [g(sign * p.diff.lo), g(sign * p.diff.hi)].sort((x, y) => x - y);
  const word = mean >= 0 ? `errore più piccolo del ${mean}%` : `errore più grande del ${-mean}%`;
  return `${word} (tra ${a}% e ${b}%)${p.shared ? `, su ${p.shared} casi in comune` : ''}`;
}

/** The after-check of the last change in words. */
export function checkLine(c: LearnCheck | null): string | null {
  if (!c?.state) return null;
  if (c.state === 'in attesa') return `in attesa: ${c.n ?? 0} casi dopo il cambio su ${c.need ?? MIN_N} che servono`;
  if (c.state === 'peggiorata') return `peggiorata${c.n ? ` (su ${c.n} casi)` : ''}: c'è una proposta di ripristino`;
  return `${c.state}${c.n ? ` (su ${c.n} casi)` : ''}`;
}
