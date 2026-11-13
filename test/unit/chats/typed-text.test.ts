// The chat feed never shows in clear what an agent typed through the app's browser (ADR 0237): a password typed with
// type or fill_form is masked in the live item, its summary, a permission panel and the history read back from Claude's
// transcript; other tools and other servers are left alone.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatItem, PendingRequest } from '../../../src/shared/contract';
import { maskTypedInput, maskTypedItem, maskTypedRequest, scrub } from '../../../src/main/chats/typed-text';
import { toolSummary } from '../../../src/main/chats/claude-map';
import { readHistory } from '../../../src/main/chats/transcript';

const SECRET = ['Segreto', 'Synthetic', String(1)].join('-');   // built at run time: the guard flags a literal
type ToolItem = Extract<ChatItem, { kind: 'tool' }>;
const tool = (name: string, input: unknown, summary = toolSummary(name, input)): ToolItem =>
  ({ kind: 'tool', id: 't-1', at: 1, name, summary, input, status: 'running' });

describe('typed text in the feed', () => {
  it('masks type text, in the input and in the summary', () => {
    const item = maskTypedItem(tool('mcp__second-brain__type', { text: SECRET, ref: 'e12' })) as ToolItem;
    expect(JSON.stringify(item)).not.toContain(SECRET);
    expect(item.input).toEqual({ text: '•••', ref: 'e12' });
    expect(item.summary).toBe('second-brain: type · •••');
  });

  it('masks every fill_form value and keeps the refs', () => {
    const input = { fields: [{ ref: 'e10', value: 'mario.rossi' }, { ref: 'e12', value: SECRET }] };
    const item = maskTypedItem(tool('mcp__plugin_second-brain_second-brain__fill_form', input)) as ToolItem;
    expect(JSON.stringify(item)).not.toContain(SECRET);
    expect(item.input).toEqual({ fields: [{ ref: 'e10', value: '•••' }, { ref: 'e12', value: '•••' }] });
  });

  it('masks a Cursor tool known only by its title', () => {
    const item = maskTypedItem(tool('Tool', { text: SECRET }, `Tool: second-brain: type ${SECRET}`)) as ToolItem;
    expect(JSON.stringify(item)).not.toContain(SECRET);
  });

  it('masks the cut start of a long value in a summary', () => {
    const long = `${SECRET}-${'x'.repeat(80)}`;
    const item = maskTypedItem(tool('mcp__second-brain__type', { text: long })) as ToolItem;
    expect(item.summary).not.toContain(SECRET.slice(0, 6));
    expect(scrub('a · abcdefgh…', ['abcdefghijkl'])).toBe('a · •••');
  });

  it('masks a password pressed key by key, keeping the keys that only move or submit', () => {
    const keys = `${[...SECRET].join(' ')} Tab shift+A Enter ctrl+a`;
    const item = maskTypedItem(tool('mcp__second-brain__key', { keys, repeat: 1 })) as ToolItem;
    expect(item.input).toEqual({ keys: '••• Tab ••• Enter ctrl+a', repeat: 1 });
    expect(item.summary).not.toContain([...SECRET.slice(0, 4)].join(' '));
    const nav = tool('mcp__second-brain__key', { keys: 'Tab Enter' });
    expect(maskTypedItem(nav)).toEqual(nav);
  });

  it('masks the key result read back and a single word pressed as one key', () => {
    const keys = `${[...SECRET].join(' ')} Enter`;
    const item = maskTypedItem({ ...tool('mcp__second-brain__key', { keys }), output: `Pressed ${keys}` }) as ToolItem;
    expect(JSON.stringify(item)).not.toContain([...SECRET.slice(0, 4)].join(' '));
    const word = SECRET.replace(/-/g, '');
    expect(JSON.stringify(maskTypedItem(tool('mcp__second-brain__key', { keys: word })))).not.toContain(word);
  });

  it('masks a Codex panel: the wrapped arguments, the shown parameters and the JSON, even with the tool unknown', () => {
    const quoted = `${SECRET}"\\x`;   // a value JSON escapes
    for (const name of ['mcp__second-brain__type', 'mcp__second-brain']) {
      const args = { text: quoted, ref: 'e12' };
      const req: Omit<PendingRequest, 'chatId'> = { id: 'r1', type: 'permission', tool: name, title: 'Allow the second-brain MCP server to run tool "type"?',
        detail: ['Server: second-brain', `text: ${quoted}`, `Parametri:\n${JSON.stringify(args, null, 2)}`].join('\n'),
        input: { server: 'second-brain', ...(name.endsWith('type') ? { tool: name } : {}), arguments: args }, noAlways: true, at: 1 };
      expect(JSON.stringify(maskTypedRequest(req))).not.toContain(SECRET);
    }
    const app = { id: 'r2', type: 'permission' as const, tool: 'mcp__second-brain__app_send', title: 't', detail: 'kept', input: { text: 'kept' }, at: 1 };
    expect(maskTypedRequest(app)).toBe(app);
  });

  it('leaves other tools and other servers alone', () => {
    const nav = tool('mcp__second-brain__navigate', { url: 'https://app.example.com' });
    expect(maskTypedItem(nav)).toBe(nav);
    const other = tool('mcp__other__type', { text: 'kept' });
    expect(maskTypedItem(other)).toBe(other);
    expect(maskTypedInput('Bash', { command: 'ls' })).toEqual({ command: 'ls' });
  });

  it('masks a permission panel for a typing call', () => {
    const input = { text: SECRET, ref: 'e12' };
    const req: Omit<PendingRequest, 'chatId'> = { id: 'r1', type: 'permission', tool: 'mcp__second-brain__type', title: toolSummary('mcp__second-brain__type', input), detail: SECRET, input, at: 1 };
    expect(JSON.stringify(maskTypedRequest(req))).not.toContain(SECRET);
  });

  it('masks OpenCode\'s <server>_<tool> names and an ACP call whose arguments are not in its input (#353 review)', () => {
    // OpenCode: the item is «Tool» named only in its summary
    const oc = { kind: 'tool', id: 't1', at: 1, name: 'Tool', summary: 'Tool: second-brain_type', input: { ref: 'e5', text: SECRET }, status: 'ok' } as ChatItem;
    expect(JSON.stringify(maskTypedItem(oc))).not.toContain(SECRET);
    expect(JSON.stringify(maskTypedItem({ ...oc, summary: 'Tool: second-brain_key', input: { keys: 7 } } as ChatItem))).not.toContain('"keys":7'); // a number is masked too
    // the panel shows what the engine's earlier call or content carried; the stored input is empty
    const req: Omit<PendingRequest, 'chatId'> = { id: 'r1', type: 'permission', tool: 'Tool', title: `Strumento second-brain_type: ${SECRET}`, detail: `ref: e5\ntext: ${SECRET}`, input: {}, at: 1 };
    expect(JSON.stringify(maskTypedRequest(req))).not.toContain(SECRET);
    expect(maskTypedRequest(req).title).toBe('Strumento second-brain_type');
    const cursor = { ...oc, summary: `second-brain: type`, input: {}, output: `typed ${SECRET}` } as ChatItem;
    expect(JSON.stringify(maskTypedItem(cursor))).not.toContain(SECRET);
    // another tool of the browser server is left as it is
    expect(maskTypedItem({ ...oc, summary: 'Tool: second-brain_navigate', input: { url: 'https://x' } } as ChatItem)).toMatchObject({ input: { url: 'https://x' } });
  });

  it('masks typing calls in the history read back from the transcript', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-typed-'));
    const file = path.join(dir, 's.jsonl');
    const line = { type: 'assistant', uuid: 'u1', timestamp: '2026-11-09T10:00:00Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'x1', name: 'mcp__second-brain__type', input: { ref: 'e12', text: SECRET } }] } };
    fs.writeFileSync(file, `${JSON.stringify(line)}\n`);
    const h = readHistory(file);
    expect(h.items.some(i => i.kind === 'tool')).toBe(true);
    expect(JSON.stringify(h.items)).not.toContain(SECRET);
    // its output too, once the result comes (a field page.ts never saw as a password field echoes the value)
    const keys = `${[...SECRET].join(' ')} Enter`;
    const call = { type: 'assistant', uuid: 'u2', timestamp: '2026-11-09T10:00:01Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'x2', name: 'mcp__second-brain__fill_form', input: { fields: [{ ref: 'e9', value: SECRET }] } }, { type: 'tool_use', id: 'x3', name: 'mcp__second-brain__key', input: { keys } }] } };
    const result = { type: 'user', uuid: 'u3', timestamp: '2026-11-09T10:00:02Z', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'x2', content: `e9 input "pin" = "${SECRET}"` }, { type: 'tool_result', tool_use_id: 'x3', content: `Pressed ${keys}` }] } };
    fs.appendFileSync(file, `${JSON.stringify(call)}\n${JSON.stringify(result)}\n`);
    const again = readHistory(file);
    expect(again.items.filter(i => i.kind === 'tool' && ['t-x2', 't-x3'].includes(i.id) && i.output)).toHaveLength(2);
    expect(JSON.stringify(again.items)).not.toContain(SECRET);
    expect(JSON.stringify(again.items)).not.toContain([...SECRET.slice(0, 4)].join(' '));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
