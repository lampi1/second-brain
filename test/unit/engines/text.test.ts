// Text-only calls on the user's Anthropic API key (src/main/engines/text.ts, text-mcp.ts, spend.ts; ADR 0052): the call
// goes out only while the Anthropic API engine is on, trusted and has a key (else `unavailable`, nothing sent); the key
// only in the x-api-key header, never in an answer or an error; effort as output_config; the cost at Claude's list
// prices into the month's spend; the MCP mount answers only with its own token.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { anthropicApi, fingerprint, setTrust } from '../../../src/main/engines/registry';
import { checkTextRequest, TextModel } from '../../../src/main/engines/text';
import { mountTextTool } from '../../../src/main/engines/text-mcp';
import { ApiSpend, monthOf } from '../../../src/main/engines/spend';
import { setPriceTable } from '../../../src/main/chats/live-cost';
import { McpServer } from '../../../src/main/mcp/server';

const KEY = 'sk-test-0123456789abcdefWXYZ';
const row = (id: string, input: number, output: number) => ({ id, harness: 'claude', provider: 'anthropic', routing: 'auto', price: { input, cacheWrite5m: input * 1.25, cacheWrite1h: input * 2, cacheRead: input / 10, output }, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-text-'));

type Call = { url: string; init: RequestInit };
function fakeFetch(status: number, body: unknown, calls: Call[]): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}
const answer = (text: string, extra: Record<string, unknown> = {}) => ({
  model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }],
  usage: { input_tokens: 100_000, output_tokens: 2_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, ...extra,
});

let dir: string;
let spend: ApiSpend;
let on: boolean;
let key: string | null;
const model = (fetchImpl: typeof fetch) => new TextModel({ settings: () => ({ engineOn: { anthropic: on } }), keyFor: () => key, spend, fetchImpl });
const req = { purpose: 'routing-judge', model: 'claude-opus-5-5', effort: 'medium' as const, prompt: 'giudica' };

beforeEach(() => {
  dir = tmp();
  spend = new ApiSpend(path.join(dir, 'api-spend.json'));
  on = true; key = KEY;
  setTrust({ anthropic: fingerprint(anthropicApi()!) });
  setPriceTable(() => ({ models: [row('claude-opus-5-5', 4, 20)] }) as never);
});
afterEach(() => { setTrust({}); setPriceTable(() => null); });

describe('TextModel', () => {
  it('sends one Messages request with the key only in its header, effort as output_config, and prices it', async () => {
    const calls: Call[] = [];
    const r = await model(fakeFetch(200, answer('{"success": true}'), calls)).complete({ ...req, system: 'sei un giudice' });
    expect(r).toMatchObject({ ok: true, text: '{"success": true}', model: 'claude-opus-5-5', engine: 'anthropic' });
    // 100k input × 4 $/M + 2k output × 20 $/M
    expect(r.ok && r.usd).toBeCloseTo(0.44, 6);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0]!.init.redirect).toBe('error');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(KEY);
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toEqual({ model: 'claude-opus-5-5', max_tokens: 16000, system: 'sei un giudice', messages: [{ role: 'user', content: 'giudica' }], output_config: { effort: 'medium' } });
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(spend.info().engines.anthropic).toEqual({ usd: 0.44, calls: 1, unpriced: 0 });
  });

  it('is unavailable, and sends nothing, when the engine is off, untrusted or has no key', async () => {
    const calls: Call[] = [];
    const f = fakeFetch(200, answer('x'), calls);
    on = false;
    expect(await model(f).complete(req)).toMatchObject({ ok: false, unavailable: true, reason: expect.stringMatching(/spento/) });
    on = true; setTrust({});
    expect(await model(f).complete(req)).toMatchObject({ ok: false, unavailable: true });
    setTrust({ anthropic: fingerprint(anthropicApi()!) }); key = null;
    expect(await model(f).complete(req)).toMatchObject({ ok: false, unavailable: true, reason: expect.stringMatching(/chiave/) });
    expect(calls).toHaveLength(0);
    expect(spend.info().engines).toEqual({});
  });

  it('turns failures into Italian lines without the key; an answered but unusable request keeps its cost', async () => {
    const calls: Call[] = [];
    expect(await model(fakeFetch(401, { error: { message: 'bad' } }, calls)).complete(req)).toEqual({ ok: false, error: 'chiave API rifiutata da api.anthropic.com' });
    const r400 = await model(fakeFetch(400, { error: { message: `invalid key ${KEY}` } }, calls)).complete(req);
    expect(r400.ok).toBe(false);
    expect(JSON.stringify(r400)).not.toContain(KEY);
    expect(await model(fakeFetch(429, {}, calls)).complete(req)).toMatchObject({ error: expect.stringMatching(/429/) });
    const cut = await model(fakeFetch(200, answer('mezza', { stop_reason: 'max_tokens' }), calls)).complete(req);
    expect(cut).toMatchObject({ ok: false, error: expect.stringMatching(/tagliata/), usd: 0.44 });
    const net = await model((async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch).complete(req);
    expect(net).toEqual({ ok: false, error: 'rete: api.anthropic.com non raggiungibile' });
    // only the answered requests count: the 4xx cost nothing
    expect(spend.info().engines.anthropic).toEqual({ usd: 0.44, calls: 1, unpriced: 0 });
  });

  it('counts a model without a price apart', async () => {
    await model(fakeFetch(200, answer('ok', { model: 'claude-new-9' }), [])).complete({ ...req, model: 'claude-new-9' });
    expect(spend.info().engines.anthropic).toEqual({ usd: 0, calls: 1, unpriced: 1 });
  });
});

