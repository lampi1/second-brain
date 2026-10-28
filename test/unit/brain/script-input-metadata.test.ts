// Real shipped chat/cost scripts expose retry/expiry metadata only to their app consumers. Ordinary chat output
// stays unchanged; absent sources are valid empty data, while unreadable existing sources cannot be cached forever.
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { runNode } from '../../../src/main/brain/node';
import { parseLiveChatList } from '../../../src/main/brain/live';
import { plainNode, tmpDir } from './helpers';

const roots: string[] = [];
const temporary = () => { const root = tmpDir(); roots.push(root); return root; };
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
const scripts = path.resolve(import.meta.dirname, '../../../brain-template');

it('real chat metadata preserves masked display rows, exact activity time and transient failure retries', async () => {
  const root = temporary(), projects = path.join(root, 'claude'), project = path.join(projects, 'demo');
  fs.mkdirSync(project, { recursive: true });
  const transcript = path.join(project, 'abcdef01-0000-0000-0000-000000000000.jsonl');
  fs.writeFileSync(transcript, JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { content: [{ type: 'tool_use', name: 'AskUserQuestion' }] } }) + '\n');
  const db = path.join(root, 'cursor.db');
  const runner = { ...plainNode, env: { ...plainNode.env, BRAIN_CLAUDE_PROJECTS: projects, BRAIN_CURSOR_PROJECTS: path.join(root, 'cursor-projects'), BRAIN_CURSOR_DB: db, BRAIN_CHATS_CACHE: path.join(root, 'cache.json') } };
  const script = path.join(scripts, 'harness', 'cursor', 'chats.mjs');
  const ordinary = await runNode(runner, script, ['list', '--days', '2'], root);
  expect(ordinary.code).toBe(0); expect(ordinary.stdout).toContain('aspetta te (domanda)');
  const live = await runNode(runner, script, ['list', '--days', '2', '--live-json'], root);
  const parsed = parseLiveChatList(live.stdout);
  expect(parsed).toMatchObject({ complete: true, rows: [{ id: 'abcdef01', state: 'aspetta te (domanda)', at: fs.statSync(transcript).mtimeMs }] });
  expect(ordinary.stdout).toContain((JSON.parse(live.stdout) as { chats: { line: string }[] }).chats[0]!.line);
  fs.writeFileSync(db, 'not a readable database');
  const failed = await runNode(runner, script, ['list', '--days', '2', '--live-json'], root);
  expect(parseLiveChatList(failed.stdout)).toMatchObject({ complete: false, rows: [{ id: 'abcdef01' }] });
});

it('real cost summaries distinguish missing transcripts from an unreadable existing input', async () => {
  const root = temporary(), source = path.join(root, 'projects');
  const script = path.join(scripts, 'ops', 'tools', 'cost.mjs');
  const args = ['--root', source, '--no-cursor', '--days', '1', '--json', '--summary'];
  const empty = await runNode(plainNode, script, args, root);
  expect(JSON.parse(empty.stdout)).toMatchObject({ complete: true, total: 0 });
  fs.writeFileSync(source, 'not a directory');
  const incomplete = await runNode(plainNode, script, args, root);
  expect(JSON.parse(incomplete.stdout)).toMatchObject({ complete: false, total: 0 });
});
