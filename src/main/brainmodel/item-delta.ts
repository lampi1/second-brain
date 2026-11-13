// Itemized changes, never whole rewrites (ADR 0194, M1). ACE (Zhang et al., ICLR 2026) measured «brevity bias» and
// «context collapse» when a memory rewrites itself whole: details go missing one rewrite at a time. The cure is a change
// made of item deltas: add, edit or remove one item, each with its evidence. This module is the pure, diff-based check
// every maintenance write path goes through (ChangeLog.apply for the jobs, the research findings applied on approval and
// the brain upgrade; memory-tidy.ts for the facts it rewrites): the items of a markdown text are its non-blank lines
// (a bullet, a heading, a paragraph line, a code line), compared as a multiset; a write that loses an item is refused
// unless that item is listed as removed with a reason (an edit lists the old line, the new line is an addition). A file
// removed whole needs one `WHOLE_FILE` item with its reason. Additions are always allowed. Pure; used by changes.ts,
// jobs.ts, upgrade.ts, service.ts, memory-tidy.ts; tests: test/unit/brainmodel/item-delta.test.ts.

/** One item a change removes (or replaces: an edit is the old line removed and the new one added), with why. */
export interface RemovedItem { item: string; reason: string }
/** The item that stands for a whole file a change deletes. */
export const WHOLE_FILE = '*';

/** An item as compared: trimmed, inner whitespace folded (re-indenting or re-wrapping spaces is not a loss). */
export const itemKey = (line: string): string => line.replace(/\s+/g, ' ').trim();

/** The items of a markdown text: its non-blank lines, in order. */
export function items(text: string): string[] {
  return text.split(/\r?\n/).map(itemKey).filter(Boolean);
}

/** The items `before` has and `after` lost (a multiset difference: a line twice and kept once lost one copy). */
export function removedItems(before: string, after: string): string[] {
  const left = new Map<string, number>();
  for (const k of items(after)) left.set(k, (left.get(k) ?? 0) + 1);
  const out: string[] = [];
  for (const k of items(before)) {
    const n = left.get(k) ?? 0;
    if (n > 0) left.set(k, n - 1); else out.push(k);
  }
  return out;
}
/** The items `after` adds. */
export const addedItems = (before: string, after: string): string[] => removedItems(after, before);

/** Every removed item of a regeneration listed with one reason: for a job that rebuilds a file from its own source
 *  (the migration's sealed skill, the upgrade's moved block) and says so in each item's reason. */
export const declareRemoved = (before: string, after: string, reason: string): RemovedItem[] => removedItems(before, after).map(item => ({ item, reason }));

export type DeltaVerdict = { ok: true; added: number; removed: number } | { ok: false; cause: string; hint: string; missing: string[] };

const clip = (s: string, n = 120): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Is the write from `before` to `after` an itemized change? Every lost item must be declared removed with a non-empty
 *  reason; `after` null (the file goes) needs WHOLE_FILE declared. `before` null (a new file) is always itemized. */
export function checkDelta(before: string | null, after: string | null, declared: readonly RemovedItem[] = []): DeltaVerdict {
  const reasons = declared.filter(d => typeof d?.item === 'string' && typeof d.reason === 'string' && d.reason.trim());
  if (before === null) return { ok: true, added: after === null ? 0 : items(after).length, removed: 0 };
  if (after === null) {
    if (reasons.some(d => d.item === WHOLE_FILE)) return { ok: true, added: 0, removed: items(before).length };
    return { ok: false, cause: 'whole file removed without a declared reason', hint: 'declare the removal as one WHOLE_FILE item with its reason', missing: [WHOLE_FILE] };
  }
  const lost = removedItems(before, after);
  const left = new Map<string, number>();
  for (const d of reasons) { const k = itemKey(d.item); left.set(k, (left.get(k) ?? 0) + 1); }
  const missing: string[] = [];
  for (const k of lost) {
    const n = left.get(k) ?? 0;
    if (n > 0) left.set(k, n - 1); else missing.push(k);
  }
  if (missing.length) {
    return { ok: false, missing,
      cause: `${missing.length} item(s) removed without being listed: «${clip(missing[0]!)}»${missing.length > 1 ? ` and ${missing.length - 1} more` : ''}`,
      hint: 'a maintenance change adds, edits or removes single items: list every removed line with its reason, never rewrite the file whole' };
  }
  return { ok: true, added: addedItems(before, after).length, removed: lost.length };
}

/** The refusal ChangeLog.apply throws: an Italian message for the card or the job's note, the cause and hint for the log. */
export class DeltaRefused extends Error {
  constructor(readonly file: string, readonly verdict: Extract<DeltaVerdict, { ok: false }>) {
    super(`Modifica rifiutata: riscriverebbe «${file.split(/[\\/]/).slice(-2).join('/')}» per intero togliendo ${verdict.missing[0] === WHOLE_FILE ? 'il file' : `${verdict.missing.length} righe`} senza dire perché. La manutenzione cambia una riga alla volta.`);
    this.name = 'DeltaRefused';
  }
}

/** A brain text the guard covers: a markdown note, rule, skill or memory file (not JSON settings, not scripts). */
export const guarded = (file: string): boolean => /\.md$/i.test(file);

// ── one memory fact rewritten (memory-tidy.ts step 2) ─────────────────────────────────────────────────────────────────
/** A fact's rewrite is one item edit, not a collapse: it keeps at least a fifth of the fact's length. A one-line «rule»
 *  that shrinks the fact to a stub is the brevity bias ACE measured: refused, the fact stays as it was. (The words may
 *  change, even the language: a generalization drops the case's values.) */
export function checkFactEdit(before: string, after: string): DeltaVerdict {
  if (itemKey(after).length * 5 < itemKey(before).length) return { ok: false, missing: [itemKey(before)], cause: `the rewrite keeps ${itemKey(after).length} of ${itemKey(before).length} characters`, hint: 'a generalization keeps the procedure, it does not shrink it to a stub; the fact is kept as it is' };
  return { ok: true, added: 1, removed: 1 };
}
