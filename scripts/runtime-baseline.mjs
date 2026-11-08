// Controlled protocol replay in the hidden built dev app, not an e2e suite or a load generator. No live engines.
// Run after a build: node scripts/runtime-baseline.mjs --output <existing-folder>/baseline.json [--sessions 12].
// Own temporary profile/brain, exact fixture hashes, sequential cold/warm sends and one loopback mock HTTP provider.
// The JSON is evidence only after this exits zero; incomplete traces or replay divergence fail the run.
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';

const root = path.resolve(import.meta.dirname, '..');
const arg = (key, fallback) => { const i = process.argv.indexOf(key); return i >= 0 ? process.argv[i + 1] : fallback; };
const output = arg('--output');
const sessions = Number(arg('--sessions', '12'));
const percentiles = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = p => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
  return { n: sorted.length, p50: at(.5), p95: at(.95), p99: at(.99), max: sorted.at(-1) ?? null };
};
const machineCpu = () => os.cpus().reduce((a, { times: t }) => ({ idle: a.idle + t.idle, total: a.total + t.idle + t.user + t.sys + t.irq + t.nice }), { idle: 0, total: 0 });
if (!output || !fs.statSync(path.dirname(path.resolve(output))).isDirectory()) throw new Error('--output needs an existing parent directory');
if (!Number.isInteger(sessions) || sessions < 1 || sessions > 100) throw new Error('--sessions must be 1..100');
if (!fs.existsSync(path.join(root, 'out/main/index.js'))) throw new Error('Build the worktree first');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-runtime-baseline-'));
const profile = path.join(scratch, 'profile'), brain = path.join(scratch, 'brain'), cwd = path.join(scratch, 'cwd');
for (const p of [profile, path.join(brain, 'harness'), cwd]) fs.mkdirSync(p, { recursive: true });
const replayReport = path.join(scratch, 'replay.ndjson');
const apiText = 'Runtime replay response.';
const apiBody = ['data: ' + JSON.stringify({ choices: [{ delta: { content: apiText } }] }),
  'data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 4 } }), 'data: [DONE]'].join('\n\n') + '\n\n';
let apiCalls = 0;
const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
  req.resume();
  req.on('end', () => { apiCalls++; res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(apiBody); });
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
fs.writeFileSync(path.join(brain, 'AGENTS.md'), '# Controlled runtime replay\nSynthetic fixture brain.\n');
fs.writeFileSync(path.join(brain, 'harness/models.json'), JSON.stringify({ engines: {
  'runtime-api': { label: 'Runtime replay', kind: 'api', protocol: 'openai', baseUrl: `http://127.0.0.1:${address.port}/v1` },
}, models: [] }));
fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({ brainRoot: brain, autoCloseMin: 0, language: 'en', checkpoints: false }));
const environment = { ...process.env, SB_USER_DATA: profile, SB_BRAIN: brain, SB_MCP_PORT: '0', SB_TEST: '1',
  SB_HIDDEN: '1', SB_RUNTIME_PERF: '1', SB_PREWARM: '0', SB_REPLAY_REPORT: replayReport,
  CLAUDE_CONFIG_DIR: path.join(scratch, 'claude'), CURSOR_CONFIG_DIR: path.join(scratch, 'cursor'),
  SB_CLAUDE_PATH: path.join(root, 'test/fixtures/runtime-replay-claude.mjs'),
  SB_CODEX_PATH: path.join(root, 'test/fixtures/runtime-replay-codex.mjs'),
  SB_CURSOR_PATH: path.join(root, 'test/fixtures/runtime-replay-acp.mjs') };
