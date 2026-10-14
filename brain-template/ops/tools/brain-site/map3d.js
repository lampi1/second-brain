// 3D map of the brain, v2 ({{OWNER}} 2026-10-11: "non la voglio come voce del menu ma come pulsante a sè che apre la
// mappa full screen con tutto il suo menu navigabile... premium"). App.openMap(arg) opens it over any page; it is a
// night world of its own (chosen, not inherited from the theme). Data: /api/map (ops/tools/brain-map.mjs, the real
// files): the essential view (simplify(): main pieces with a one-line sentence, the rest grouped) or the full one
// (#mappa/tutto). Left panel: layers, flows (played step by step, each with the sentence of the file that proves it),
// weak points; right panel: the selected piece; bottom: the flow player. ESC or ✕ closes.
'use strict';
(() => {
  const { api, el, fmt } = App;
  const LIBS = [
    ['https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js', 'sha384-qOkzR5Ke/XkQxuGVJ9hpFEpDlcoLtWwVYhnJf06cLIZa2vaIptSqaubivErzmD5O'],
    ['https://cdn.jsdelivr.net/npm/three-spritetext@1.9.6/dist/three-spritetext.min.js', 'sha384-YETpYtG9DamnwRNPjJ7gxRPtdXTAg/IK7dY+M9K/ocxVSmmX9GI/SW/F+yJga18B'],
    ['https://cdn.jsdelivr.net/npm/3d-force-graph@1.79.1/dist/3d-force-graph.min.js', 'sha384-rPBTChNmfoK7+PgrfhGgo2vR12+Pc+e4lg2YZYKUyXi2HLVWpzesq43bHEnnuFTl'],
  ]; // pinned and hashed (SRI): a changed file on the CDN is refused
  let libs = null;
  const loadLibs = () => (libs ??= LIBS.reduce((p, [src, sri]) => p.then(() => new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.integrity = sri; s.crossOrigin = 'anonymous'; s.onload = res; s.onerror = () => rej(new Error('la grafica 3D non si carica (serve internet)')); document.head.append(s);
  })), Promise.resolve()));

  // the night world: fixed colors, readable on the dark background whatever the site theme
  const NIGHT = { bg: '#0a0c12', ink: '#eef0f6', dim: '#5d6578', muted: '#9aa3b8', accent: '#ff6a3d' };
  const LAYER = { persone: '#f0b44c', chat: '#6aa2ff', agenti: '#b28cff', tool: '#3cd6d0', memoria: '#72d98f', regole: '#ff7a93', esterni: '#a7b2c2' };
  // essential view: lobes side by side, seen from the front, shallow depth (labels never hide each other)
  const ANCHOR_E = { persone: [0, 20, 0], chat: [0, 210, 0], agenti: [-560, 80, 0], tool: [0, -240, 0], memoria: [560, 80, 0], regole: [-340, 340, 0], esterni: [0, -540, 0] };
  const ANCHOR = { persone: [0, 10, 170], chat: [0, 30, 80], agenti: [-160, 50, -10], tool: [10, -30, -50], memoria: [160, 40, -30], regole: [0, 160, -70], esterni: [0, -180, -40] };
  const KINDS = { flusso: 'Come funziona', hook: 'Hook', posta: 'Posta tra chat', legge: 'Taccuino', contesto: 'Contesto fisso', esterno: 'Servizi esterni', istanza: 'Chat vive', usa: 'Codice che nomina file', cita: 'Citazioni' };
  const ON_E = new Set(['flusso', 'hook', 'posta', 'legge', 'contesto']), ON_F = new Set(['flusso', 'hook', 'posta', 'legge', 'contesto', 'esterno', 'istanza']);
  const mix = (a, b, t) => { const h = x => x.match(/\w\w/g).map(v => parseInt(v, 16)); const p = h(a), q = h(b); return `rgb(${p.map((v, i) => Math.round(v * (1 - t) + q[i] * t)).join(',')})`; };
  const short = (s, n) => (String(s ?? '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? ''));

  let state = null; // the open map: { graph, ro, keys, timer, view }
  App.closeMap = (fromRoute = false) => {
    const ov = document.getElementById('map-overlay');
    if (!state && ov.hidden) return;
    try { clearInterval(state?.timer); state?.ro?.disconnect(); document.removeEventListener('keydown', state?.keys); state?.graph?.pauseAnimation(); state?.graph?._destructor?.(); } catch { /* already gone */ }
    state = null;
    ov.hidden = true; ov.replaceChildren();
    document.documentElement.classList.remove('map-open');
    if (!fromRoute) location.hash = (App.lastHash || '#home').replace(/^#?/, '#');
  };

  App.openMap = async arg => {
    const essential = arg !== 'tutto';
    if (state && state.view === (essential ? 'e' : 'f')) return;
    App.closeMap(true);
    const ov = document.getElementById('map-overlay');
    ov.hidden = false;
    document.documentElement.classList.add('map-open');
    const keys = e => { if (e.key === 'Escape') App.closeMap(); };
    document.addEventListener('keydown', keys);
    state = { keys, view: essential ? 'e' : 'f' };
    const my = state;
    const loadingP = el('p', { style: 'color:#9aa3b8;padding:24px' }, 'Disegno la mappa…');
    ov.replaceChildren(loadingP);
    let r;
    try { [r] = await Promise.all([api('/api/map'), loadLibs()]); } catch (e) { ov.replaceChildren(bar(null, essential), el('p', { style: 'color:#ff8a65;padding:24px' }, e.message)); return; }
    if (state !== my) return; // closed meanwhile
    const full = r.value;
    if (!full) { ov.replaceChildren(bar(null, essential), el('p', { style: 'color:#ff8a65;padding:24px' }, r.error ?? 'mappa non disponibile')); return; }
    const map = essential && full.simple ? { ...full, nodes: full.simple.nodes, edges: full.simple.edges, flows: full.simple.flows } : full;
    const byId = new Map(map.nodes.map(n => [n.id, n]));
    const groupOf = {}; for (const n of map.nodes) for (const m of n.members ?? []) groupOf[m.id] = n.id;
    const shown = id => byId.get(id) ?? byId.get(groupOf[id]);
    const layerOn = Object.fromEntries(map.layers.map(l => [l.id, true]));
    const kindOn = Object.fromEntries(Object.keys(KINDS).map(k => [k, (essential ? ON_E : ON_F).has(k)]));
    const weak = [...full.weak, ...(full.problems ?? []).map(p => ({ kind: 'verifica', text: p, ids: [] }))];
    let hi = new Set(), hiL = new Set(), flowSel = null, stepI = 0, playing = null;

    // ----- frame
    const canvas = el('div.mo-canvas');
    const left = el('aside.mo-panel.left', { 'aria-label': 'Menu della mappa' });
    const right = el('aside.mo-panel.right', { hidden: true, 'aria-label': 'Pezzo scelto' });
    const player = el('div.mo-player', { hidden: true });
    const hint = el('div.mo-hint', 'Trascina per ruotare · rotella o due dita per lo zoom · clic su un pezzo');
    const search = el('input.mo-search', { type: 'search', list: 'mo-nodes', placeholder: 'Cerca un pezzo…', 'aria-label': 'Cerca un pezzo',
      onchange: e => { const q = e.target.value.toLowerCase(); const names = x => [x.label, x.name ?? ''].map(s => s.toLowerCase()); const n = full.nodes.find(x => names(x).includes(q)) ?? full.nodes.find(x => names(x).some(s => s.includes(q))); if (n) focus(shown(n.id)); } });
    const panelBtn = el('button.mo-btn', { type: 'button', 'aria-pressed': 'true', title: 'Mostra o nascondi il menu', onclick: () => { left.hidden = !left.hidden; panelBtn.setAttribute('aria-pressed', String(!left.hidden)); } }, '☰ Menu');
    ov.replaceChildren(bar({ search, panelBtn }, essential, map, full), el('datalist#mo-nodes', full.nodes.map(n => el('option', { value: n.label }))),
      el('div.mo-body', canvas, hint, left, right, player));
    if (matchMedia('(max-width: 760px)').matches) { left.hidden = true; panelBtn.setAttribute('aria-pressed', 'false'); }

    // ----- left panel: tabs
    let tab = 'flussi';
    const tabBody = el('div', { style: 'display:grid;gap:8px' });
    const tabsBar = el('div.mo-tabs', { role: 'tablist' });
    const drawTabs = () => {
      tabsBar.replaceChildren(...[['flussi', 'Come funziona'], ['strati', 'Strati'], ['deboli', `Punti deboli (${weak.length})`]].map(([id, label]) =>
        el('button', { type: 'button', role: 'tab', 'aria-selected': String(id === tab), onclick: () => { tab = id; drawTabs(); } }, label)));
      if (tab === 'strati') tabBody.replaceChildren(
        ...map.layers.map(l => el('button.mo-layer', { type: 'button', 'aria-pressed': String(layerOn[l.id]), onclick: e => { layerOn[l.id] = !layerOn[l.id]; e.currentTarget.setAttribute('aria-pressed', String(layerOn[l.id])); refreshData(); } },
          el('span.sw', { style: `background:${LAYER[l.id]}` }), el('span', l.label, el('br'), el('small', { style: 'margin:0' }, l.hint)), el('small', String(map.nodes.filter(n => n.layer === l.id).length)))),
        el('h3', 'Frecce'),
        ...Object.entries(KINDS).filter(([k]) => map.edges.some(e => e.kind === k)).map(([k, label]) => el('button.mo-layer', { type: 'button', 'aria-pressed': String(kindOn[k]), onclick: e => { kindOn[k] = !kindOn[k]; e.currentTarget.setAttribute('aria-pressed', String(kindOn[k])); refreshData(); } },
          el('span.sw', { style: `background:${k === 'flusso' ? NIGHT.accent : '#7f8aa3'};border-radius:2px;height:3px` }), label, el('small', String(map.edges.filter(e => e.kind === k).length)))));
      else if (tab === 'deboli') tabBody.replaceChildren(el('p', { style: 'margin:0;font-size:.85rem' }, 'Calcolati dai file e dagli script, mai scritti a mano. Clic per vederli.'),
        el('ul.mo-weak', { style: 'list-style:none;margin:0;padding:0' }, weak.map(w => el('li', el('b', { style: 'color:#ffb199' }, w.kind), el('a', { href: '#', onclick: e => { e.preventDefault(); stopFlow(); highlight(new Set(w.ids.map(i => shown(i)?.id).filter(Boolean)), new Set()); } }, w.text)))));
      else tabBody.replaceChildren(el('p', { style: 'margin:0;font-size:.85rem' }, 'Scegli un percorso: la mappa lo accende passo per passo, con la frase del file che lo prova.'),
        ...map.flows.map(f => el('button.mo-flow', { type: 'button', 'aria-pressed': String(flowSel === f.id), onclick: () => (flowSel === f.id ? stopFlow() : pickFlow(f.id)) }, f.title, f.steps.some(s => !s.verified) ? ' ⚠' : '')),
        ...(flowSel ? [stepsList()] : []));
    };
    left.replaceChildren(tabsBar, tabBody);
    drawTabs();

    // ----- graph
    const color = n => LAYER[n.layer] ?? '#888';
    const dimmed = () => hi.size > 0;
    const nodeColor = n => (dimmed() && !hi.has(n.id) ? mix(color(n), NIGHT.bg, 0.82) : color(n));
    const lk = l => `${l.source.id ?? l.source}|${l.target.id ?? l.target}|${l.kind}`;
    const linkColor = l => (hiL.size ? (hiL.has(lk(l)) ? NIGHT.accent : '#1b2030') : l.kind === 'flusso' ? 'rgb(255 106 61 / 55%)' : 'rgb(160 172 196 / 30%)');
    const REL = essential ? 7 : 4;
    const size = n => (essential ? (n.id === 'owner' ? 60 : n.kind === 'gruppo' ? 30 + n.members.length : 20 + (n.degree || 0) * 1.5) : (n.id === 'owner' ? 9 : 2.2 + Math.sqrt(n.degree || 0) * 1.3));
    const radius = n => Math.cbrt(size(n)) * REL;
    const label = n => {
      const on = !dimmed() || hi.has(n.id);
      const g = new THREE.Group();
      const name = new SpriteText(short(n.label, 30));
      Object.assign(name, { textHeight: (essential ? 19 : 3.6) * (on && dimmed() ? 1.2 : 1), color: on ? NIGHT.ink : NIGHT.dim, fontFace: App.tok('--font-display') || 'Archivo, sans-serif', fontWeight: '800', fontSize: 160 });
      name.position.y = radius(n) + (essential ? 16 : 4);
      g.add(name);
      if (essential && n.short) {
        const what = new SpriteText(short(n.short, 46));
        Object.assign(what, { textHeight: 12, color: on ? NIGHT.muted : NIGHT.dim, fontFace: App.tok('--font-body') || 'Archivo, sans-serif', fontWeight: '500', fontSize: 140 });
        what.position.y = -radius(n) - 12;
        g.add(what);
      }
      return g;
    };
    const data = () => {
      const nodes = map.nodes.filter(n => layerOn[n.layer]);
      const ids = new Set(nodes.map(n => n.id));
      return { nodes, links: map.edges.filter(e => kindOn[e.kind] && ids.has(e.from) && ids.has(e.to)).map(e => ({ ...e, source: e.from, target: e.to })) };
    };
    let fitted = false;
    const graph = ForceGraph3D({ controlType: 'orbit' })(canvas)
      .width(canvas.clientWidth).height(canvas.clientHeight)
      .backgroundColor('rgba(0,0,0,0)').showNavInfo(false).enableNodeDrag(false)
      .warmupTicks(essential ? 160 : 60).cooldownTicks(essential ? 120 : 260).cooldownTime(60000)
      .onEngineStop(() => { if (fitted) return; fitted = true; if (arg && arg !== 'tutto' && shown(arg)) focus(shown(arg)); else graph.zoomToFit(900, 60); })
      .nodeId('id').nodeRelSize(REL).nodeVal(size).nodeColor(nodeColor).nodeOpacity(0.97).nodeResolution(24)
      .nodeLabel(n => `<b>${App.esc(n.label)}</b><br>${App.esc(n.short ?? '')}${n.name && n.name !== n.label ? `<br><small style="color:#8e97ab">${App.esc(n.name)}</small>` : ''}`)
      .nodeThreeObject(label).nodeThreeObjectExtend(true)
      .linkColor(linkColor).linkOpacity(0.9)
      .linkWidth(l => (hiL.has(lk(l)) ? (essential ? 3.2 : 2.2) : l.kind === 'flusso' ? (essential ? 1.1 : 0.7) : 0.4))
      .linkDirectionalArrowLength(l => (hiL.has(lk(l)) ? 7 : 0)).linkDirectionalArrowRelPos(0.88)
      .linkDirectionalParticles(l => (hiL.has(lk(l)) ? 5 : l.kind === 'posta' ? 2 : 0)).linkDirectionalParticleWidth(essential ? 3.4 : 2.2).linkDirectionalParticleSpeed(0.007).linkDirectionalParticleColor(() => NIGHT.accent)
      .linkLabel(l => App.esc(l.label))
      .onNodeClick(n => focus(n)).onLinkClick(l => showLink(l))
      .onBackgroundClick(() => { if (!flowSel) { highlight(new Set(), new Set()); right.hidden = true; } })
      .graphData(data());
    graph.d3Force('layer', alpha => { for (const n of graph.graphData().nodes) {
      const a = (essential ? ANCHOR_E : ANCHOR)[n.layer] ?? [0, 0, 0], k = essential ? 0.12 : 0.25;
      n.vx += (a[0] - n.x) * k * alpha; n.vy += (a[1] - n.y) * k * alpha; n.vz += (a[2] - n.z) * (essential ? 0.6 : 0.25) * alpha;
    } });
    graph.d3Force('charge').strength(essential ? -1100 : -45);
    graph.d3Force('link').distance(() => (essential ? 180 : 55)).strength(l => (l.kind === 'usa' || l.kind === 'cita' ? 0.005 : essential ? 0.006 : 0.03));
    Object.assign(graph.controls(), { enableDamping: true, dampingFactor: 0.08, rotateSpeed: 0.6, zoomSpeed: 0.7, panSpeed: 0.6 });
    graph.cameraPosition({ x: 0, y: -60, z: essential ? 1700 : 520 });
    state.graph = graph;
    state.ro = new ResizeObserver(() => { if (canvas.clientWidth && canvas.clientHeight) graph.width(canvas.clientWidth).height(canvas.clientHeight); });
    state.ro.observe(canvas);

    function refreshLook() { graph.nodeColor(nodeColor).linkColor(linkColor).nodeThreeObject(label).linkWidth(graph.linkWidth()).linkDirectionalParticles(graph.linkDirectionalParticles()).linkDirectionalArrowLength(graph.linkDirectionalArrowLength()); }
    function refreshData() { graph.graphData(data()); }
    function highlight(nodes, links) { hi = nodes; hiL = links; refreshLook(); }
    function lookAt(n, dist) {
      if (n?.x == null) return;
      const rr = Math.hypot(n.x, n.y, n.z) || 1, k = 1 + dist / rr;
      graph.cameraPosition({ x: n.x * k, y: n.y * k, z: n.z * k }, n, 1200);
    }
    const fileLink = f => (/\.(md|mjs|json)$/.test(f) ? el('a', { href: `#esplora/${encodeURI(f)}`, onclick: () => App.closeMap(true) }, f) : f);

    // ----- flows: steps in the menu + the player at the bottom
    function stepsList() {
      const f = map.flows.find(x => x.id === flowSel);
      return el('ol.mo-steps', f.steps.map((s, i) => el(`li${i === stepI ? '.on' : ''}`, el('a', { href: '#', onclick: e => { e.preventDefault(); go(i); } }, `${s.fromLabel ?? byId.get(s.from)?.label} → ${s.toLabel ?? byId.get(s.to)?.label}`),
        `: ${s.label}`, s.verified ? '' : ' ⚠', el('div.src', '“', s.source.text, '” · ', fileLink(s.source.file)))));
    }
    function go(i) {
      const f = map.flows.find(x => x.id === flowSel); if (!f) return;
      stepI = Math.max(0, Math.min(f.steps.length - 1, i));
      const s = f.steps[stepI];
      highlight(new Set([s.from, s.to]), new Set([`${s.from}|${s.to}|flusso`]));
      lookAt(graph.graphData().nodes.find(x => x.id === s.to), essential ? 420 : 260);
      player.hidden = false;
      player.replaceChildren(
        el('button.mo-btn', { type: 'button', 'aria-label': 'Passo precedente', onclick: () => { pause(); go(stepI - 1); } }, '◀'),
        el('span', `${stepI + 1}/${f.steps.length} · ${s.fromLabel ?? byId.get(s.from)?.label} → ${s.toLabel ?? byId.get(s.to)?.label}: ${s.label}`),
        el('button.mo-btn', { type: 'button', 'aria-label': playing ? 'Pausa' : 'Riproduci', onclick: () => (playing ? pause() : play()) }, playing ? '❚❚' : '▶'),
        el('button.mo-btn', { type: 'button', 'aria-label': 'Passo successivo', onclick: () => { pause(); go(stepI + 1); } }, '▶▶'),
        el('button.mo-btn', { type: 'button', 'aria-label': 'Chiudi il percorso', onclick: () => stopFlow() }, '✕'));
      if (tab === 'flussi') drawTabs();
    }
    function play() { pause(); playing = setInterval(() => { const f = map.flows.find(x => x.id === flowSel); if (!f || stepI >= f.steps.length - 1) { pause(); go(stepI); return; } go(stepI + 1); }, 2600); state.timer = playing; go(stepI); }
    function pause() { clearInterval(playing); playing = null; }
    function pickFlow(id) { pause(); flowSel = id; stepI = 0; tab = 'flussi'; play(); }
    function stopFlow() { pause(); flowSel = null; player.hidden = true; highlight(new Set(), new Set()); drawTabs(); }

    // ----- right panel: the piece
    const fill = (...parts) => { right.hidden = false; right.replaceChildren(el('button.mo-btn', { type: 'button', style: 'justify-self:end', 'aria-label': 'Chiudi la scheda', onclick: () => { right.hidden = true; } }, '✕'), ...parts.flat(Infinity).filter(p => p != null && p !== false)); };
    function showLink(l) {
      const edge = map.edges.find(e => e.from === l.source.id && e.to === l.target.id && e.kind === l.kind);
      fill(el('h3', `${l.source.label} → ${l.target.label}`), el('p', l.label), el('p', { style: 'font-size:.85rem;color:#8e97ab' }, KINDS[l.kind] ?? l.kind),
        edge?.source ? el('p', { style: 'font-size:.85rem' }, '“', edge.source.text, '” · ', fileLink(edge.source.file)) : null);
      highlight(new Set([l.source.id, l.target.id]), new Set([lk(l)]));
    }
    function focus(n) {
      if (!n) return;
      const gn = graph.graphData().nodes.find(x => x.id === n.id);
      if (!gn) { layerOn[n.layer] = true; refreshData(); setTimeout(() => focus(n), 600); return; }
      const out = map.edges.filter(e => e.from === n.id && kindOn[e.kind]), inn = map.edges.filter(e => e.to === n.id && kindOn[e.kind]);
      if (!flowSel) highlight(new Set([n.id, ...out.map(e => e.to), ...inn.map(e => e.from)]), new Set([...out, ...inn].map(e => `${e.from}|${e.to}|${e.kind}`)));
      lookAt(gn, essential ? 320 : 200);
      const rel = f => (f && f.toLowerCase().startsWith(full.root.toLowerCase()) ? f.slice(full.root.length + 1) : null);
      const fileCell = f => (rel(f) && App.files?.has(rel(f)) ? fileLink(rel(f)) : f);
      const links = (list, dir) => el('ul', { style: 'margin:0;padding-left:16px;display:grid;gap:4px;font-size:.88rem' }, list.slice(0, 30).map(e => {
        const o = byId.get(dir === 'out' ? e.to : e.from);
        return el('li', dir === 'out' ? '→ ' : '← ', el('a', { href: '#', onclick: ev => { ev.preventDefault(); focus(o); } }, o?.label ?? '?'), ` ${e.label}`);
      }));
      fill(el('div', { style: 'display:flex;gap:8px;align-items:center' }, el('span.sw', { style: `width:12px;height:12px;border-radius:50%;background:${color(n)}` }), el('h3', n.label)),
        n.short ? el('p', { style: 'color:#fff;font-weight:700;margin:0' }, n.short) : null,
        n.what && n.kind !== 'gruppo' ? el('p', { style: 'font-size:.86rem;margin:0' }, short(n.what, 500)) : null,
        el('dl.mo-kv',
          n.file ? [el('dt', 'File'), el('dd', fileCell(n.file))] : null,
          n.modified ? [el('dt', 'Cambiato'), el('dd', fmt.ago(n.modified))] : null,
          n.uses != null ? [el('dt', 'Usato'), el('dd', `${n.uses} volte in 30 giorni`)] : null,
          n.reads != null ? [el('dt', 'Letto'), el('dd', `${n.reads} volte in 30 giorni`)] : null,
          n.events?.length ? [el('dt', 'Scatta su'), el('dd', n.events.join(', '))] : null,
          n.fields?.model ? [el('dt', 'Modello'), el('dd', `${n.fields.model}${n.fields.effort ? ` · impegno ${n.fields.effort}` : ''}`)] : null,
          n.playbook ? [el('dt', 'Taccuino'), el('dd', `${n.playbook.punti} punti`)] : null),
        n.members?.length ? [el('h3', n.kind === 'gruppo' ? `Dentro (${n.members.length})` : `Insieme a lui (${n.members.length})`),
          el('ul', { style: 'margin:0;padding-left:16px;display:grid;gap:4px;font-size:.86rem' }, n.members.map(m => el('li', el('b', { style: 'color:#fff' }, m.label), m.what ? ` · ${short(m.what, 90)}` : '')))] : null,
        out.length ? [el('h3', `Verso (${out.length})`), links(out, 'out')] : null,
        inn.length ? [el('h3', `Da (${inn.length})`), links(inn, 'in')] : null);
    }
  };

  function bar(ctl, essential, map, full) {
    const sub = map ? `${map.nodes.length} pezzi${essential ? ` (dei ${full.nodes.length} veri)` : ''} · ${map.flows.length} percorsi` : '';
    return el('div.mo-bar',
      el('h2', 'Mappa del cervello', sub ? el('small', sub) : null),
      ctl?.search ?? null,
      el('button.mo-btn', { type: 'button', 'aria-pressed': String(!essential), title: essential ? 'Mostra ogni file e ogni freccia' : 'Torna ai pezzi principali', onclick: () => { location.hash = essential ? 'mappa/tutto' : 'mappa'; } }, essential ? 'Vista completa' : 'Vista essenziale'),
      el('button.mo-btn', { type: 'button', onclick: () => state?.graph?.zoomToFit(700, 60) }, '⤢ Inquadra'),
      ctl?.panelBtn ?? null,
      el('button.mo-btn.close', { type: 'button', 'aria-label': 'Chiudi la mappa', title: 'Chiudi (Esc)', onclick: () => App.closeMap() }, '✕'));
  }
})();
