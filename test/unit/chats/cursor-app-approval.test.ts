// Cursor's private config gets exactly Claude's app-tool grants (mail, delegation, app control); user settings and
// read-only runs stay intact.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { snapshotCursorConfig } from '../../../src/main/chats/acp';
import { cursorAppPermissions } from '../../../src/main/chats/app-tool-approval';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const urls = ['http://127.0.0.1:4329/mcp/chat/c/token', 'http://127.0.0.1:4329/mcp/app/o/r/token'] as const;
it('adds only mail, delegation and app-control permissions in the app-owned snapshot', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-approval-')); dirs.push(root);
  const from = path.join(root, 'user'), to = path.join(root, 'app'); fs.mkdirSync(from);
  const original = JSON.stringify({ model: 'test', permissions: { allow: ['Read(src/**)'], deny: ['Write(secret)'] } });
  fs.writeFileSync(path.join(from, 'cli-config.json'), original);
  snapshotCursorConfig(from, to, false, [], cursorAppPermissions(...urls));
  expect(JSON.parse(fs.readFileSync(path.join(to, 'cli-config.json'), 'utf8'))).toEqual({ model: 'test', permissions: {
    allow: ['Read(src/**)', 'Mcp(second-brain:send_to_chat)', 'Mcp(second-brain:list_chats)', 'Mcp(second-brain:agent_delegate)', 'Mcp(second-brain:agent_assign_task)', 'Mcp(second-brain:agent_task_events)', 'Mcp(second-brain:agent_integrate_child)', 'Mcp(second-brain:agent_integrate_children)', 'Mcp(second-brain:agent_report)', 'Mcp(second-brain:agent_children)', 'Mcp(second-brain:agent_ask_parent)', 'Mcp(second-brain:agent_answer_child)', 'Mcp(second-brain:plan_propose)', 'Mcp(second-brain:plan_update)', 'Mcp(second-brain:maintenance_pack)', 'Mcp(second-brain:maintenance_propose)', 'Mcp(second-brain-app:*)'], deny: ['Write(secret)'],
  } });
  expect(fs.readFileSync(path.join(from, 'cli-config.json'), 'utf8')).toBe(original);
  snapshotCursorConfig(from, to, true, [], cursorAppPermissions(...urls));
  expect(JSON.parse(fs.readFileSync(path.join(to, 'cli-config.json'), 'utf8')).permissions.allow).toEqual([]);
});
it('creates a private config without a user config, and removes stale app grants when detached', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-approval-')); dirs.push(root);
  const from = path.join(root, 'missing'), to = path.join(root, 'app');
  snapshotCursorConfig(from, to, false, [], cursorAppPermissions(...urls));
  expect(JSON.parse(fs.readFileSync(path.join(to, 'cli-config.json'), 'utf8')).permissions.allow).toHaveLength(16);
  snapshotCursorConfig(from, to);
  expect(fs.existsSync(path.join(to, 'cli-config.json'))).toBe(false);
});
it('does not grant permissions for unattached or non-app endpoints', () => {
  expect(cursorAppPermissions()).toEqual([]);
  expect(cursorAppPermissions('https://remote.test/mcp/c', 'http://127.0.0.1:4329/other')).toEqual([]);
  expect(cursorAppPermissions(urls[0], null)).toEqual(['Mcp(second-brain:send_to_chat)', 'Mcp(second-brain:list_chats)', 'Mcp(second-brain:agent_delegate)', 'Mcp(second-brain:agent_assign_task)', 'Mcp(second-brain:agent_task_events)', 'Mcp(second-brain:agent_integrate_child)', 'Mcp(second-brain:agent_integrate_children)', 'Mcp(second-brain:agent_report)', 'Mcp(second-brain:agent_children)', 'Mcp(second-brain:agent_ask_parent)', 'Mcp(second-brain:agent_answer_child)', 'Mcp(second-brain:plan_propose)', 'Mcp(second-brain:plan_update)', 'Mcp(second-brain:maintenance_pack)', 'Mcp(second-brain:maintenance_propose)']);
});
