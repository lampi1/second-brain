// Pure rules of the DevOps page (pages/Devops.tsx), computed locally from what the brain's script read (zero tokens):
// who a PR is waiting for, how long a work item has not moved, the test cases' outcomes in one line, the work items in
// state order, the review/stuck/build counts of the head tiles. Why: the user, 2026-10-12, "falla figa e usabile ... con
// info aggiuntive sempre a costo 0 token". Pinned by test/unit/brain-ui/devops-view.test.ts.
import type { DevopsDetail, DevopsItem, DevopsPr, DevopsTest } from '@shared/contract';
import type { Tone } from '../components/ui';

const DAY = 864e5;
/** Whole days since an ISO date (null when missing or unreadable). */
export function daysSince(iso: string | null | undefined, now = Date.now()): number | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now - t) / DAY));
}
/** "da oggi" · "da ieri" · "da 4 giorni" */
export function sinceLabel(days: number): string { return days === 0 ? 'da oggi' : days === 1 ? 'da ieri' : `da ${days} giorni`; }

/** A work item has not moved for this many days: "fermo". */
export const STUCK_DAYS = 3;
export function stuckDays(w: DevopsItem, now = Date.now()): number | null {
  const d = daysSince(w.changedAt, now);
  return d !== null && d >= STUCK_DAYS ? d : null;
}

export interface Wait { who: 'me' | 'others' | 'none'; tone: Tone; text: string }
/** "Giulia Bianchi" / "Bianchi, Giulia <guid\mail>" → "Giulia" */
export function firstName(n: string): string {
  const clean = n.replace(/\s*<.*$/, '').trim();
  const m = clean.match(/^([^,]+),\s*(.+)$/);
  return (m ? m[2]! : clean).split(' ')[0] || n;
}

/** Who the PR is waiting for, the most blocking reason first. */
export function prWait(p: DevopsPr): Wait {
  if (p.draft) return { who: 'me', tone: 'outline', text: 'Bozza: la pubblichi tu' };
  const rejected = p.reviewers.filter(r => r.vote <= -10);
  if (rejected.length) return { who: 'me', tone: 'bad', text: `Aspetta te: rifiutata da ${rejected.map(r => firstName(r.name)).join(', ')}` };
  if (p.build?.result === 'failed') return { who: 'me', tone: 'bad', text: 'Aspetta te: build fallita' };
  if (p.build?.result === 'canceled') return { who: 'me', tone: 'warn', text: 'Aspetta te: build annullata' };
  const changes = p.reviewers.filter(r => r.vote === -5);
  if (changes.length) return { who: 'me', tone: 'warn', text: `Aspetta te: ${changes.map(r => firstName(r.name)).join(', ')} ${changes.length === 1 ? 'chiede' : 'chiedono'} modifiche` };
  if (p.activeThreads) return { who: 'me', tone: 'warn', text: `Aspetta te: ${p.activeThreads} ${p.activeThreads === 1 ? 'commento da risolvere' : 'commenti da risolvere'}` };
  const missing = p.reviewers.filter(r => r.required && r.vote === 0);
  if (missing.length) return { who: 'others', tone: 'blue', text: `Aspetta il voto di ${missing.map(r => firstName(r.name)).join(', ')}` };
  if (p.build && p.build.status !== 'completed') return { who: 'others', tone: 'blue', text: 'Aspetta la build in corso' };
  if (!p.reviewers.some(r => r.vote >= 5)) return { who: 'others', tone: 'blue', text: 'Aspetta una prima approvazione' };
  return p.autoComplete
    ? { who: 'none', tone: 'good', text: 'Pronta: si chiude da sola' }
    : { who: 'me', tone: 'good', text: 'Pronta: manca solo il completamento' };
}

/** A build's result or status in Italian ("failed" → "fallita"). */
export const BUILD_WORDS: Record<string, string> = { failed: 'fallita', partiallySucceeded: 'riuscita in parte', succeeded: 'riuscita', canceled: 'annullata',
  inProgress: 'in corso', notStarted: 'in coda', cancelling: 'in annullamento', postponed: 'rimandata' };

