// The Guida's part of the Manutenzione (ADR 0196), at zero tokens: the concept cards whose anchored code changed since
// their text was written (only when the app runs from its repo: a packaged build has no sources) and the English texts
// with no German. The research's data pack can call guideMaintenanceSection() as one more section; this module does not
// wire itself into research-pack.ts (the integrator adds the call). Pure apart from reading the anchored files.
import { CONCEPTS, textOf } from '../../shared/concept-guide';
import { GUIDE_DE } from '../../shared/concept-guide.de';
import type { StaleCard } from '../../shared/guide-anchors';
import { germanReport, germanReportText } from '../../shared/guide-german';
import { staleInRepo } from './anchors';

/** The stale cards in a checkout (none without one). */
export function guideStaleCards(repoRoot: string | null): StaleCard[] {
  return repoRoot ? staleInRepo(repoRoot) : [];
}

/** One text section: what to re-read on each stale card (its point's text beside the code that changed) and the German to
 *  translate. Empty when there is nothing to do. */
export function guideMaintenanceSection(repoRoot: string | null, max = 12_000): string {
  const out: string[] = [];
  const stale = guideStaleCards(repoRoot);
  if (stale.length) {
    out.push('Guida cards whose code changed after their text was written (src/shared/concept-guide.ts; after updating a card run node scripts/guide-anchors.mjs):');
    for (const s of stale) {
      const card = CONCEPTS.find(c => c.id === s.id);
      if (!card) continue;
      out.push(`- ${s.id} «${textOf(card.title, 'it')}»`);
      for (const a of s.anchors) {
        const text = a.point >= 0 ? card.points[a.point] : undefined;
        out.push(`  · ${a.point >= 0 ? `point ${a.point + 1}` : 'technical part'} (${a.ref}, ${a.why})${text ? `: "${text.en}"` : ''}`);
      }
    }
  }
  const german = germanReportText(germanReport(CONCEPTS, GUIDE_DE));
  if (german) out.push(german);
  const text = out.join('\n');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
