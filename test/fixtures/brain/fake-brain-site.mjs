// Test fixture: a stand-in for a brain's ops/tools/brain-site.mjs with the same contract as its makeServer(root):
// GET-only JSON, requests whose Host is not localhost refused. It echoes the path and query, reads ideas.md for
// /api/tables and 404s /api/file. Copied into temporary brains by test/unit/brain/api.test.ts and test/e2e/brain.spec.ts.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

export function makeServer(root) {
  return http.createServer((req, res) => {
    const json = (c, v) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (!/^localhost(:\d+)?$/.test(String(req.headers.host))) return json(403, { error: 'solo localhost' });
    if (req.method !== 'GET') return json(405, { error: 'solo lettura' });
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/api/file') return json(404, { error: 'file non trovato o non mostrabile' });
    if (u.pathname === '/api/tables') {
      let ideas = '';
      try { ideas = fs.readFileSync(path.join(root, 'ideas.md'), 'utf8'); } catch { /* none */ }
      return json(200, { root, ideas: ideas.split('\n').filter(l => l.startsWith('## ')).length });
    }
    json(200, { root, path: u.pathname, query: Object.fromEntries(u.searchParams) });
  });
}
