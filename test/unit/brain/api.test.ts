// Brain data API (src/main/brain/api.ts): path allow-list, the child server started from a brain's makeServer (a fake
// one here, same contract: GET JSON, Host must be localhost), proxying, errors and fail-soft without a server, and
// the paths main answers itself (local: /api/quality) without any child.
import { afterEach, describe, expect, it } from 'vitest';
import { BrainApi, checkApiPath } from '../../../src/main/brain/api';
import { plainNode, tmpDir } from './helpers';

const apis: BrainApi[] = [];
afterEach(() => { for (const a of apis.splice(0)) a.stop(); });

describe('brain api', () => {
  it('allows only the read-only /api/ endpoints and drops raw downloads', () => {
    expect(checkApiPath('/api/cost?days=7')).toEqual({ ok: true, path: '/api/cost?days=7' });
    expect(checkApiPath('/api/file?p=ideas.md&raw=1')).toEqual({ ok: true, path: '/api/file?p=ideas.md' });
    for (const bad of ['/api/send', '/index.html', '//evil.example/api/tables', '/api/../secrets', 'api/tables', 42, '/api/tables/x'])
      expect(checkApiPath(bad).ok, String(bad)).toBe(false);
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
});
