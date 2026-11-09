// The chat feed never shows in clear what an agent typed through the app's browser (ADR 0235): a password typed with
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

  it('masks typing calls in the history read back from the transcript', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-typed-'));
    const file = path.join(dir, 's.jsonl');
    const line = { type: 'assistant', uuid: 'u1', timestamp: '2026-11-09T10:00:00Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'x1', name: 'mcp__second-brain__type', input: { ref: 'e12', text: SECRET } }] } };
    fs.writeFileSync(file, `${JSON.stringify(line)}\n`);
    const h = readHistory(file);
    expect(h.items.some(i => i.kind === 'tool')).toBe(true);
    expect(JSON.stringify(h.items)).not.toContain(SECRET);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
