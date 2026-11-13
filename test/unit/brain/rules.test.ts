// Product machinery behavior/refusal tests, isolated in temporary brains; no real brain, settings or model calls.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runHook } from '../../../src/main/rules/runtime';
import { writeNow, writeError } from '../../../src/main/rules/memory';
import { configOf, confined } from '../../../src/main/rules/storage';
import { lease } from '../../../src/main/rules/maintenance';
import { readCost, readSession } from '../../../src/main/rules/readers';
import { check } from '../../../src/main/rules/vendor.mjs';
import type { HookInput } from '../../../src/main/rules/types';
import prompt from '../../fixtures/hooks/claude-prompt.json';
import write from '../../fixtures/hooks/claude-write.json';

const roots: string[] = [];
function setup() {
  // the real path: macOS's temp folder is behind a link (/var → /private/var), Windows' can be an 8.3 short name, and
  // the brain's git checks compare with git's own long path
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-rules-'))); roots.push(base);
  const root = path.join(base, 'brain'), state = path.join(base, 'state');
  fs.mkdirSync(root); fs.mkdirSync(state);
  fs.writeFileSync(path.join(root, 'brain.json'), JSON.stringify({ rules: { topicFiles: [] } }));
  return { root, state, run: (input: HookInput) => runHook(root, state, input) };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('product brain rules', () => {
  it('refuses growth beyond 15,000 but allows shrinking and ordinary files', () => {
    const b = setup();
    fs.writeFileSync(path.join(b.root, 'AGENTS.md'), 'a'.repeat(15_001));
    expect(b.run({ ...write, tool_input: { file_path: 'AGENTS.md', content: 'b'.repeat(15_002) } } as HookInput).deny).toContain('15000');
    expect(b.run(write as HookInput).deny).toBeUndefined();
    expect(b.run({ ...write, tool_input: { file_path: 'other.md', content: 'x'.repeat(20_000) } } as HookInput).deny).toBeUndefined();
  });
  it('fails closed on malformed safety inputs/config and rejects direct memory edits', () => {
    const b = setup();
    expect(b.run({ ...write, tool_input: { file_path: 'now.md', content: 'wrong' } } as HookInput).deny).toContain('writer');
    expect(b.run({ ...write, tool_input: {} } as HookInput).deny).toContain('safety');
    fs.writeFileSync(path.join(b.root, 'brain.json'), '{broken');
    expect(b.run(write as HookInput).deny).toContain('safety');
  });
  it('validates one-line updates, preserves other chats, serializes and appends errors', () => {
    const b = setup();
    writeNow(b.root, 'A', 'first'); writeNow(b.root, 'B', 'other'); writeNow(b.root, 'A', 'next');
    expect(fs.readFileSync(path.join(b.root, 'now.md'), 'utf8')).toContain('**B** · other');
    expect(() => writeNow(b.root, 'A', 'bad\nline')).toThrow('one nonempty line');
    fs.writeFileSync(path.join(b.root, 'now.md.lock'), 'busy');
    expect(() => writeNow(b.root, 'A', 'racing')).toThrow();
    writeError(b.root, 'Correct the verified assumption', 'A');
    expect(fs.readFileSync(path.join(b.root, 'ai-errors.md'), 'utf8')).toContain('Correct the verified assumption');
  });
  it('rejects traversal/config escapes and tokenless lease stealing', () => {
    const b = setup();
    expect(() => confined(b.root, '../outside')).toThrow();
    fs.writeFileSync(path.join(b.root, 'brain.json'), JSON.stringify({ rules: { fixedFiles: ['../outside.md'] } }));
    expect(() => configOf(b.root)).toThrow();
    const token = lease(b.state, 'test', 'owner');
    expect(() => lease(b.state, 'test', 'other')).toThrow('held');
    expect(() => lease(b.state, 'test', 'owner')).toThrow('held');
    expect(lease(b.state, 'test', 'owner', token)).toBe('');
  });
  it('injects no topic text: topic rules are skills since #366', () => {
    const b = setup();
    fs.writeFileSync(path.join(b.root, 'brain.json'), JSON.stringify({ rules: { topicFiles: ['code.md'], turnBudget: 300 } }));
    fs.writeFileSync(path.join(b.root, 'code.md'), '---\nwhen: {"prompt":["code"],"tools":["Read"],"paths":["**/src/*.ts"]}\n---\nRule text.');
    expect(b.run(prompt as HookInput).context).toBeUndefined();
    expect(b.run({ hook_event_name: 'PreToolUse', session_id: prompt.session_id, tool_name: 'Read', tool_input: { file_path: '/work/src/a.ts' } }).context).toBeUndefined();
  });
  it('keeps feed metadata free of prompts and filters agent correction messages', () => {
    const b = setup();
    expect(b.run({ ...prompt, prompt: 'This is wrong' } as HookInput).context).toContain('correction');
    expect(b.run({ ...prompt, prompt: '<agent-message>This is wrong</agent-message>' } as HookInput).context).toBeUndefined();
    const feed = fs.readdirSync(b.state).find(f => f.endsWith('.feed.json'))!;
    expect(fs.readFileSync(path.join(b.state, feed), 'utf8')).not.toContain('wrong');
  });
  it('blocks cross-vendor spending but permits version queries and quoted text', () => {
    expect(check('agent -p hello', 'claude')).toContain('Cursor');
    expect(check('claude -p hello', 'cursor')).toContain('Claude');
    expect(check('agent --version', 'claude')).toBeNull();
    expect(check('echo "agent -p hello"', 'claude')).toBeNull();
  });
  it('redacts session excerpts and distinguishes unknown cost from zero', () => {
    const b = setup(), file = path.join(b.root, 'session.jsonl');
    fs.writeFileSync(file, JSON.stringify({ message: { content: `example ${'pass'}word=private` } }) + '\n');
    expect(readSession(file, 'example')[0]?.text).not.toContain('private');
    expect(readCost(file).reportedUsd).toBeNull();
    fs.appendFileSync(file, JSON.stringify({ total_cost_usd: 0 }) + '\n');
    expect(readCost(file).reportedUsd).toBe(0);
  });
});
