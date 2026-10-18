// Review proof for PR #27 (error recall): the app hands SB_APP_RECALL to EVERY chat it starts (ChatManager env reaches
// Claude, Codex and Cursor sessions alike), but the only thing that ever calls the recall endpoint is Claude's
// UserPromptSubmit hook (brain-template/.claude/hooks/correction-catch.mjs, wired only in harness/claude/settings.hooks.json;
// it even returns early on Cursor input). Codex and Cursor chats never get the "past errors" warning, and nothing on the
// app side (chats/codex.ts, chats/acp.ts, manager.ts) injects it for them. This test FAILS on the PR head.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../..');
const CLAUDE_HOOK = 'brain-template/.claude/hooks/correction-catch.mjs';

function files(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(e => {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : files(rel);
    return /\.(m?js|ts|json|toml)$/.test(e.name) ? [rel] : [];
  });
}
const mentionsRecall = (rel: string) => /SB_APP_RECALL|RECALL_ENV|hybrid\/recall|\/mcp\/recall/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
// the commands a Cursor chat runs as hooks (what the brain installs for Cursor)
const cursorHookScripts = (): string[] => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'brain-template/harness/cursor/hooks.json'), 'utf8')) as { hooks: Record<string, { command: string }[]> };
  return Object.values(cfg.hooks).flat().map(h => /\{\{BRAIN\}\}\/([^"]+)"/.exec(h.command)?.[1]).filter((p): p is string => !!p).map(p => `brain-template/${p}`);
};

describe('PR #27: error recall reaches every engine the app starts, not only Claude', () => {
  it('a Cursor chat has a consumer of the recall endpoint (a Cursor hook, or the app injecting it on ACP)', () => {
    const consumers = [...cursorHookScripts(), ...files('src/main/chats').filter(f => /acp|cursor/i.test(f))].filter(mentionsRecall);
    expect(consumers, 'Cursor: nothing calls SB_APP_RECALL (hooks.json scripts, chats/acp.ts)').not.toEqual([]);
  });

  it('a Codex chat has a consumer of the recall endpoint (a Codex hook in the brain, or the app injecting it)', () => {
    const consumers = [...files('brain-template'), ...files('src/main/chats')].filter(f => f !== CLAUDE_HOOK && /codex/i.test(f)).filter(mentionsRecall);
    expect(consumers, 'Codex: nothing calls SB_APP_RECALL (no Codex hook in brain-template, nothing in chats/codex.ts)').not.toEqual([]);
  });
});
