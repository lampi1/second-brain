// The demo's artifacts (ADR 0319): a few fictional reports, documents, screenshots and a PDF written into the demo brain's
// reviews/, tmp/ and evidence/ and into two demo chats' evidence folders, dated around the demo's clock, so Memoria →
// Artifact has content with no real brain: a report with two versions (one file regenerated, one copied with -v2), an
// HTML report, a PDF, screenshots, and one file that went (shown as missing). Fictional data only. Used by index.ts in
// demo mode, before the first scan.
import fs from 'node:fs';
import path from 'node:path';

const H = 3600e3, D = 24 * H;

/** A one-page PDF with a title and a few lines (Helvetica, no fonts embedded), with a correct cross-reference table. */
export function tinyPdf(title: string, lines: readonly string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, m => `\\${m}`).replace(/[^\x20-\x7e]/g, '?');
  const text = [`BT /F1 22 Tf 64 760 Td (${esc(title)}) Tj ET`, ...lines.map((l, i) => `BT /F1 12 Tf 64 ${716 - i * 22} Td (${esc(l)}) Tj ET`)].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const QA_HTML = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>QA rimborsi · esito della giornata</title>
<meta name="description" content="Dodici scenari di rimborso provati sul checkout di prova: dieci passano, uno è bloccato dal login e uno ha un arrotondamento sbagliato sul totale.">
<style>body{font-family:Segoe UI,system-ui,sans-serif;color:#1f2430;margin:0;background:#f5f6fa}header{background:linear-gradient(120deg,#3b4cca,#7a5af8);color:#fff;padding:28px 36px}
h1{margin:0 0 6px;font-size:28px}header p{margin:0;opacity:.85}main{padding:24px 36px}.cards{display:flex;gap:14px;margin-bottom:22px}.card{flex:1;background:#fff;border-radius:10px;padding:16px 18px;box-shadow:0 2px 8px rgba(20,30,60,.08)}
.card b{display:block;font-size:30px}.ok b{color:#1f9d55}.ko b{color:#d64545}.wait b{color:#c98a12}table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:10px 14px;border-bottom:1px solid #eceef4;font-size:14px}th{background:#eef0f7}.pill{padding:2px 8px;border-radius:99px;font-size:12px;font-weight:600}.p-ok{background:#e3f6ec;color:#1f9d55}.p-ko{background:#fde8e8;color:#d64545}.p-w{background:#fdf3dc;color:#a6730c}</style></head>
<body><header><h1>QA rimborsi · esito della giornata</h1><p>Checkout di prova · 12 scenari · ambiente test</p></header><main>
<div class="cards"><div class="card ok"><b>10</b>passati</div><div class="card ko"><b>1</b>fallito</div><div class="card wait"><b>1</b>bloccato</div></div>
<table><tr><th>Scenario</th><th>Esito</th><th>Nota</th></tr>
<tr><td>Rimborso totale con carta</td><td><span class="pill p-ok">ok</span></td><td>Accredito visibile in 2 s</td></tr>
<tr><td>Rimborso parziale con sconto</td><td><span class="pill p-ko">ko</span></td><td>Totale arrotondato due volte: 0,01 € in meno</td></tr>
<tr><td>Rimborso dopo cambio indirizzo</td><td><span class="pill p-w">bloccato</span></td><td>Il login di prova scade a metà flusso</td></tr>
<tr><td>Rimborso con buono regalo</td><td><span class="pill p-ok">ok</span></td><td>Buono riemesso con la stessa scadenza</td></tr></table></main></body></html>`;

const ENGINES_HTML = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Confronto motori su dieci compiti</title>
<style>body{font-family:Segoe UI,system-ui,sans-serif;margin:0;background:#0f1422;color:#e8ecf6}main{padding:30px 38px}h1{margin:0 0 4px;font-size:26px}.sub{color:#9aa6c4;margin:0 0 24px}
.row{display:grid;grid-template-columns:150px 1fr 70px;gap:12px;align-items:center;margin:12px 0}.bar{height:16px;border-radius:8px;background:linear-gradient(90deg,#5b8cff,#9b6bff)}.b2{background:linear-gradient(90deg,#2fd6b0,#5cc8ff)}.b3{background:linear-gradient(90deg,#f2b64c,#ff7a59)}
.note{margin-top:26px;padding:14px 16px;border-radius:10px;background:#18203a;color:#c4cde4}</style></head>
<body><main><h1>Confronto motori su dieci compiti</h1><p class="sub">Stessi compiti, stesso brain: quanti chiusi al primo colpo e con che costo.</p>
<div class="row"><span>Claude Code</span><div class="bar" style="width:90%"></div><b>9/10</b></div>
<div class="row"><span>Codex</span><div class="bar b2" style="width:70%"></div><b>7/10</b></div>
<div class="row"><span>OpenCode</span><div class="bar b3" style="width:60%"></div><b>6/10</b></div>
<p class="note">Il costo medio per compito chiuso resta sotto 0,40 $ per tutti e tre; le differenze vere sono nei compiti con test da scrivere.</p></main></body></html>`;

const COSTS_V1 = `# Analisi dei costi degli agenti\n\nIn una settimana gli agenti hanno speso 31 $ su 46 compiti: due terzi della spesa viene da tre compiti lunghi di QA, rifatti perché il login di prova scadeva.\n\n## Dove va la spesa\n\n| Ruolo | Compiti | Spesa |\n|---|---|---|\n| Scout | 18 | 4,10 $ |\n| Artisan | 15 | 12,80 $ |\n| Sentinel | 13 | 14,30 $ |\n`;
const COSTS_V2 = `# Analisi dei costi degli agenti\n\nDopo il login di prova che non scade più, la spesa settimanale scende a 22 $ su 51 compiti: la QA rifatta è sparita e il Sentinel costa la metà.\n\n## Dove va la spesa\n\n| Ruolo | Compiti | Spesa |\n|---|---|---|\n| Scout | 20 | 4,40 $ |\n| Artisan | 17 | 10,90 $ |\n| Sentinel | 14 | 6,70 $ |\n\n## Cosa cambia\n\n- Il login di prova dura tutto il flusso.\n- Le QA ripetute sono passate da 9 a 1.\n`;
const PLAN_MD = `# Piano di rilascio 1.0\n\nTre passi per portare l’app alla 1.0 senza fermare il lavoro di tutti i giorni: prima la pulizia delle impostazioni, poi l’installer firmato, infine la guida per chi parte da zero.\n\n1. Impostazioni: togliere le voci doppie.\n2. Installer: firma e aggiornamento in un clic.\n3. Guida: i primi dieci minuti.\n`;
const NOTES_MD = `# Note di rilascio · sconti percentuali\n\nLo sconto percentuale si applica sul prezzo pieno con un solo arrotondamento, così il totale dell’ordine torna uguale a quello del carrello.\n`;
const OLD_MD = `# Bozza del confronto prezzi\n\nUna prima bozza del confronto dei prezzi dei fornitori, poi cancellata dal disco.\n`;

const REFUNDS_CSV = 'scenario;esito;tempo_s;note\nRimborso totale;ok;4.2;\nRimborso parziale;ok;3.9;\nDoppio clic su Rimborsa;ok;4.0;un solo rimborso\nCarta scaduta;ok;2.1;messaggio chiaro\nImporto oltre il pagato;ok;1.8;bloccato\nRimborso dopo 90 giorni;ok;2.4;bloccato\n';
const FLOW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 300" font-family="Segoe UI,system-ui,sans-serif" font-size="15">
<rect width="480" height="300" fill="#f7f8fb"/>
<g fill="#fff" stroke="#5b8def" stroke-width="2"><rect x="30" y="40" width="130" height="56" rx="10"/><rect x="320" y="40" width="130" height="56" rx="10"/><rect x="175" y="200" width="130" height="56" rx="10"/></g>
<g stroke="#5b8def" stroke-width="2" fill="none"><path d="M160 68h160"/><path d="M385 96v60H240v44"/></g>
<g fill="#1d2330" text-anchor="middle"><text x="95" y="73">Ordine</text><text x="385" y="73">Rimborso</text><text x="240" y="233">Conferma</text></g>
<text x="240" y="150" fill="#5b6475" font-size="12" text-anchor="middle">un solo rimborso per ordine</text>
</svg>`;

/** Writes the demo's artifacts (once per folder) and dates them around `now`; returns what a chat «linked» in the
 *  demo (chat id → texts) and the file to delete after the first scan (it then shows as missing). */
export function seedDemoArtifacts(o: { brain: string; userData: string; appPath: string; now: number }): { links: Record<string, string[]>; vanish: string } {
  const w = (rel: string, body: string | Buffer, ago: number, root = o.brain) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, body);
    const at = new Date(o.now - ago);
    fs.utimesSync(file, at, at);
    return file;
  };
  const qa = w(path.join('reviews', 'qa-rimborsi', 'report.html'), QA_HTML, 1.5 * H);
  w(path.join('reviews', 'analisi-costi-agenti.md'), COSTS_V1, 6 * D);
  const costs = w(path.join('reviews', 'analisi-costi-agenti-v2.md'), COSTS_V2, 3 * H);
  w(path.join('reviews', 'piano-rilascio-1-0.md'), PLAN_MD, 26 * H);
  w(path.join('tmp', 'confronto-motori.html'), ENGINES_HTML, 3 * D);
  w(path.join('reviews', 'note-rilascio-sconti.md'), NOTES_MD, 5 * H);
  w(path.join('reviews', 'audit-sicurezza.pdf'), tinyPdf('Audit sicurezza - novembre', ['Nessuna chiave nei file del repository.', 'MCP solo su 127.0.0.1.', 'Due dipendenze da aggiornare entro fine mese.']), 12 * D);
  const vanish = w(path.join('tmp', 'bozza-confronto-prezzi.md'), OLD_MD, 40 * D);
  // every kind of file (the owner: «un po' tutto»): a table, a picture drawn as SVG, a Word document (an empty shell)
  const csv = w(path.join('tmp', 'export-rimborsi.csv'), REFUNDS_CSV, 1.6 * H);
  w(path.join('reviews', 'qa-rimborsi', 'flusso-rimborsi.svg'), FLOW_SVG, 1.7 * H);
  w(path.join('reviews', 'verbale-riunione-rilascio.docx'), Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.alloc(26)]), 2 * D);
  const shots = path.join(o.appPath, 'docs', 'mockups', 'routines', 'png');
  const ev = path.join(o.userData, 'evidence');
  for (const [name, chat, ago] of [['app-routine-list.png', 'qa', 2 * H], ['app-routine-detail.png', 'qa', 2.2 * H], ['app-routine-now.png', 'fix', 30 * H]] as const) {
    try { w(path.join(`chat-${chat}`, name.replace(/^app-/, 'schermata-')), fs.readFileSync(path.join(shots, name)), ago, ev); } catch { /* the demo goes on without it */ }
  }
  return {
    links: { qa: [`Report pronto: ${qa}`, `Dati grezzi: ${csv}`], mappa: [`Analisi aggiornata: [costi](${costs})`] },
    vanish,
  };
}
