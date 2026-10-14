// Brain data API (src/main/brain/api.ts): path allow-list, the child server started from a brain's makeServer (a fake
// one here, same contract: GET JSON, Host must be localhost), proxying, errors and fail-soft without a server, and
// the paths main answers itself (local: /api/quality) without any child.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { BrainApi, checkApiPath } from '../../../src/main/brain/api';
import { FIXTURES, plainNode, tmpDir } from './helpers';

const apis: BrainApi[] = [];
afterEach(() => { for (const a of apis.splice(0)) a.stop(); });

// Same contract as the brain's ops/tools/brain-site.mjs makeServer(root): refuses a non-localhost Host, echoes path + query.
const FAKE_SITE = fs.readFileSync(path.join(FIXTURES, 'fake-brain-site.mjs'), 'utf8');

function fakeBrain(): string {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, 'ops', 'tools'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ops', 'tools', 'brain-site.mjs'), FAKE_SITE);
  return root;
}

describe('brain api', () => {
  it('allows only the read-only /api/ endpoints and drops raw downloads', () => {
    expect(checkApiPath('/api/cost?days=7')).toEqual({ ok: true, path: '/api/cost?days=7' });
    expect(checkApiPath('/api/file?p=ideas.md&raw=1')).toEqual({ ok: true, path: '/api/file?p=ideas.md' });
    for (const bad of ['/api/send', '/index.html', '//evil.example/api/tables', '/api/../secrets', 'api/tables', 42, '/api/tables/x'])
      expect(checkApiPath(bad).ok, String(bad)).toBe(false);
  });

  it('starts the brain\'s server in a child on a free port and proxies GET JSON', async () => {
    const root = fakeBrain();
    const api = new BrainApi(root, plainNode);
    apis.push(api);
    const r = await api.get('/api/search?q=idea');
    expect(r).toEqual({ ok: true, data: { root, path: '/api/search', query: { q: 'idea' } } });
    expect((await api.get('/api/tables')).ok).toBe(true); // same child, reused
    expect(await api.get('/api/file?p=x')).toEqual({ ok: false, error: 'file non trovato o non mostrabile' });
    expect(await api.get('/api/send')).toMatchObject({ ok: false, error: expect.stringMatching(/non permesso/) });
  });

  it('fails soft when the brain has no data server or no brain is set', async () => {
    const a = new BrainApi(tmpDir(), plainNode);
    apis.push(a);
    expect(await a.get('/api/tables')).toMatchObject({ ok: false, error: expect.stringMatching(/server dati/) });
    expect(await new BrainApi(null, plainNode).get('/api/tables')).toMatchObject({ ok: false });
  });

  it('answers a mounted path from main itself, no brain server needed; a throwing handler fails soft', async () => {
    const local = new Map<string, (q: URLSearchParams) => unknown>([['/api/quality', q => ({ turns: 3, fresh: q.get('fresh') })]]);
    const a = new BrainApi(tmpDir(), plainNode, undefined, local);
    apis.push(a);
    expect(await a.get('/api/quality?fresh=1')).toEqual({ ok: true, data: { turns: 3, fresh: '1' } });
    local.set('/api/quality', () => { throw new Error('rotto'); });
    expect(await a.get('/api/quality')).toEqual({ ok: false, error: 'rotto' });
    expect(await a.get('/api/tables')).toMatchObject({ ok: false, error: expect.stringMatching(/server dati/) }); // the rest still goes to the brain
  });

  it('a broken server reports why, and a later request retries', async () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, 'ops', 'tools'), { recursive: true });
    fs.writeFileSync(path.join(root, 'ops', 'tools', 'brain-site.mjs'), 'throw new Error("rotto");\n');
    const a = new BrainApi(root, plainNode);
    apis.push(a);
    expect(await a.get('/api/tables')).toMatchObject({ ok: false, error: expect.stringMatching(/uscito/) });
    fs.writeFileSync(path.join(root, 'ops', 'tools', 'brain-site.mjs'), FAKE_SITE);
    expect((await a.get('/api/tables')).ok).toBe(true);
  });
});
