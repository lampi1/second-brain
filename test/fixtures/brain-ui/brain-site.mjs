// Test fixture: a stand-in for a brain's ops/tools/brain-site.mjs with the real API shapes (makeServer(root), GET-only
// JSON, Host must be localhost), serving the synthetic brain of ./brain-ui-data.mjs. The slow sources of the real server
// (now, cost, day, map) come wrapped as { value, at, refreshing, error } like its stale-while-revalidate cache.
// SB_FIXTURE_DELAY_MS slows every answer (to see loading states); a file named FAIL_<endpoint> in the brain root makes
// that endpoint answer 500 (to see error states); a file MAP_EXTRA holding a number adds that many synthetic notes to
// the map (a large brain). Copied into temporary brains by test/e2e/brain-ui.spec.ts.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { build } from './brain-ui-data.mjs';

export function makeServer(root) {
  const extra = path.join(root, 'MAP_EXTRA');
  const D = build(Date.now(), { mapExtra: fs.existsSync(extra) ? Number(fs.readFileSync(extra, 'utf8')) || 0 : 0 });
  const at = Date.now() - 2 * 60e3;
  const wrap = value => ({ value, at, refreshing: false, error: null });
  return http.createServer((req, res) => {
    const json = (c, v) => { res.writeHead(c, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(v)); };
    if (!/^localhost(:\d+)?$/.test(String(req.headers.host))) return json(403, { error: 'solo localhost' });
    if (req.method !== 'GET') return json(405, { error: 'solo lettura' });
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;
    const name = p.replace(/^\/api\//, '');
    const answer = () => {
      const failure = path.join(root, `FAIL_${name}`);
      if (fs.existsSync(failure)) return json(500, { error: fs.readFileSync(failure, 'utf8') || `errore simulato su ${p}` });
      if (p === '/api/tables') return json(200, D.tables);
      if (p === '/api/now') return json(200, wrap(D.now));
      if (p === '/api/cost') { const days = Math.min(90, Math.max(1, Number(u.searchParams.get('days')) || 7)); return json(200, wrap(D.cost(days))); }
      if (p === '/api/map') return json(200, wrap(D.map));
      if (p === '/api/files') return json(200, D.files);
      if (p === '/api/file') {
        const f = String(u.searchParams.get('p') ?? '');
        return D.files.includes(f) ? json(200, D.fileMeta(f)) : json(404, { error: 'file non trovato o non mostrabile' });
      }
      if (p === '/api/search') {
        const q = String(u.searchParams.get('q') ?? '').trim().toLowerCase();
        if (q.length < 2) return json(200, []);
        const hits = [];
        for (const f of D.files) {
          if (f.toLowerCase().includes(q)) hits.push({ file: f, line: 0, text: '(nome del file)' });
          D.texts[f].split(/\r?\n/).forEach((l, i) => { if (l.toLowerCase().includes(q)) hits.push({ file: f, line: i + 1, text: l.trim().slice(0, 240) }); });
        }
        return json(200, hits.slice(0, 300));
      }
      if (p === '/api/version') return json(200, D.version);
      json(404, { error: 'pagina non trovata' });
    };
    const delay = Number(process.env.SB_FIXTURE_DELAY_MS) || 0;
    if (delay) setTimeout(answer, delay); else answer();
  });
}