describe('checkTextRequest', () => {
  it('takes only well-formed requests', () => {
    expect(checkTextRequest({ purpose: 'compare-writer', model: 'claude-opus-5-5', prompt: 'p', maxTokens: 4000 })).toEqual({ purpose: 'compare-writer', model: 'claude-opus-5-5', prompt: 'p', maxTokens: 4000 });
    expect(checkTextRequest({ purpose: 'Bad Purpose', model: 'claude-opus-5-5', prompt: 'p' })).toMatch(/purpose/);
    expect(checkTextRequest({ purpose: 'x', model: 'gpt-5', prompt: 'p' })).toMatch(/model/);
    expect(checkTextRequest({ purpose: 'x', model: 'claude-opus-5-5', prompt: '' })).toMatch(/prompt/);
    expect(checkTextRequest({ purpose: 'x', model: 'claude-opus-5-5', prompt: 'p', effort: 'huge' })).toMatch(/effort/);
    expect(checkTextRequest({ purpose: 'x', model: 'claude-opus-5-5', prompt: 'p', maxTokens: 999_999 })).toMatch(/maxTokens/);
  });
});

describe('the /mcp/text/<token> mount', () => {
  const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
  it('answers text_complete only on its own token, with the call\'s JSON', async () => {
    const mcp = new McpServer({ name: 't', version: '0' });
    const seen: unknown[] = [];
    const tool = mountTextTool(mcp, { complete: async r => { seen.push(r); return { ok: true, text: 'ciao', usd: 0.01, model: r.model, engine: 'anthropic', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }; } });
    await mcp.listen(0);
    try {
      const url = tool.url();
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/text\/[\w-]{32}$/);
      const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'text_complete', arguments: { purpose: 'routing-judge', model: 'claude-opus-5-5', prompt: 'p' } } };
      const res = await post(url, call);
      expect(res.status).toBe(200);
      const j = await res.json() as { result: { content: { text: string }[] } };
      expect(JSON.parse(j.result.content[0]!.text)).toMatchObject({ ok: true, text: 'ciao' });
      expect(seen).toEqual([{ purpose: 'routing-judge', model: 'claude-opus-5-5', prompt: 'p' }]);
      expect((await post(url.replace(/[\w-]{32}$/, 'x'.repeat(32)), call)).status).toBe(404);
      const bad = await (await post(url, { ...call, params: { name: 'text_complete', arguments: { purpose: 'x', model: 'gpt', prompt: 'p' } } })).json() as { result: { content: { text: string }[] } };
      expect(JSON.parse(bad.result.content[0]!.text)).toMatchObject({ ok: false, error: expect.stringMatching(/model/) });
      expect(seen).toHaveLength(1);
    } finally { await mcp.close(); }
  });
});

describe('ApiSpend', () => {
  it('adds per month and engine, survives a restart, keeps 12 months', () => {
    const f = path.join(tmp(), 'api-spend.json');
    const s = new ApiSpend(f);
    const oct = new Date(2026, 9, 14).getTime();
    s.add('anthropic', 0.25, oct); s.add('anthropic', 0.5, oct); s.add('anthropic', null, oct);
    s.add('anthropic', 3, new Date(2026, 8, 30).getTime());
    expect(new ApiSpend(f).info(oct)).toEqual({ month: '2026-10', measured: 'app', engines: { anthropic: { usd: 0.75, calls: 3, unpriced: 1 } } });
    for (let m = 0; m < 14; m++) s.add('anthropic', 1, new Date(2027, m, 1).getTime());
    const months = Object.keys(JSON.parse(fs.readFileSync(f, 'utf8')).months);
    expect(months).toHaveLength(12);
    expect(months).not.toContain('2026-10');
    expect(monthOf(oct)).toBe('2026-10');
  });

  it('reads a broken file as empty', () => {
    const f = path.join(tmp(), 'api-spend.json');
    fs.writeFileSync(f, '{');
    expect(new ApiSpend(f).info().engines).toEqual({});
  });
});