// Do not inherit a stable release identity or wire recordings from the calling agent.
delete environment.SB_RELEASE;
delete environment.SB_WIRE_RECORD_DIR;
let app;
try {
  app = await electron.launch({ args: ['.'], cwd: root, env: environment });
  await app.firstWindow();
  // The request-overlay window can win the startup race; only the main page is an authorized IPC sender.
  const mainPage = p => p.url().startsWith('file:') && !p.url().includes('#overlay');
  let page = app.windows().find(mainPage);
  if (!page) page = await app.waitForEvent('window', { predicate: async p => { await p.waitForLoadState('domcontentloaded'); return mainPage(p); } });
  await page.waitForFunction(() => !!window.sb);
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.setSize(1600, 1000); });
  const later = page.getByRole('button', { name: /^(Later|Più tardi|Später)$/ });
  if (await later.count()) await later.click();
  // Standard typed handlers against the isolated fixture profile, including normal trust/key binding.
  await page.evaluate(async () => {
    await window.sb.invoke('engines:trust', { engine: 'runtime-api' });
    await window.sb.invoke('secrets:set', { engine: 'runtime-api', key: 'synthetic-runtime-replay-placeholder' });
  });
  await app.evaluate(async () => {
    const { Session } = process.getBuiltinModule('inspector/promises');
    const session = new Session(); session.connect();
    await session.post('Profiler.enable'); await session.post('Profiler.start');
    globalThis.__runtimeBaselineProfiler = session;
    globalThis.__sbRuntimePerformance.start();
  });
  let lastCpu = machineCpu();
  const machineSamples = [];
  const rendered = [];
  for (const engine of ['claude', 'codex', 'cursor', 'runtime-api']) {
    console.log(`Replay ${engine}: ${sessions} sessions`);
    for (let i = 0; i < sessions; i++) {
      const chat = await page.evaluate(async ({ engine, cwd, i }) => window.sb.invoke('chat:create', {
        harness: engine, cwd, title: `Replay ${engine} ${i}`, ...(engine === 'runtime-api' ? { model: 'runtime-model' } : {}),
      }), { engine, cwd, i });
      await page.getByTestId(`chat-expand-${chat.id}`).click();
      for (let turn = 0; turn < 2; turn++) {
        const operationId = `replay-${engine}-${i}-${turn}`;
        const measurement = await page.evaluate(({ chatId, operationId, turn, engine }) => new Promise((resolve, reject) => {
          let firstIpcAt, firstDomAt, firstDomFrameAt, firstItemId, result = false, idle = false;
          const off = [];
          // Diagnostic deadline, never a timing assertion: make a broken replay fail and close its own app.
          const deadline = setTimeout(() => { dispose(); reject(new Error(`Replay did not settle: ${operationId}`)); }, 60_000);
          const finish = () => {
            if (!idle || firstDomFrameAt === undefined) return;
            dispose();
            resolve({ operationId, firstIpcAt, firstDomAt, firstDomFrameAt, settledAt: Date.now() });
          };
          const observe = () => {
            if (!firstItemId || firstDomAt !== undefined) return;
            const el = document.querySelector(`[data-testid="item-${CSS.escape(firstItemId)}"]`);
            if (!el?.textContent?.trim() || !el.getClientRects().length) return;
            firstDomAt = Date.now();
            requestAnimationFrame(() => { firstDomFrameAt = Date.now(); finish(); });
          };
          const observer = new MutationObserver(observe);
          observer.observe(document.body, { childList: true, characterData: true, subtree: true });
          const dispose = () => { clearTimeout(deadline); observer.disconnect(); off.forEach(f => f()); };
          off.push(window.sb.on('chat:item', e => {
            if (e.chatId !== chatId) return;
            if (e.item.kind === 'assistant' && e.item.text && firstIpcAt === undefined) {
              firstIpcAt = Date.now(); firstItemId = e.item.id; observe();
            }
            if (e.item.kind === 'result') result = true;
          }));
          off.push(window.sb.on('chat:updated', e => {
            if (e.id !== chatId) return;
            if (e.state === 'error' || e.state === 'closed') { dispose(); reject(new Error(e.lastError ?? 'Engine ended during replay')); }
            if (e.state === 'idle' && result) {
              idle = true; finish();
            }
          }));
          const text = turn === 0 ? 'ciao' : engine === 'claude' ? 'stream' : engine === 'codex' ? 'plan' : 'todo';
          window.sb.invoke('chat:send', { chatId, text, diagnostic: { operationId, sentAt: Date.now() } })
            .catch(e => { dispose(); reject(e); });
        }), { chatId: chat.id, operationId, turn, engine });
        rendered.push(measurement);
      }
      await page.evaluate(chatId => window.sb.invoke('chat:close', { chatId }), chat.id);
      const cpu = machineCpu(), total = cpu.total - lastCpu.total;
      machineSamples.push({ engine, session: i, busyPercent: total > 0 ? 100 * (1 - (cpu.idle - lastCpu.idle) / total) : null });
      lastCpu = cpu;
    }
  }
  const measured = await app.evaluate(() => { const m = globalThis.__sbRuntimePerformance; const result = m.snapshot(); m.stop(); return result; });
  const profile = await app.evaluate(async () => {
    const session = globalThis.__runtimeBaselineProfiler;
    const { profile } = await session.post('Profiler.stop'); session.disconnect();
    delete globalThis.__runtimeBaselineProfiler; return profile;
  });
  fs.writeFileSync(`${output}.cpuprofile`, JSON.stringify(profile));
  const report = fs.existsSync(replayReport) ? fs.readFileSync(replayReport, 'utf8').trim().split('\n').filter(Boolean).map(x => JSON.parse(x)) : [];
  const expected = sessions * 8;
  if (measured.rows.length !== expected || measured.rows.some(r => r.invalid || r.marks.firstText === undefined) || measured.dropped)
    throw new Error(`Incomplete timing capture: ${measured.rows.length}/${expected}, dropped ${measured.dropped}, invalid ${measured.rows.filter(r => r.invalid).length}`);
  if (report.some(r => r.diverged !== undefined || r.extra !== undefined) || report.filter(r => r.done).length !== sessions * 3)
    throw new Error('Wire replay diverged, sent unexpected extra traffic or did not complete');
  if (apiCalls !== sessions * 2) throw new Error('Mock API call count mismatch');
  const fixtures = Object.fromEntries(['claude', 'codex', 'acp'].map(e => [e, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, `test/fixtures/wire/${e}/turns.ndjson`))).digest('hex')]));
   const evidence = { schema: 2, clock: 'system epoch milliseconds; 1 ms milestone resolution', at: new Date().toISOString(), revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
    mainBundleSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'out/main/index.js'))).digest('hex'),
    machine: { platform: process.platform, arch: process.arch, cpus: os.cpus().length, freeMemory: os.freemem(), loadAverage: os.loadavg() },
    workload: { sessionsPerEngine: sessions, turnsPerSession: 2, concurrentChats: 1, fixtures, apiBodySha256: crypto.createHash('sha256').update(apiBody).digest('hex') },
     measured, rendered, machineSamples,
     renderLatency: {
       ipcToDomMs: percentiles(rendered.map(r => r.firstDomAt - r.firstIpcAt)),
       semanticToDomFrameMs: percentiles(rendered.map(r => r.firstDomFrameAt - measured.rows.find(row => row.operationId === r.operationId).marks.firstText)),
       note: 'DOM mutation and next animation-frame opportunity, not a GPU presentation timestamp; one first-text sample per turn',
     } };
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`Captured ${expected} operations; evidence: ${path.resolve(output)}`);
} finally {
  try { if (app) await app.close(); }
  finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    // Keep this isolated profile for diagnosis of an unsuccessful capture; never touch the real dev/stable profile.
    console.log(`Replay scratch: ${scratch}`);
  }
}
