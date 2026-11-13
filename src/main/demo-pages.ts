// HTML of the demo browser tabs (SB_DEMO=1): fictional "Alfa" back-office pages (a refund, a customer's activities)
// loaded as data: URLs, with a small page script that moves a visible agent cursor and highlights the clicked element.
// Why: the browser tiles, their live thumbnails and the e2e screenshots need real-looking pages with no network.
// Its texts in the UI language through demo-text.ts. Used by demo-browser.ts only. Fictional data: no real people, companies or customers.

import { demoLang, tr } from './demo-text';

export type DemoPage = 'nota' | 'sms' | 'blank';

const css = `
*{box-sizing:border-box}html,body{margin:0;height:100%;font:13px/1.45 "Segoe UI",system-ui,sans-serif;color:#1b2433;background:#f3f5f9;overflow:hidden}
.nav{height:44px;background:#1f5fbf;color:#fff;display:flex;align-items:center;gap:18px;padding:0 16px}
.nav b{font-weight:600;letter-spacing:.01em}.nav span{opacity:.85;font-size:12px}.nav .sp{flex:1}.nav .av{width:24px;height:24px;border-radius:50%;background:#ffffff33}
.side{position:absolute;top:44px;bottom:0;left:0;width:170px;background:#e8edf5;padding:12px 8px}
.side div{padding:7px 10px;border-radius:6px;color:#3b4a61;margin-bottom:2px}.side .on{background:#fff;color:#1f5fbf;font-weight:600;box-shadow:0 1px 2px #0001}
.main{position:absolute;top:44px;left:170px;right:0;bottom:0;padding:16px 22px;overflow:hidden}
.crumb{font-size:12px;color:#6b778c;margin-bottom:4px}h1{font-size:19px;margin:0 0 14px;font-weight:600}
.card{background:#fff;border:1px solid #dfe5ee;border-radius:8px;padding:14px 16px;margin-bottom:12px}
.grid{display:grid;grid-template-columns:150px 1fr;gap:8px 12px}.grid .k{color:#6b778c}
.bad{color:#c62f3b;font-weight:600}.ok{color:#1d8a52;font-weight:600}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #edf0f5}th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b778c;font-weight:600}
.btns{display:flex;gap:8px}.b{padding:7px 14px;border-radius:6px;border:1px solid #c9d3e2;background:#fff;color:#1b2433}.b.p{background:#1f5fbf;border-color:#1f5fbf;color:#fff;font-weight:600}
.tabs{display:flex;gap:4px;border-bottom:1px solid #dfe5ee;margin-bottom:12px}.tabs div{padding:7px 12px;color:#6b778c}.tabs .on{color:#1f5fbf;border-bottom:2px solid #1f5fbf;font-weight:600}
.pill{display:inline-block;font-size:11px;padding:1px 8px;border-radius:99px;background:#e8edf5;color:#3b4a61}.pill.err{background:#fde7e9;color:#c62f3b}.pill.ok{background:#e3f6ec;color:#1d8a52}
#cur{position:fixed;width:18px;height:18px;margin:-9px 0 0 -9px;border:2.5px solid #ff5a36;border-radius:50%;box-shadow:0 0 0 6px #ff5a3633;pointer-events:none;transition:left .5s cubic-bezier(.2,.8,.2,1),top .5s cubic-bezier(.2,.8,.2,1);z-index:9}
#cur.click{box-shadow:0 0 0 12px #ff5a3622}
`;

const script = `
window.__sb={move:function(x,y){var c=document.getElementById('cur');c.style.left=x+'%';c.style.top=y+'%';c.classList.add('click');setTimeout(function(){c.classList.remove('click')},350)}};
`;

const nav = (host: string, section: string) => `<div class="nav"><b>Alfa</b><span>${host}</span><span>${section}</span><div class="sp"></div><span>${tr('Azienda di prova')}</span><div class="av"></div></div>`;
const side = (on: string) => `<div class="side">${['Dashboard', 'Clienti', 'Ordini', 'Fatture', 'Magazzino', 'Report'].map(x => tr(x)).map(s => `<div class="${s === on ? 'on' : ''}">${s}</div>`).join('')}</div>`;

function body(page: DemoPage): string {
  if (page === 'nota') {
    return `${nav('test', tr('ambiente di test'))}${side(tr('Ordini'))}<div class="main">
<div class="crumb">${tr('Ordini › Rimborsi')}</div><h1>${tr('Rimborso 2026/118')}</h1>
<div class="card"><div class="grid">
<div class="k">${tr('Cliente')}</div><div>${tr('Cliente di prova')}</div>
<div class="k">${tr('Fattura originale')}</div><div>${tr('2026/097 · 120,00 €')}</div>
<div class="k">${tr('Sconto fattura')}</div><div>10 %</div>
<div class="k">${tr('Totale rimborso')}</div><div class="bad">${tr('120,00 € (atteso 108,00 €)')}</div>
</div></div>
<div class="card"><table><tr><th>${tr('Voce')}</th><th>${tr('Qtà')}</th><th>${tr('Importo')}</th></tr>
<tr><td>${tr('Abbonamento base')}</td><td>1</td><td>${tr('80,00 €')}</td></tr><tr><td>${tr('Assistenza')}</td><td>1</td><td>${tr('40,00 €')}</td></tr></table></div>
<div class="btns"><span class="b p">${tr('Emetti rimborso')}</span><span class="b">${tr('Annulla')}</span></div>
</div><div id="cur" style="left:33%;top:78%"></div>`;
  }
  if (page === 'sms') {
    return `${nav('test-2', tr('ambiente di test 2'))}${side(tr('Clienti'))}<div class="main">
<div class="crumb">${tr('Clienti › Cliente di prova')}</div><h1>${tr('Cliente di prova')}</h1>
<div class="tabs"><div>${tr('Anagrafica')}</div><div class="on">${tr('Attività')}</div><div>${tr('Documenti')}</div><div>${tr('Ordini')}</div></div>
<div class="card" style="display:flex;justify-content:space-between;align-items:center"><div><b>${tr('Promemoria rinnovo')}</b><br><span style="color:#6b778c">${tr('SMS al +39 333 000 0000 · domani 9:00')}</span></div><span class="b p">${tr('Invia SMS')}</span></div>
<div class="card"><table><tr><th>${tr('Attività')}</th><th>${tr('Quando')}</th><th>${tr('Stato')}</th></tr>
<tr><td>${tr('SMS promemoria rinnovo')}</td><td>${tr('oggi 10:12')}</td><td><span class="pill err">${tr('non inviato')}</span></td></tr>
<tr><td>${tr('Email conferma ordine')}</td><td>${tr('ieri 17:40')}</td><td><span class="pill ok">${tr('inviata')}</span></td></tr>
<tr><td>${tr('Sollecito pagamento')}</td><td>${tr('3 ott')}</td><td><span class="pill">${tr('pianificato')}</span></td></tr></table></div>
</div><div id="cur" style="left:34%;top:21%"></div>`;
  }
  return `${nav(tr('nuova scheda'), '')}<div class="main" style="left:0"><h1>${tr('Nuova scheda')}</h1><div class="card">${tr('Pagina vuota della demo.')}</div></div><div id="cur" style="left:50%;top:50%"></div>`;
}

export function pageUrl(page: DemoPage): string {
  const html = `<!doctype html><html lang="${demoLang()}"><head><meta charset="utf-8"><title>Alfa</title><style>${css}</style></head><body>${body(page)}<script>${script}</script></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
