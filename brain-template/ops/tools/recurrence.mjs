// recurrence: did a rule really help? For every line of ai-errors.md that names the rule born from it ("· regola: …"),
// the later errors of the same type in a similar area (a shared word of 4+ letters): 0 = it did not come back
// ({{OWNER}} 2026-10-10, D4 of reviews/2026-10-10-architettura-agenti.md; ACE/ExpeL: count, don't guess). Also the
// totals per type and the lines whose type is outside the list of the ai-errors.md header (they escape the count:
// fix their type). READ-ONLY. Counts, never percentages: the samples are small. Run only when {{OWNER}} asks or in a
// review, never on a schedule.
// Usage: node "{{BRAIN}}/ops/tools/recurrence.mjs" [--since AAAA-MM-GG] [--type <tipo>]
//          [--file <ai-errors.md>] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TYPES = ['test-passato-a-torto', 'bug-non-trovato', 'fatto-non-verificato', 'posto-sbagliato', 'regola-ignorata',
  'richiesta-fraintesa', 'non-capito', 'azione-pericolosa', 'fuori-ruolo', 'blocco-aggirato', 'altro'];
export const normType = t => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  .replace(/\s*\(.*\)$/, '').replace(/[\s_]+/g, '-');
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
    // the colon: "fatto-non-verificato" is a type; "detto alla Regia: …" is a claim
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
  const sel = type ? rows.filter(r => r.type === normType(type)) : rows;
  const known = sel.filter(r => TYPES.includes(r.type));
  const totals = Object.entries(known.reduce((m, r) => ((m[r.type] = (m[r.type] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  const rules = sel.map((r, i) => ({ r, i })).filter(({ r }) => r.rule).map(({ r, i }) => {
    const again = sel.slice(i + 1).filter(x => x.type === r.type && x.date >= r.date && near(x.area, r.area));
    return { date: r.date, type: r.type, area: r.area, rule: r.rule, again: again.length, againLines: again.map(x => x.line) };
  });
  const outside = sel.filter(r => !TYPES.includes(r.type));
  return { totals, rules, outside: outside.map(r => ({ date: r.date, type: r.rawType })) };
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
  const text = fs.readFileSync(file, 'utf8');
  const rows = parse(text).filter(r => r.date >= (arg('--since') ?? ''));
  const skipped = text.split(/\r?\n/).filter(l => /^- \d{4}-\d{2}-\d{2}/.test(l) && l.slice(2, 12) >= (arg('--since') ?? '') && !rows.some(r => r.line === l));
  const noClaim = skipped.filter(l => !/ · (detto|fatto)[^:·]{0,20}:| · vero\s*:/i.test(l));
  const why = [noClaim.length && `${noClaim.length} senza "detto:"/"vero:"`, skipped.length - noClaim.length && `${skipped.length - noClaim.length} senza il campo area o tipo`].filter(Boolean);
  const res = recurrence(rows, { type: arg('--type') });
  console.log(argv.includes('--json') ? JSON.stringify(res, null, 2)
    : `# Recidiva degli errori (${rows.length} righe di ${path.basename(file)}${why.length ? `; non contate: ${why.join(', ')} (${skipped.map(l => l.slice(2, 18)).join(', ')})` : ''})\n\n${render(res)}`);
}
