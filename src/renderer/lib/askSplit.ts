// Splits an agent's question written as one text ("Ho trovato X nel log. Lo sistemo?") into a short context and the
// question itself, so the panel can show the context small and muted on top and the real question large under it (the
// user, 2026-10-15: "le domande devono essere comprensibili al volo, spiegate brevemente con il contesto, e poi la
// domanda vera breve"). Only when it is safe: the text ends with a single question sentence and the part before it is
// plain statements (no other "?", no open code span, no cut abbreviation). Anything else comes back whole: the panel
// never rewrites or invents what the agent asked. Pure: used by RequestPanel.tsx; pinned by test/unit/askSplit.test.ts.

export interface AskSplit { lead: string; ask: string }

/** Words that end with a dot without ending a sentence ("es. il log", "ecc. Poi"). */
const ABBR = /(?:^|[\s(])(?:es|ecc|etc|cfr|pag|pp|ca|vs|nr|n|sig|dott|ing|prof|art|e\.g|i\.e|p\.es|fig|ver|min|max|approx)\.$/i;
const MIN_LEAD = 12;
const MIN_ASK = 8;

/** The context and the question of `text`, or null when it is a bare question or the split is not certain. */
export function splitAsk(text: string): AskSplit | null {
  const t = text.trim();
  if (!t.endsWith('?')) return null;
  // the last sentence boundary before the final question: a line break, or . ! : ; followed by a space and a capital
  let cut = -1;
  const nl = t.lastIndexOf('\n');
  if (nl > 0) cut = nl;
  const re = /([.!:;])\s+(?=["«(]?[A-ZÀ-ÖØ-Þ])/g;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const at = m.index + 1;
    if (at <= cut) continue;
    if (m[1] === '.' && (ABBR.test(t.slice(0, at)) || /\d\.$/.test(t.slice(0, at)))) continue; // "es.", "1."
    cut = at;
  }
  if (cut <= 0) return null;
  const lead = t.slice(0, cut).trim();
  const ask = t.slice(cut).trim();
  if (lead.length < MIN_LEAD || ask.length < MIN_ASK) return null;
  // the context is plain statements: another question in it means the text is a list of questions, kept whole
  if (lead.includes('?')) return null;
  // the question is one sentence: no boundary left in it (else the cut was not the last one, or it is a list)
  if (/[.!?]\s/.test(ask.slice(0, -1))) return null;
  // never cut inside a code span or a markdown link
  if ((lead.match(/`/g)?.length ?? 0) % 2 || (lead.match(/\[/g)?.length ?? 0) !== (lead.match(/\]/g)?.length ?? 0)) return null;
  if ((lead.match(/\(/g)?.length ?? 0) !== (lead.match(/\)/g)?.length ?? 0)) return null;
  return { lead, ask };
}
