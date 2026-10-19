// Optional installed hooks must redact labeled credentials before they persist a feed entry or forward it to Orchestrator.
// Run the public hook in a fake brain only; no actual sessions, transcript contents or user settings are read.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';

const hook = path.resolve(import.meta.dirname, '../../brain-template/.claude/hooks/chat-feed.mjs');
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
it.each(['la password è ValueToKeepPrivate', '**Password:** `ValueToKeepPrivate`', 'api_key=ValueToKeepPrivate'])('redacts %s in persisted and forwarded text', text => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-feed-')); roots.push(root);
  const run = (input: object) => spawnSync(process.execPath, [hook, '--root', root], { input: JSON.stringify(input), encoding: 'utf8', timeout: 5000, windowsHide: true });
  const owner = run({ hook_event_name: 'UserPromptSubmit', session_id: 'fixture', session_title: 'OS · Fixture', cwd: path.join(root, 'fixture'), prompt: text });
  expect(owner.status).toBe(0);
  const saved = fs.readFileSync(path.join(root, 'ops/state/chat-feed.jsonl'), 'utf8');
  expect(saved).toContain('***'); expect(saved).not.toContain('ValueToKeepPrivate');
  const forwarded = run({ hook_event_name: 'UserPromptSubmit', session_id: 'hub', session_title: 'Regia', cwd: root, prompt: 'Show current work' });
  expect(forwarded.status).toBe(0);
  expect(forwarded.stdout).toContain('***'); expect(forwarded.stdout).not.toContain('ValueToKeepPrivate');
});
