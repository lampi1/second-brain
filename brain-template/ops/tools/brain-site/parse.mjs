// Parsers of the brain's own files into table rows for the brain site (ops/tools/brain-site.mjs). Pure functions, no
// I/O: each takes the file text and returns plain objects. A line that does not fit its format is kept with its raw
// text (never dropped), so a table always shows everything the file holds.

const strip = s => String(s ?? '').replace(/\*\*/g, '').replace(/`/g, '').trim();
const lines = t => String(t ?? '').split(/\r?\n/);
// Split on " · " but not inside quotes ({{OWNER}}'s words may contain the separator).
export function fields(s) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === '“' || c === '”') q = c === '"' ? !q : c === '“';
    if (!q && s.startsWith(' · ', i)) { out.push(cur); cur = ''; i += 2; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(x => x.trim());
}
const labelled = (parts, key) => {
  const p = parts.find(x => x.toLowerCase().startsWith(`${key}:`));
  return p ? p.slice(key.length + 1).trim() : '';
};

// ai-errors.md: `- AAAA-MM-GG HH:MM · chat · area · tipo · detto: … · vero: … · visto da: … [· regola: …]`.
// Chat names may hold " · " ("OS · Tool"): like recurrence.mjs parse, fields are anchored on the "detto:"/"fatto:"
// field (else "vero:"): type = the one before, area before it, chat = the rest. Off-format lines keep only "riga".
export function aiErrors(text) {
  const out = [];
  for (const l of lines(text)) {
    const m = l.match(/^- (\d{4}-\d{2}-\d{2})(?: ([\d:-]{5}))? · (.*)$/);
    if (!m) continue;
    const p = fields(m[3]);
    let i = p.findIndex(x => /^(detto|fatto)[^:·]{0,20}:/i.test(x));
    if (i < 0) i = p.findIndex(x => /^vero\s*:/i.test(x));
    const claim = i >= 0 ? p[i].replace(/^[^:]*:\s*/, '') : '';
    const ok = i >= 3;
    out.push({ data: m[1], ora: /\d/.test(m[2] ?? '') ? m[2] : '', chi: ok ? p.slice(0, i - 2).join(' · ') : '',
      area: ok ? p[i - 2] : '', tipo: ok ? p[i - 1] : '', detto: claim, vero: labelled(p, 'vero'),
      visto: labelled(p, 'visto da') || labelled(p, 'notato'), regola: labelled(p, 'regola'), riga: l.slice(2) });
  }
  return out;
}

// ai-wins.md: `- AAAA-MM-GG HH:MM · harness · chat · area · esito · parole: "…" · consegnato: …`
export function aiWins(text) {
  const out = [];
  for (const l of lines(text)) {
    const m = l.match(/^- (\d{4}-\d{2}-\d{2}) (\d{1,2}:\d{2}) · (.*)$/);
    if (!m) continue;
    const p = fields(m[3]);
    // anchored on "parole:" (chat names may hold " · "): esito before it, area before that, chat after the harness
    let i = p.findIndex(x => /^parole:/i.test(x));
    if (i < 0) i = p.length;
    out.push({ data: m[1], ora: m[2], harness: p[0] ?? '', chat: p.slice(1, Math.max(1, i - 2)).join(' · '), area: i >= 4 ? p[i - 2] : '', esito: i >= 4 ? p[i - 1] : '',
      parole: labelled(p, 'parole').replace(/^"|"$/g, ''), consegnato: labelled(p, 'consegnato'), riga: l.slice(2) });
  }
  return out;
}

// journal/AAAA-MM-GG.md: `- HH:MM [UTC] · tag · text`
export function journal(text, date = '') {
  const out = [];
  for (const l of lines(text)) {
    const m = l.match(/^- (\d{1,2}:\d{2})(?: UTC)? · ([\wàèéìòù-]+) · (.*)$/i);
    if (m) {
      const pers = /^\[personale\]\s*/.test(m[3]);
      out.push({ data: date, ora: m[1], tag: m[2].toLowerCase(), area: pers ? 'personale' : 'lavoro', testo: m[3].replace(/^\[personale\]\s*/, ''), utc: / UTC /.test(l) });
    } else if (/^- /.test(l)) out.push({ data: date, ora: '', tag: '', area: '', testo: l.slice(2), utc: false });
  }
  return out;
}

// now.md: sections "## X" with lines `- **topic** · where · … · (AAAA-MM-GG)`
export function now(text) {
  const out = []; let section = '';
  for (const l of lines(text)) {
    const h = l.match(/^## (.+)$/);
    if (h) { section = h[1].trim(); continue; }
    const m = l.match(/^- \*\*(.+?)\*\*\s*(?:·\s*)?(.*)$/);
    if (!m || !section) continue;
    const date = (m[2].match(/\((\d{4}-\d{2}-\d{2})\)\s*$/) ?? [])[1] ?? '';
    const parts = fields(m[2].replace(/\s*·?\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, ''));
    const next = parts.find(x => /^(prossimo|aspetta|resta|decide|FATT|FERMAT)/i.test(x)) ?? '';
    out.push({ sezione: section, filo: strip(m[1]), dove: strip(parts[0] ?? ''), prossimo: strip(next), stato: strip(parts.filter(x => x !== parts[0] && x !== next).join(' · ')), aggiornato: date });
  }
  return out;
}

// ideas.md: `## AAAA-MM-GG · [area] · Title · `state`` + "- **Field:** text" lines.
export function ideas(text) {
  const out = []; let cur = null;
  for (const l of lines(text)) {
    const h = l.match(/^## (\d{4}-\d{2}-\d{2}) · \[(\w+)\] · (.+?) · `([^`]+)`\s*$/);
    if (h) { cur = { data: h[1], area: h[2], titolo: h[3], stato: h[4], idea: '', come: '', perche: '', riprendere: '', fonte: '', per: '', notato: '', penso: '', sicurezza: '', nonso: '', testo: '' }; out.push(cur); continue; }
    if (/^## /.test(l)) { cur = null; continue; }
    if (!cur) continue;
    cur.testo += `${l}\n`;
    const f = l.match(/^- \*\*([^*:]+):\*\*\s*(.*)$/);
    if (f) { const k = f[1].toLowerCase(); cur._k = k.startsWith('idea') ? 'idea' : k.startsWith('perch') ? 'perche' : k.startsWith('riprend') ? 'riprendere' : k === 'come' ? 'come' : k === 'fonte' ? 'fonte' : k === 'per' ? 'per' : k === 'notato' ? 'notato' : k === 'penso' ? 'penso' : k === 'sicurezza' ? 'sicurezza' : k === 'non so' ? 'nonso' : null; if (cur._k) cur[cur._k] = f[2]; }
    else if (cur._k && /^\s{2,}\S/.test(l)) cur[cur._k] += ` ${l.trim()}`;
    else if (/^- /.test(l)) cur._k = null;
  }
  // an idea is "dell'IA" when its Fonte starts with "IA" (format of brain-editor, 2026-10-10)
  return out.map(({ _k, ...x }) => ({ ...x, chi: /^ia\b/i.test(x.fonte.trim()) ? 'IA' : 'Owner', testo: x.testo.trim(), scaduta: /\d{4}-\d{2}-\d{2}/.test(x.riprendere) ? x.riprendere.match(/\d{4}-\d{2}-\d{2}/)[0] : '' }));
}

// ai-reflections.md: `## AAAA-MM-GG · <chat> · <sentence>` + Notato / Penso / Sicurezza / Non so (mem.mjs riflessione).
// The chat label may hold " · ": the sentence is the last field.
export function reflections(text) {
  const out = []; let cur = null;
  for (const l of lines(text)) {
    const h = l.match(/^## (\d{4}-\d{2}-\d{2}) · (.+) · ([^·]+)$/);
    if (h) { cur = { data: h[1], chat: h[2].trim(), titolo: h[3].trim(), notato: '', penso: '', sicurezza: '', nonso: '' }; out.push(cur); continue; }
    if (/^## /.test(l)) { cur = null; continue; }
    const f = cur && l.match(/^- \*\*([^*:]+):\*\*\s*(.*)$/);
    if (f) { const k = { notato: 'notato', penso: 'penso', sicurezza: 'sicurezza', 'non so': 'nonso' }[f[1].toLowerCase().trim()]; if (k) cur[k] = f[2]; }
  }
  return out;
}

// proposals.md: `- **P-094** · AAAA-MM-GG · text · tipo · fonte · **stato** …`
const STATES = ['proposta', 'accettata', 'rifiutata', 'applicata', 'confermata', 'inutile', 'peggiorata', 'tolta', 'sospesa', 'scartata', 'sostituita'];
const isState = s => STATES.some(x => s.toLowerCase().startsWith(x));
// The text itself may hold " · ": fields are anchored on the first one that opens with a bold state (**applicata** …):
// fonte = the field before it, tipo the one before that, the proposal = everything earlier.
export function proposals(text) {
  const out = [];
  for (const l of lines(text)) {
    const m = l.match(/^- \*\*(P-\d+)\*\* · (\d{4}-\d{2}-\d{2}) · (.*)$/);
    if (!m) continue;
    const p = fields(m[3]);
    const k = p.findIndex((x, i) => i >= 2 && /^\*\*([^*]+)\*\*/.test(x) && isState(x.match(/^\*\*([^*]+)\*\*/)[1].trim()));
    const bold = [...m[3].matchAll(/\*\*([^*]+)\*\*/g)].map(x => x[1].toLowerCase().trim());
    const stato = (k >= 0 ? p[k].match(/^\*\*([^*]+)\*\*/)[1].toLowerCase().trim() : [...bold].reverse().find(isState) ?? '').split(/\s/)[0];
    out.push(k >= 0
      ? { id: m[1], data: m[2], proposta: strip(p.slice(0, k - 2).join(' · ')), tipo: strip(p[k - 2]), stato, dettaglio: strip(p.slice(k - 1).join(' · ')) }
      : { id: m[1], data: m[2], proposta: strip(p[0]), tipo: '', stato, dettaglio: strip(p.slice(1).join(' · ')) });
  }
  return out;
}

// bug-log.md: `- date · repo/area · bug · pattern · source · ref`
export function bugLog(text) {
  const out = [];
  for (const l of lines(text)) {
    const m = l.match(/^- (\d{4}-\d{2}-\d{2}) · (.*)$/);
    if (!m) continue;
    const p = fields(m[2]);
    out.push({ data: m[1], area: p[0] ?? '', bug: p[1] ?? '', pattern: p[2] ?? '', fonte: p[3] ?? '', rif: p.slice(4).join(' · ') });
  }
  return out;
}

// JSON lines (measures.jsonl, inbox.log, envs.log): bad lines skipped.
export function jsonl(text) {
  const out = [];
  for (const l of lines(text)) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch { /* partial line */ } }
  return out;
}
