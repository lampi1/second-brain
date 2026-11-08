// Ordinary hidden-dev lifecycle proof for the opt-in utility host; fake CLIs only, no e2e suite or live tokens.
// Build first, then node scripts/runtime-host-lifecycle.mjs --output <existing-directory>/lifecycle.json.
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const output = process.argv[process.argv.indexOf('--output') + 1];
if (!output || !fs.statSync(path.dirname(path.resolve(output))).isDirectory()) throw new Error('Output requires an existing parent');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-host-lifecycle-'));
const profile = path.join(scratch, 'profile'), brain = path.join(scratch, 'brain'), cwd = path.join(scratch, 'cwd');
for (const dir of [profile, brain, cwd]) fs.mkdirSync(dir);
fs.writeFileSync(path.join(brain, 'AGENTS.md'), '# Runtime lifecycle fixture\nSynthetic local test only.\n');
fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({ brainRoot: brain, autoCloseMin: 0, language: 'en', checkpoints: false }));
const env = { ...process.env, SB_USER_DATA: profile, SB_BRAIN: brain, SB_MCP_PORT: '0', SB_TEST: '1', SB_HIDDEN: '1', SB_PREWARM: '0', SB_AGENT_RUNTIME_HOST: '1',
  CLAUDE_CONFIG_DIR: path.join(scratch, 'claude'), CURSOR_CONFIG_DIR: path.join(scratch, 'cursor'),
  FAKE_CLAUDE_LOG: path.join(scratch, 'claude.ndjson'), FAKE_CLAUDE_SLOW_TICKS: '1000',
  SB_CLAUDE_PATH: path.join(root, 'test/fixtures/fake-claude.mjs'),
  SB_CODEX_PATH: path.join(root, 'test/fixtures/fake-codex-app-server.mjs'),
  SB_CURSOR_PATH: path.join(root, 'test/fixtures/fake-cursor-acp.mjs') };
delete env.SB_RELEASE; delete env.SB_WIRE_RECORD_DIR;
let app;
try {
  app = await electron.launch({ args: ['.'], cwd: root, env });
  await app.firstWindow();
  const main = p => p.url().startsWith('file:') && !p.url().includes('#overlay');
  const page = app.windows().find(main) ?? await app.waitForEvent('window', { predicate: async p => { await p.waitForLoadState('domcontentloaded'); return main(p); } });
  await page.waitForFunction(() => !!window.sb);
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.setSize(1600, 1000); });
  const later = page.getByRole('button', { name: /^(Later|Più tardi|Später)$/ });
  if (await later.count()) await later.click();
  const before = output.replace(/\.json$/, '-before.png'), after = output.replace(/\.json$/, '-after.png');
  await page.screenshot({ path: before });
  const cases = [];
  async function turn(chatId, text, stop = false) {
    return page.evaluate(({ chatId, text, stop }) => new Promise((resolve, reject) => {
      let result, interrupted = false, content = '';
      const off = [];
      const timer = setTimeout(() => { clean(); reject(new Error(`Lifecycle did not settle: ${chatId}/${text}`)); }, 60_000);
      const clean = () => { clearTimeout(timer); off.forEach(f => f()); };
      off.push(window.sb.on('chat:item', event => {
        if (event.chatId !== chatId) return;
        if (event.item.kind === 'assistant' && event.item.text) {
          content = event.item.text;
          if (stop && !interrupted) { interrupted = true; window.sb.invoke('chat:stop', { chatId }).catch(reject); }
        }
        if (event.item.kind === 'result') result = event.item;
      }));
      off.push(window.sb.on('chat:updated', chat => {
        if (chat.id !== chatId) return;
        if (chat.state === 'error' || chat.state === 'closed') { clean(); reject(new Error(chat.lastError ?? 'Unexpected engine exit')); }
        if (result && chat.state === 'idle') { clean(); resolve({ sessionId: chat.sessionId, result, content, stopSent: interrupted }); }
      }));
      window.sb.invoke('chat:send', { chatId, text }).catch(error => { clean(); reject(error); });
    }), { chatId, text, stop });
  }
  for (const engine of ['claude', 'codex', 'cursor']) {
    console.log(`Lifecycle ${engine}`);
    const chat = await page.evaluate(({ engine, cwd }) => window.sb.invoke('chat:create', { harness: engine, cwd, title: `Host lifecycle ${engine}` }), { engine, cwd });
    await page.getByTestId(`chat-expand-${chat.id}`).click();
    const started = await turn(chat.id, 'ciao');
    assert.ok(started.content);
    const metrics = await app.evaluate(({ app }) => ({ mainPid: process.pid, processes: app.getAppMetrics().map(p => ({ pid: p.pid, type: p.type, name: p.name, serviceName: p.serviceName })) }));
    const host = metrics.processes.find(p => p.name === 'second-brain-agent-runtime' || p.serviceName === 'second-brain-agent-runtime');
    assert.ok(host && host.pid !== metrics.mainPid, 'Separate utility host is running');
    const stopped = await turn(chat.id, 'slow', true);
    assert.equal(stopped.stopSent, true);
    assert.equal(stopped.result.interrupted, true);
    // Archive closes the adapter but preserves the conversation for native resume; chat:close deletes user chats.
    await page.evaluate(chatId => window.sb.invoke('chat:archive', { chatId }), chat.id);
    await page.evaluate(chatId => window.sb.invoke('chat:reopen', { chatId }), chat.id);
    const resumed = await turn(chat.id, 'ciao again');
    assert.equal(resumed.sessionId, started.sessionId, 'Native session identity survives close/reopen');
    cases.push({ engine, started, stopped, resumed, metrics });
  }
  const launches = fs.readFileSync(env.FAKE_CLAUDE_LOG, 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(row => row.argv);
  assert.ok(launches.some(row => row.argv.includes('--resume')), 'Claude received native --resume');
  await page.screenshot({ path: after });
  fs.writeFileSync(output, JSON.stringify({ scratch, cases, launches, before, after }, null, 2));
  console.log(`Lifecycle evidence: ${output}`);
} finally {
  if (app) await app.close();
  console.log(`Lifecycle scratch: ${scratch}`);
}
