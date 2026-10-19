// recurrence: did a rule really help? For every line of ai-errors.md that names the rule born from it ("· regola: …"),
// the later errors of the same type in a similar area (a shared word of 4+ letters): 0 = it did not come back
// ({{OWNER}} 2026-10-10, D4 of reviews/2026-10-10-architettura-agenti.md; ACE/ExpeL: count, don't guess). Also the
// totals per type and the lines whose type is outside the list of the ai-errors.md header (they escape the count:
// fix their type). READ-ONLY. Counts, never percentages: the samples are small. Run only when {{OWNER}} asks or in a
// review, never on a schedule. quality(): the same file as the app's Qualità page needs it ({{OWNER}} 2026-10-13, "la sezione
// qualità sia veramente utile e veritiera"): near-duplicate type labels mapped to the 11 official types (ALIASES, only
// obvious synonyms; the rest is shown as "senza tipo valido", never guessed), the lines it cannot read, who saw each
// error per day ({{OWNER}} or someone else), and per rule whether its error came back within 14 days ("troppo presto"
// while the rule is younger than that).
// Usage: node "{{BRAIN}}/ops/tools/recurrence.mjs" [--since AAAA-MM-GG] [--type <tipo>]
//          [--file <ai-errors.md>] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TYPES = ['test-passato-a-torto', 'bug-non-trovato', 'fatto-non-verificato', 'posto-sbagliato', 'regola-ignorata',
  'richiesta-fraintesa', 'non-capito', 'azione-pericolosa', 'fuori-ruolo', 'blocco-aggirato', 'altro'];