export interface TestSum { passed: number; failed: number; other: number; never: number; total: number; tone: Tone; text: string }
/** "3 test: 2 passati, 1 fallito" with the worst outcome's tone. */
export function testSummary(tests: readonly DevopsTest[]): TestSum | null {
  if (!tests.length) return null;
  const n = (f: (t: DevopsTest) => boolean) => tests.filter(f).length;
  const passed = n(t => t.outcome === 'Passed');
  const failed = n(t => t.outcome === 'Failed');
  const never = n(t => !t.outcome || /^(None|Unspecified|NotExecuted)$/i.test(t.outcome));
  const other = tests.length - passed - failed - never;
  const parts = [passed && `${passed} ${passed === 1 ? 'passato' : 'passati'}`, failed && `${failed} ${failed === 1 ? 'fallito' : 'falliti'}`,
    other && `${other} ${other === 1 ? 'bloccato o altro' : 'bloccati o altro'}`, never && `${never} da eseguire`].filter(Boolean);
  const tone: Tone = failed ? 'bad' : other || never ? 'warn' : 'good';
  return { passed, failed, other, never, total: tests.length, tone, text: `${tests.length} test: ${parts.join(', ')}` };
}

export function outcomeLabel(o: string | null): { label: string; tone: Tone } {
  if (o === 'Passed') return { label: 'passato', tone: 'good' };
  if (o === 'Failed') return { label: 'fallito', tone: 'bad' };
  if (o === 'Blocked') return { label: 'bloccato', tone: 'warn' };
  if (o === 'NotApplicable') return { label: 'non applicabile', tone: 'outline' };
  if (!o || /^(None|Unspecified|NotExecuted)$/i.test(o)) return { label: 'da eseguire', tone: 'outline' };
  return { label: o, tone: 'warn' };
}

export function stateTone(state: string): Tone {
  if (/^(Active|In Progress|Committed|Doing|Approved)$/i.test(state)) return 'blue';
  if (/^(Resolved|Done|Closed|Completed)$/i.test(state)) return 'good';
  if (/^New$/i.test(state)) return 'outline';
  return '';
}

const STATE_ORDER = ['Active', 'In Progress', 'Doing', 'Committed', 'Approved', 'New', 'Resolved'];
const stateRank = (s: string) => { const i = STATE_ORDER.findIndex(x => x.toLowerCase() === s.toLowerCase()); return i < 0 ? STATE_ORDER.length : i; };

/** Work items by state (working ones first), each group by priority then the longest still first. */
export function byState(items: readonly DevopsItem[]): { state: string; items: DevopsItem[] }[] {
  const groups = new Map<string, DevopsItem[]>();
  for (const w of items) groups.set(w.state || '—', [...(groups.get(w.state || '—') ?? []), w]);
  return [...groups.entries()].sort(([a], [b]) => stateRank(a) - stateRank(b) || a.localeCompare(b)).map(([state, xs]) => ({
    state,
    items: [...xs].sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || (Date.parse(a.changedAt ?? '') || 0) - (Date.parse(b.changedAt ?? '') || 0)),
  }));
}

/** The last comment by someone else (what is worth reading first), else the last one. */
export function lastComment(d: DevopsDetail | undefined): DevopsDetail['comments'][number] | null {
  if (!d?.comments.length) return null;
  return d.comments.find(c => !c.mine) ?? d.comments[0] ?? null;
}

/** "Giulia Bianchi" → "GB": the avatar of a comment. */
export function initials(name: string | null | undefined): string {
  const clean = (name ?? '').replace(/\s*<.*$/, '').trim();
  const m = clean.match(/^([^,]+),\s*(.+)$/);
  const parts = (m ? `${m[2]} ${m[1]}` : clean).split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}
/** A stable avatar color (1..8 of the brain's categorical palette) from a name. */
export function hue(name: string | null | undefined): number {
  let h = 0;
  for (const c of name ?? '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 8) + 1;
}
