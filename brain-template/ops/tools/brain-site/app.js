// Brain site, shared pieces: routing, data loading, tables, charts, markdown, exports, theme. Pages live in pages.js,
// the 3D map in map3d.js. Every number on screen comes from /api/* (the real files), nothing is typed here.
'use strict';
const App = (() => {
  const pages = [];
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // el('div.card', {attrs}, children...) — tiny DOM builder; strings are text, never HTML.
  function el(sel, attrs, ...kids) {
    const [head, ...cls] = sel.split('.');
    const [tag, id] = head.split('#');
    const n = document.createElement(tag || 'div');
    if (id) n.id = id;
    if (cls.length) n.className = cls.join(' ');
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
    for (const [k, v] of Object.entries(attrs ?? {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'html') n.innerHTML = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return n;
  }

  const fmt = {
    usd: v => (v == null ? '' : `${Number(v).toLocaleString('it-IT', { minimumFractionDigits: v < 10 ? 2 : 0, maximumFractionDigits: v < 10 ? 2 : 0 })} $`),
    int: v => (v == null ? '' : Number(v).toLocaleString('it-IT')),
    k: v => (v == null ? '' : v >= 1e6 ? `${(v / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 1 })}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(v)),
    date: s => { if (!s) return ''; const d = new Date(s); return isNaN(d) ? s : d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' }); },
    when: s => { if (!s) return ''; const d = new Date(s); return isNaN(d) ? s : d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); },
    ago: t => { if (!t) return ''; const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 1 ? 'adesso' : m < 60 ? `${m} min fa` : m < 1440 ? `${Math.round(m / 60)} h fa` : `${Math.round(m / 1440)} giorni fa`; },
    day: s => { const d = new Date(`${s}T12:00:00`); return isNaN(d) ? s : d.toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit' }); },
  };
  const daysAgo = s => Math.floor((Date.now() - new Date(`${s}T12:00:00`)) / 864e5);

  async function api(path, { fresh = false } = {}) {
    const url = fresh ? `${path}${path.includes('?') ? '&' : '?'}fresh=1` : path;
    const r = await fetch(url);
    const j = await r.json().catch(() => ({ error: `risposta non valida da ${path}` }));
    if (!r.ok || j?.error && !('value' in j)) throw new Error(j?.error ?? `errore ${r.status}`);
    return j;
  }

  function toast(text) {
    const t = $('#toast'); t.textContent = text; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // Downloads (local site: normal file saves work).
  function download(name, text, type = 'text/plain') {
    const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`Scaricato ${name}`);
  }
  const csvCell = v => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  // Semicolon + BOM: Excel in Italian opens it in columns at once.
  const toCsv = (cols, rows) => `\ufeff${[cols.map(c => csvCell(c.label)).join(';'), ...rows.map(r => cols.map(c => csvCell(c.csv ? c.csv(r) : r[c.key])).join(';'))].join('\r\n')}`;
  const stamp = () => new Date().toISOString().slice(0, 10);

  // ---------- Explain box ({{OWNER}} 2026-10-10: "più spiegazione di cosa indica ogni tabella... catturare la mia
  // attenzione"): the discovery from the real data first, in bold, then what to do next, then in small what the
  // table says and why it matters. `find` and `next` may hold <b> markup: data inside them goes through esc().
  // v2 ({{OWNER}} 2026-10-11, "troppo confusionario"): only the discovery and the next step are visible; what the table
  // says and why it matters open on request.
  function explain({ find, next, says, why } = {}) {
    if (!find && !says) return null;
    return el('div.explain',
      find ? el('p.ex-find', { html: find }) : null,
      next ? el('p.ex-next', { html: `→ ${next}` }) : null,
      says || why ? el('details.ex-meta', el('summary', 'Cosa significa?'), el('p', says ? [el('b', 'Cosa ti dice: '), says, ' '] : null, why ? [el('b', 'Perché ti interessa: '), why] : null)) : null);
  }

  // ---------- Table ----------
  // cols: [{key, label, type:'num'|'usd'|'date'|'text', render(row)->Node|string, clip:true, nowrap, csv(row)}]
  // cols[].help = the column's meaning, shown on mouse-over (title) and in the phone card label
  function table({ cols, rows, name = 'tabella', filters = [], sort, search = true, pageSize = 40, detail, empty = 'Niente da mostrare.', explain: ex }) {
    const state = { q: '', f: {}, sort: sort ?? null, limit: pageSize, open: new Set() };
    const root = el('div.tbl');
    const bar = el('div.tbl-bar');
    const count = el('span.tbl-count');
    const body = el('tbody');
    const head = el('tr');
    if (search) bar.append(el('input', { type: 'search', placeholder: 'Cerca in tabella…', 'aria-label': `Cerca in ${name}`, oninput: e => { state.q = e.target.value.toLowerCase(); state.limit = pageSize; draw(); } }));
    for (const key of filters) {
      const col = cols.find(c => c.key === key) ?? { key, label: key };
      const vals = [...new Set(rows.map(r => r[key]).filter(v => v !== '' && v != null))].sort((a, b) => String(a).localeCompare(String(b), 'it'));
      if (vals.length < 2) continue;
      bar.append(el('select', { 'aria-label': `Filtra per ${col.label}`, onchange: e => { state.f[key] = e.target.value; state.limit = pageSize; draw(); } },
        el('option', { value: '' }, `${col.label}: tutti`), vals.map(v => el('option', { value: v }, `${v} (${rows.filter(r => r[key] === v).length})`))));
    }
    bar.append(count, el('span', { style: 'flex:1' }),
      el('button.btn', { type: 'button', onclick: () => download(`${name}-${stamp()}.csv`, toCsv(cols, visible()), 'text/csv'), title: 'Scarica le righe filtrate in CSV (Excel)' }, 'CSV'),
      el('button.btn', { type: 'button', onclick: () => download(`${name}-${stamp()}.json`, JSON.stringify(visible(), null, 2), 'application/json'), title: 'Scarica le righe filtrate in JSON' }, 'JSON'));
    for (const c of cols) head.append(el(`th${c.help ? '.has-help' : ''}`, { scope: 'col', tabindex: 0, title: c.help ? `${c.help} (clic per ordinare)` : 'Clic per ordinare', onclick: () => sortBy(c.key), onkeydown: e => { if (e.key === 'Enter') sortBy(c.key); } }, c.label));
    const more = el('button.btn.more', { type: 'button', onclick: () => { state.limit += pageSize * 3; draw(); } });
    root.append(...[explain(ex), bar, el('div.tbl-wrap', el('table.data', el('thead', head), body)), more].filter(Boolean));

    function sortBy(key) {
      state.sort = state.sort?.key === key ? { key, dir: -state.sort.dir } : { key, dir: (cols.find(c => c.key === key)?.type ?? 'text') === 'text' ? 1 : -1 };
      draw();
    }
    function visible() {
      let r = rows.filter(x => Object.entries(state.f).every(([k, v]) => !v || String(x[k]) === v));
      if (state.q) r = r.filter(x => cols.some(c => String(c.csv ? c.csv(x) : x[c.key] ?? '').toLowerCase().includes(state.q)) || JSON.stringify(x).toLowerCase().includes(state.q));
      if (state.sort) {
        const { key, dir } = state.sort;
        r = [...r].sort((a, b) => { const x = a[key], y = b[key]; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'it', { numeric: true })) * dir; });
      }
      return r;
    }
    function cell(c, r) {
      const v = r[c.key];
      const out = c.render ? c.render(r) : c.type === 'usd' ? fmt.usd(v) : c.type === 'num' ? fmt.int(v) : c.type === 'date' ? (v ?? '') : (v ?? '');
      const td = el(`td${c.type === 'num' || c.type === 'usd' ? '.num' : ''}${c.nowrap ? '.nowrap' : ''}`, { 'data-label': c.label, title: c.help ?? null });
      // an empty cell stays truly empty, so the phone card hides its label (td:empty)
      if (out instanceof Node) td.append(out); else if (String(out) === '') { /* empty */ } else if (c.clip) td.append(el('div.clip', String(out))); else td.append(String(out));
      return td;
    }
    function draw() {
      [...head.children].forEach((th, i) => th.setAttribute('aria-sort', state.sort?.key === cols[i].key ? (state.sort.dir > 0 ? 'ascending' : 'descending') : 'none'));
      const r = visible();
      count.textContent = `${r.length === rows.length ? r.length : `${r.length} di ${rows.length}`} righe`;
      body.replaceChildren();
      if (!r.length) body.append(el('tr', el('td', { colspan: cols.length, class: 'muted' }, empty)));
      for (const x of r.slice(0, state.limit)) {
        const tr = el('tr.row', { tabindex: 0 }, cols.map(c => cell(c, x)));
        const id = rows.indexOf(x);
        const toggle = () => { state.open.has(id) ? state.open.delete(id) : state.open.add(id); draw(); };
        tr.addEventListener('click', e => { if (!e.target.closest('a,button')) toggle(); });
        tr.addEventListener('keydown', e => { if (e.key === 'Enter') toggle(); });
        body.append(tr);
        if (state.open.has(id)) body.append(el('tr.detail', el('td', { colspan: cols.length }, detail ? detail(x) : kv(x))));
      }
      more.hidden = r.length <= state.limit;
      more.textContent = `Mostra altre ${Math.min(pageSize * 3, r.length - state.limit)} (di ${r.length - state.limit})`;
    }
    draw();
    return root;
  }
  // Every field of a row, as label: value.
  const kv = (o, labels = {}) => el('dl.kv', Object.entries(o).filter(([k, v]) => !k.startsWith('_') && v !== '' && v != null).flatMap(([k, v]) => [el('dt', labels[k] ?? k), el('dd', typeof v === 'object' ? JSON.stringify(v, null, 1) : String(v))]));

  // ---------- Charts (Chart.js), themed from the CSS tokens, PNG export ----------
  const charts = new Set();
  const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  // Categorical palette (dataviz reference, validated light/dark): fixed order, never cycled; past 8 → grey "altro".
  const palette = () => [1, 2, 3, 4, 5, 6, 7, 8].map(i => tok(`--cat-${i}`));
  const catColors = n => { const p = palette(); return Array.from({ length: n }, (_, i) => p[i] ?? tok('--cat-other')); };
  // categorical: true → one bar per category, each with its own color (a legend-free bar chart of named things)
  function chart({ title, note, type = 'bar', labels, datasets, options = {}, tall = false, name = 'grafico', horizontal = false, stacked = false, money = false, categorical = false, explain: ex }) {
    if (categorical) datasets = datasets.map(d => ({ ...d, colors: () => catColors(labels.length) }));
    const canvas = el('canvas', { role: 'img', 'aria-label': title });
    // a horizontal bar chart grows with its rows, so every label stays readable
    const box = el('div.chart-box' + (tall ? '.tall' : ''), horizontal ? { style: `height:${Math.max(220, labels.length * 24 + 50)}px` } : null, canvas);
    const wrap = el('div.chart.card',
      el('div.chart-head', el('div', el('h3', title), note ? el('div.muted.small', note) : null),
        el('div.btn-row',
          el('button.btn', { type: 'button', title: 'Scarica il grafico come immagine', onclick: () => { const a = el('a', { href: canvas.toDataURL('image/png'), download: `${name}-${stamp()}.png` }); a.click(); toast(`Scaricato ${name}.png`); } }, 'PNG'),
          el('button.btn', { type: 'button', title: 'Scarica i numeri del grafico in CSV', onclick: () => {
            const cols = [{ key: 'label', label: 'voce' }, ...datasets.map((d, i) => ({ key: `d${i}`, label: d.label ?? title }))];
            download(`${name}-${stamp()}.csv`, toCsv(cols, labels.map((l, j) => Object.fromEntries([['label', l], ...datasets.map((d, i) => [`d${i}`, d.data[j]])]))), 'text/csv');
          } }, 'CSV'))),
      explain(ex), box);
    const make = () => {
      // grid lines from the muted ink at 25%: --line is solid black in the Segnale look
      const fg = tok('--muted'), grid = /^#[0-9a-f]{6}$/i.test(fg) ? `${fg}40` : tok('--line'), pal = palette();
      Chart.defaults.font.family = tok('--font-body');
      const ds = datasets.map((d, i) => ({ borderWidth: type === 'line' ? 2 : 0, borderRadius: type === 'bar' ? 4 : 0, pointRadius: type === 'line' ? 2 : 0, tension: 0.25,
        // colors may be a function: resolved at every draw, so a theme switch recolors the bars
        backgroundColor: (typeof d.colors === 'function' ? d.colors() : d.colors) ?? (type === 'line' ? `${pal[i % pal.length]}33` : pal[i % pal.length]), borderColor: pal[i % pal.length], fill: type === 'line' && datasets.length === 1, ...d, colors: undefined }));
      // only the value axis gets a callback: an explicit undefined would replace the category labels with indexes
      const valTicks = { color: fg, ...(money ? { callback: v => `${Math.round(v)} $` } : {}) };
      const catTicks = { color: fg, autoSkip: true, maxRotation: 0 };
      return new Chart(canvas, {
        type, data: { labels, datasets: ds },
        options: { responsive: true, maintainAspectRatio: false, animation: false, indexAxis: horizontal ? 'y' : 'x',
          plugins: { legend: { display: datasets.length > 1, labels: { color: fg, boxWidth: 12 } },
            tooltip: { callbacks: money ? { label: c => `${c.dataset.label ? `${c.dataset.label}: ` : ''}${fmt.usd(c.parsed[horizontal ? 'x' : 'y'])}` } : {} } },
          scales: type === 'doughnut' ? {} : {
            x: { stacked, ticks: horizontal ? valTicks : catTicks, grid: { color: horizontal ? grid : 'transparent' }, beginAtZero: true },
            y: { stacked, ticks: horizontal ? { ...catTicks, autoSkip: false, callback(v) { const l = String(this.getLabelForValue(v)); return l.length > 24 ? `${l.slice(0, 23)}…` : l; } } : valTicks, grid: { color: horizontal ? 'transparent' : grid }, beginAtZero: true } },
          ...options },
      });
    };
    let c = null;
    const draw = () => { c?.destroy(); c = make(); };
    requestAnimationFrame(draw);
    charts.add(draw);
    return wrap;
  }
  const redrawCharts = () => { for (const d of charts) { try { d(); } catch { charts.delete(d); } } };

  // ---------- Markdown, with tables you can sort-free export ----------
  function md(text, { wide = false, base = '' } = {}) {
    const div = el(`div.md${wide ? '.wide' : ''}`);
    div.innerHTML = DOMPurify.sanitize(marked.parse(String(text ?? ''), { gfm: true, breaks: false }));
    div.querySelectorAll('table').forEach((t, i) => {
      const wrap = el('div.md-table'); t.replaceWith(wrap); wrap.append(t);
      const rows = [...t.rows].map(r => [...r.cells].map(c => c.textContent.trim()));
      wrap.after(el('div.md-table-bar', el('button.btn', { type: 'button', onclick: () => download(`${(base || 'tabella').replace(/[^\w-]+/g, '-')}-${i + 1}.csv`, `\ufeff${rows.map(r => r.map(csvCell).join(';')).join('\r\n')}`, 'text/csv') }, 'Tabella in CSV')));
    });
    // links to brain files open in the explorer
    div.querySelectorAll('a[href]').forEach(a => { const h = a.getAttribute('href'); if (/^https?:/.test(h)) { a.target = '_blank'; a.rel = 'noopener'; } });
    div.querySelectorAll('code').forEach(c => {
      const t = c.textContent.trim();
      if (/^[\w./-]+\.(md|mjs|jsonl?)$/.test(t) && !t.includes('..') && App.files?.has(t.replace(/^{{BRAIN_RE}}\//, ''))) {
        const p = t.replace(/^{{BRAIN_RE}}\//, '');
        c.replaceWith(el('a', { href: `#esplora/${encodeURI(p)}` }, el('code', t)));
      }
    });
    return div;
  }

  // ---------- Page frame ----------
  function head(title, lead, { at, onRefresh } = {}) {
    const meta = el('div.meta');
    if (at) meta.append(`aggiornato ${fmt.ago(at)}`);
    if (onRefresh) meta.append(el('button.btn', { type: 'button', onclick: onRefresh, title: 'Rilegge i file adesso' }, 'Aggiorna'));
    return el('div.section', el('div.page-head', el('h1', title), meta), lead ? el('p.lead', { html: lead }) : null);
  }
  const section = (title, note, ...kids) => el('section.section', el('div.section-head', el('h2', title), note ? el('p', note) : null), ...kids);
  const kpis = items => el('div.kpis', items.filter(Boolean).map(([k, v, s]) => el('div.kpi', el('span.k', k), el('span.v', v), s ? el('span.s', s) : null)));
  const loading = (t = 'Leggo i file…') => el('p.loading', t);
  const errorBox = e => el('p.error', `Non riesco a leggere: ${e.message ?? e}. Il server è acceso? (node ops/tools/brain-site.mjs)`);
  function tabs(items, onPick, current) {
    const bar = el('div.tabs', { role: 'tablist' });
    for (const [id, label] of items) bar.append(el('button', { type: 'button', role: 'tab', 'aria-selected': String(id === current), onclick: () => onPick(id) }, label));
    return bar;
  }

  // ---------- Routing ----------
  let cleanup = null, routeGen = 0;
  // nav: false = reachable by link, not in the menu
  function page(id, label, render, { nav = true } = {}) { pages.push({ id, label, render, nav }); }
  async function route() {
    const [id, ...rest] = (location.hash.slice(1) || 'home').split('/');
    // the 3D map is not a page: it opens full screen over the page you are on (map3d.js)
    if (id === 'mappa') { App.openMap?.(decodeURI(rest.join('/'))); if ($('#main').childElementCount) return; history.replaceState(null, '', `#home`); return route().then(() => App.openMap?.(decodeURI(rest.join('/')))); }
    App.closeMap?.(true);
    App.lastHash = location.hash || '#home'; // where the map's close button goes back to
    const p = pages.find(x => x.id === id) ?? pages[0];
    document.querySelectorAll('#nav a').forEach(a => a.setAttribute('aria-current', a.dataset.id === p.id ? 'page' : 'false'));
    $(`#nav a[data-id="${p.id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    try { cleanup?.(); } catch { /* ignore */ }
    cleanup = null; charts.clear();
    const main = $('#main');
    main.replaceChildren(loading());
    document.title = `${p.label} · second-brain`;
    // a page that finishes after you already went elsewhere is stopped at once (its timers never outlive it)
    const gen = ++routeGen;
    try { const c = await p.render(main, decodeURI(rest.join('/'))) ?? null; if (gen === routeGen) cleanup = c; else try { c?.(); } catch { /* ignore */ } }
    catch (e) { main.replaceChildren(errorBox(e)); console.error(e); }
  }

  function start() {
    const nav = $('#nav');
    const ORDER = ['home', 'adesso', 'fatto', 'dafare', 'spunti', 'idee', 'costi', 'qualita', 'esplora'];
    pages.sort((a, b) => (ORDER.indexOf(a.id) + 99) % 99 - (ORDER.indexOf(b.id) + 99) % 99);
    for (const p of pages.filter(x => x.nav)) nav.append(el('a', { href: `#${p.id}`, 'data-id': p.id }, p.label));
    $('#map-btn')?.addEventListener('click', () => { location.hash = 'mappa'; });
    api('/api/version').then(v => { const f = $('#version'); if (f) f.textContent = `versione ${v.site.split(' ')[0]} · ${v.here.includes('/worktrees/') ? 'copia di prova' : 'cervello principale'}`; }).catch(() => {});
    $('#theme-btn').addEventListener('click', () => {
      const dark = getComputedStyle(document.documentElement).colorScheme.includes('dark');
      document.documentElement.dataset.theme = dark ? 'light' : 'dark';
      try { localStorage.setItem('brain-theme', document.documentElement.dataset.theme); } catch { /* private window */ }
      redrawCharts(); window.dispatchEvent(new Event('brain-theme'));
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { redrawCharts(); window.dispatchEvent(new Event('brain-theme')); });
    $('#print-btn').addEventListener('click', () => window.print());
    window.addEventListener('hashchange', route);
    api('/api/files').then(f => { App.files = new Set(f); }).catch(() => {});
    route();
  }

  // the one write of the site: a message to a chat's mailbox (brain-site.mjs /api/send checks Origin and this header)
  async function post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-second-brain': '1' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `errore ${r.status}`);
    return j;
  }

  return { page, start, api, post, catColors, el, esc, fmt, daysAgo, table, kv, chart, explain, md, head, section, kpis, loading, errorBox, tabs, toast, download, toCsv, tok, files: null, stamp };
})();
