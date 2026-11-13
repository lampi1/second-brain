// Compact raw outputs preserve all question context/order; explicit detail reads restore original bytes.
import { expect, it } from 'vitest';
import type { ChatItem, PendingRequest } from '../../src/shared/contract';
import { chatWindow, chatItemsReply } from '../../src/shared/chat-window';
import { extractDevLinks } from '../../src/renderer/lib/devlinks';
import { askContext } from '../../src/renderer/lib/askContext';
const item = (id: string, text = id): ChatItem => ({ kind: 'assistant', id, at: 1, text });
const raw = (id: string): ChatItem => ({ kind: 'tool', id, at: 2, name: 'Bash', input: {}, status: 'ok', summary: 'test', output: 'x'.repeat(600000) });
it('keeps the count boundary, budgets output previews, and leaves originals untouched', () => {
  const items = Array.from({ length: 700 }, (_, i) => raw(String(i)));
  const projected = chatWindow(items);
  expect(projected).toHaveLength(600);
  expect(JSON.stringify(projected).length).toBeLessThan(650000);
  expect(items).toHaveLength(700);
  expect((items[699] as {output:string}).output).toHaveLength(600000);
});
it('preserves prose, artifacts and report links even behind a huge tool output and restores the full item on demand', () => {
  const req = { id: 'ask', chatId: 'c', type: 'question', tool: 'AskUserQuestion', title: 'Proceed?', detail: '', at: 3, input: {} } as PendingRequest;
  const items: ChatItem[] = [{kind:'user', id:'u', at:0,text:'Check'}, item('why','See [report](https://example.test/report).'), raw('large'), {kind:'tool',id:'ask',at:3,name:'AskUserQuestion',summary:'Proceed?',input:{},status:'running'}];
  const projected = chatWindow(items);
  expect(projected.map(row => row.id)).toEqual(items.map(row => row.id));
  expect(askContext(projected, req)).toEqual(askContext(items, req));
  expect(chatItemsReply(items, {itemId:'large'})).toEqual([items[2]]);
  expect(chatItemsReply(items, {})).toBe(items);
  expect(chatItemsReply(items, {itemId:'missing'})).toEqual([]);
});
it('never projects MCP receipts or agent reports, and rejects unbounded window requests', () => {
  const report = {...raw('report'), name:'mcp__app__agent_report'} as ChatItem;
  expect(chatWindow([report], 600, 1)).toEqual([report]);
  for (const n of [0,-1,NaN,Infinity,601,1.5]) expect(() => chatWindow([],n)).toThrow('Invalid transcript window');
  expect(() => chatWindow([],600,2**30)).toThrow();
});

it('preserves output URLs beyond the preview and unchanged tool identity across unrelated appends', () => {
  const original = { ...raw('large'), output: 'x'.repeat(600000) + '\nhttps://dev.azure.com/o/Shop/_build/results?buildId=42' } as ChatItem;
  const first = chatWindow([original, item('a')]);
  expect(extractDevLinks(first)).toEqual(extractDevLinks([original, item('a')]));
  const second = chatWindow([...first, item('b')]);
  expect(second[0]).toBe(first[0]);
});

it('never invents a different PR from a URL cut in the middle of its number', () => {
  const url='https://dev.azure.com/o/Shop/_git/shop/pullrequest/12345';
  const original={...raw('partial'),output:'x'.repeat(Math.floor(1048576/(2*600))-(url.length-4))+url} as ChatItem;
  expect(extractDevLinks(chatWindow([original]))).toEqual(extractDevLinks([original]));
});
