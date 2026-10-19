// Review proof for PR #27 (error recall): wiring.ts now passes `env: { SB_APP_RECALL: url }` to the ChatManager. Before,
// `env` was undefined, so ChatManager.modeFor read Brother's Claude defaultMode with `this.opts.env ?? process.env`;
// now it reads it from an env that holds only SB_APP_RECALL, so CLAUDE_CONFIG_DIR is ignored and ~/.claude is read
// instead. The Claude CLI itself still gets process.env (claude.ts merges it), so it applies CLAUDE_CONFIG_DIR's
// defaultMode: an agent's permission ceiling is not enforced. This test FAILS on the PR head.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager, type ChatManagerOptions } from '../../../../src/main/chats/manager';
import type { HarnessSession, SessionOptions } from '../../../../src/main/chats/session';
import { plainOwner } from '../../../../src/main/agents/catalog';
import type { AgentPolicy } from '../../../../src/main/agents/tool-policy';
import { RECALL_ENV } from '../../../../src/main/search/hybrid/recall';

const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
const managers: ChatManager[] = [], dirs: string[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pr27-')); dirs.push(d); return d; };

function manager(env: ChatManagerOptions['env']) {
  const starts: SessionOptions[] = [];
  const m = new ChatManager({ userData: tmp(), emitter: { emit() {} }, coldEveryMs: 0, ...(env ? { env } : {}), sessionFactory: (_h, o, s) => {
    starts.push(o);
    return { harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false,
      start() { s.changed({ state: 'idle' }); }, send() {},
      close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false,
      rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    } as unknown as HarnessSession;
  } });
  managers.push(m);
  return { m, starts };
}
const reviewer: AgentPolicy = { tools: { allow: ['read'] }, ceiling: 'default' };
const agent = { owner: plainOwner('claude', null), instructions: 'Sei un revisore.', policy: reviewer };

describe('PR #27: the recall env passed to ChatManager', () => {
  it("keeps an agent's ceiling when Brother's Claude settings live in CLAUDE_CONFIG_DIR", async () => {
    const home = tmp(), config = tmp(), cwd = tmp();
    process.env.HOME = home; process.env.USERPROFILE = home; // ~/.claude/settings.json: none
    process.env.CLAUDE_CONFIG_DIR = config;                  // what the Claude CLI reads (process.env reaches it)
    fs.writeFileSync(path.join(config, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }));

    // control: the manager as wired before this PR (no env) clamps to the ceiling
    const before = manager(undefined);
    await before.m.create({ harness: 'claude', cwd, prompt: 'x' }, 'user', agent);
    expect(before.starts.at(-1)?.permissionMode, 'control (env undefined, pre-PR wiring)').toBe('default');

    // as wired by this PR (wiring.ts: env: { [RECALL_ENV]: recall.url() })
    const after = manager({ [RECALL_ENV]: 'http://127.0.0.1:4319/mcp/recall/tok' });
    await after.m.create({ harness: 'claude', cwd, prompt: 'x' }, 'user', agent);
    expect(after.starts.at(-1)?.permissionMode, 'with the PR\'s env the ceiling must still apply (else the CLI runs in bypassPermissions)').toBe('default');
  });
});