export const normType = t => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  .replace(/\s*\(.*\)$/, '').replace(/[\s_]+/g, '-');
// Labels written instead of an official type (seen in ai-errors.md, 2026-10-13) → the official type they plainly mean.
// Keys are normType() output. Anything not here and not in TYPES stays without a type: fix the line, don't stretch this.
export const ALIASES = {
  'fatto-presunto': 'fatto-non-verificato', 'affermazione-non-verificata': 'fatto-non-verificato', 'cifra-non-verificata': 'fatto-non-verificato',
  'fatto-sbagliato': 'fatto-non-verificato', 'bug-inventato': 'fatto-non-verificato', 'design-inventato': 'fatto-non-verificato',
  'verifica-saltata': 'fatto-non-verificato', 'verifica-incompleta': 'fatto-non-verificato', 'stato-letto-male': 'fatto-non-verificato',
  'azione-pericolosa-tentata': 'azione-pericolosa', 'push-senza-ok': 'azione-pericolosa', 'scrittura-non-voluta': 'azione-pericolosa',
  'spiegazione-poco-chiara': 'non-capito', 'spiegazione-non-chiara': 'non-capito', 'spiegazione-non-chiara-+-domande-nelle-chat': 'non-capito',
  'risposta-non-capita': 'non-capito', 'testo-non-visto': 'non-capito', 'comando-non-visto': 'non-capito', 'istruzione-poco-chiara': 'non-capito',
  'presentazione-poco-chiara': 'non-capito', 'gergo': 'non-capito', 'testo-da-approvare-fuori-dal-pannello': 'non-capito',
  'testo-da-approvare-fuori-dal-pannello-e-niente-link': 'non-capito',
  'decisione-gia-presa-ignorata': 'regola-ignorata', 'decisione-ridiscussa': 'regola-ignorata', 'avviso-ignorato': 'regola-ignorata',
  'worktree-altrui-scritto': 'posto-sbagliato',
};
/** The official type of a written label, or null when it is none of them. */
export const canonType = t => { const n = normType(t); return TYPES.includes(n) ? n : ALIASES[n] ?? null; };
/** The "visto da" text of a line ("visto da: {{OWNER}}, …" or "visto da Owner: …"), null when the line has none. */
export const seenBy = line => { const m = String(line).match(/(?:^|·)\s*visto da(?![a-z]):?\s*([^·]*)/i); return m ? m[1].trim() : null; };
/** {{OWNER}} caught it himself (not a reviewer, QA, a hook or the agent). */
export const byOwner = seen => /^["'«]?owner(?![a-z])/i.test(String(seen ?? '').trim());
export const WINDOW_DAYS = 14;
const dayMs = d => Date.parse(`${d}T00:00:00Z`);
const daysBetween = (a, b) => Math.round((dayMs(b) - dayMs(a)) / 864e5);

const words = s => new Set(String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
const near = (a, b) => { const B = words(b); return [...words(a)].some(w => B.has(w)); };

// "- AAAA-MM-GG HH:MM · chat · area · tipo · detto: … · vero: … · visto da: … [· regola: …]". Chat names may hold " · "
// ("OS · Tool"), so fields are found from the "detto:"/"fatto:" field backwards: type = the one before, area before it.
export function parse(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^- (\d{4}-\d{2}-\d{2})(?: [\d:-]{5})? · (.*)$/);
    if (!m) continue;
    const f = m[2].split(' · ').map(x => x.trim());
    // the colon: "fatto-non-verificato" is a type; "detto all’Orchestrator: …" is a claim
    let i = f.findIndex(x => /^(detto|fatto)[^:·]{0,20}:/i.test(x));
    if (i < 0) i = f.findIndex(x => /^vero\s*:/i.test(x));
    if (i < 3) continue; // not the standard format: no who/area/type before the claim
    const rule = f.find(x => /^regola:/i.test(x));
    out.push({ date: m[1], who: f.slice(0, i - 2).join(' · '), area: f[i - 2], rawType: f[i - 1], type: normType(f[i - 1]),
      rule: rule ? rule.replace(/^regola:\s*/i, '') : null, line });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function recurrence(rows, { type } = {}) {
  const sel = (type ? rows.filter(r => canonType(r.rawType) === canonType(type)) : rows).map(r => ({ ...r, type: canonType(r.rawType) ?? r.type }));
  const known = sel.filter(r => TYPES.includes(r.type));
  const totals = Object.entries(known.reduce((m, r) => ((m[r.type] = (m[r.type] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  const rules = sel.map((r, i) => ({ r, i })).filter(({ r }) => r.rule).map(({ r, i }) => {
    const again = sel.slice(i + 1).filter(x => x.type === r.type && x.date >= r.date && near(x.area, r.area));
    return { date: r.date, type: r.type, area: r.area, rule: r.rule, again: again.length, againLines: again.map(x => x.line) };
  });
  const outside = sel.filter(r => !TYPES.includes(r.type));
  return { totals, rules, outside: outside.map(r => ({ date: r.date, type: r.rawType })) };
}

/** What the Qualità page shows from ai-errors.md: the lines it cannot read, the ones without a valid type, who saw the
 *  errors day by day, and per rule whether its error (same official type, an area sharing a word) came back within
 *  windowDays: 'tornato' · 'non-tornato' · 'troppo-presto' (rule younger than windowDays and not back yet) ·
 *  'senza-tipo' (its own line has no valid type). today = AAAA-MM-GG. */
export function quality(text, { today, windowDays = WINDOW_DAYS } = {}) {
  const dated = String(text ?? '').split(/\r?\n/).filter(l => /^- \d{4}-\d{2}-\d{2}/.test(l));
  const rows = parse(text ?? '').map(r => ({ ...r, canon: canonType(r.rawType) }));
  const read = new Set(rows.map(r => r.line));
  const unparsed = dated.filter(l => !read.has(l)).map(l => ({ date: l.slice(2, 12), line: l }));
  const invalid = rows.filter(r => !r.canon).map(r => ({ date: r.date, type: r.rawType, line: r.line }));
  const byDay = new Map();
  for (const l of dated) {
    // `owner`: the app's Qualità page reads this key (the same in the published product, where the name is generic)
    const d = l.slice(2, 12), s = seenBy(l), e = byDay.get(d) ?? { date: d, owner: 0, other: 0, unknown: 0 };
    e[s === null ? 'unknown' : byOwner(s) ? 'owner' : 'other']++;
    byDay.set(d, e);
  }
  const rules = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.rule).map(({ r, i }) => {
    const again = r.canon ? rows.slice(i + 1).filter(x => x.canon === r.canon && x.date >= r.date && daysBetween(r.date, x.date) <= windowDays && near(x.area, r.area)) : [];
    const age = today ? daysBetween(r.date, today) : Infinity;
    const status = !r.canon ? 'senza-tipo' : again.length ? 'tornato' : age < windowDays ? 'troppo-presto' : 'non-tornato';
    return { date: r.date, type: r.canon ?? r.rawType, area: r.area, rule: r.rule, status, ageDays: Number.isFinite(age) ? age : null, again: again.map(x => ({ date: x.date, line: x.line })) };
  });
  const totals = Object.entries(rows.filter(r => r.canon).reduce((m, r) => ((m[r.canon] = (m[r.canon] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  const dates = dated.map(l => l.slice(2, 12)).sort();
  return { today: today ?? null, windowDays, from: dates[0] ?? null, to: dates.at(-1) ?? null, lines: dated.length, typed: rows.length - invalid.length,
    unparsed, invalid, seenByDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)), totals, rules };
}

export function render(res) {
  const L = ['## Errori per tipo', ...res.totals.map(([t, n]) => `- ${t}: ${n}`), '', '## Le regole nate da un errore: è tornato?'];
  for (const x of res.rules) {
    L.push(`- ${x.date} · ${x.type} · ${x.area} · regola: ${x.rule.slice(0, 90)} → ${x.again ? `tornato ${x.again} volte (${x.againLines.map(l => l.slice(2, 12)).join(', ')})` : 'non è tornato'}`);
  }
  if (!res.rules.length) L.push('- nessuna riga con "regola:"');
  if (res.outside.length) {
    const byType = res.outside.reduce((m, r) => ((m[r.type] = (m[r.type] ?? 0) + 1), m), {});
    L.push('', `## Tipo fuori elenco: ${res.outside.length} righe sfuggono al conteggio (correggi il tipo)`,
      Object.entries(byType).map(([t, n]) => `${t.slice(0, 50)} (${n})`).join(' · '));
  }
  return L.join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  const arg = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const file = arg('--file') ?? '{{BRAIN}}/ai-errors.md';
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''; // a fresh brain has no ai-errors.md yet
  const rows = parse(text).filter(r => r.date >= (arg('--since') ?? ''));
  const skipped = text.split(/\r?\n/).filter(l => /^- \d{4}-\d{2}-\d{2}/.test(l) && l.slice(2, 12) >= (arg('--since') ?? '') && !rows.some(r => r.line === l));
  const noClaim = skipped.filter(l => !/ · (detto|fatto)[^:·]{0,20}:| · vero\s*:/i.test(l));
  const why = [noClaim.length && `${noClaim.length} senza "detto:"/"vero:"`, skipped.length - noClaim.length && `${skipped.length - noClaim.length} senza il campo area o tipo`].filter(Boolean);
  const res = recurrence(rows, { type: arg('--type') });
  console.log(argv.includes('--json') ? JSON.stringify(res, null, 2)
    : `# Recidiva degli errori (${rows.length} righe di ${path.basename(file)}${why.length ? `; non contate: ${why.join(', ')} (${skipped.map(l => l.slice(2, 18)).join(', ')})` : ''})\n\n${render(res)}`);
}
