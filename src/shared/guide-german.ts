// The Guida's German (ADR 0117, 0196): concept-guide.de.ts maps each English text of the cards to its German one, so an
// English text that changed has no German until someone translates it again, and its old entry is left over. This file
// lists both, per card, for the maintenance (main/guide/maintenance.ts gives it to the research) and for the unit test
// that keeps the map complete (test/unit/concept-guide.test.ts). A left-over entry is paired with the missing text it
// most likely was (most shared words), so the translator sees the old German beside the new English. Pure.
import type { Bi, ConceptCard } from './concept-guide';

export interface GermanGap {
  card: string;
  /** English texts of the card with no German entry */
  missing: { en: string; was?: { en: string; de: string } }[];
}
export interface GermanReport { gaps: GermanGap[]; orphans: string[] }

/** Every {it, en} text of a card (title, summary, points, analogy, tech, diagram, target, coming). */
export function cardTexts(card: ConceptCard): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    const o = v as Partial<Bi> & Record<string, unknown>;
    if (typeof o.it === 'string' && typeof o.en === 'string') { out.push(o.en); return; }
    for (const x of Object.values(o)) walk(x);
  };
  walk(card);
  return out;
}

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3));
function likeness(a: string, b: string): number {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let n = 0; for (const w of x) if (y.has(w)) n++;
  return n / Math.max(x.size, y.size);
}

/** The cards whose German is missing (an English text changed or is new) and the German entries no card uses. */
export function germanReport(cards: readonly ConceptCard[], de: Readonly<Record<string, string>>): GermanReport {
  const used = new Set<string>();
  const gaps: GermanGap[] = [];
  for (const c of cards) {
    const texts = cardTexts(c);
    texts.forEach(t => used.add(t));
    const missing = [...new Set(texts.filter(t => !(t in de)))];
    if (missing.length) gaps.push({ card: c.id, missing: missing.map(en => ({ en })) });
  }
  const orphans = Object.keys(de).filter(k => !used.has(k));
  for (const g of gaps) for (const m of g.missing) {
    let best: string | null = null, score = 0.5;
    for (const o of orphans) { const s = likeness(m.en, o); if (s > score) { score = s; best = o; } }
    if (best) m.was = { en: best, de: de[best]! };
  }
  return { gaps, orphans };
}

/** The report as text for the maintenance (empty when every text has its German). */
export function germanReportText(r: GermanReport): string {
  if (!r.gaps.length && !r.orphans.length) return '';
  const lines = ['Guida German (src/shared/concept-guide.de.ts maps English → German): texts to translate.'];
  for (const g of r.gaps) for (const m of g.missing) lines.push(`- card ${g.card}: "${m.en}"${m.was ? ` (was "${m.was.en}" → "${m.was.de}")` : ''}`);
  if (r.orphans.length) lines.push(`Entries no card uses any more (remove them): ${r.orphans.map(o => `"${o.slice(0, 80)}"`).join(', ')}`);
  return lines.join('\n');
}
