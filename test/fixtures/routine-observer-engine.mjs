// Token-free Claude stand-in used only by the hidden dev capture. The real terminal CLI and its production browser
// MCP create the run, events, screenshots and report. Marker files let the capture inspect each live stage.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { once } from 'node:events';
const dir = process.env.ROUTINE_STEP_DIR, control = process.env.ROUTINE_VISUAL_CONTROL;
const say = text => process.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }) + '\n');
async function gate(name) {
  for (let i = 0; i < 1200; i++) {
    if (await fs.stat(path.join(control, name)).then(() => true, () => false)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Visual gate timed out: ${name}`);
}
for await (const _chunk of process.stdin) { /* consume the actual runtime prompt */ }
if (!dir || !control) throw new Error('Visual fixture environment missing');
let server;
try {
  if (path.basename(dir).includes('capture')) {
    const at = process.argv.indexOf('--mcp-config');
    const config = JSON.parse(await fs.readFile(process.argv[at + 1], 'utf8')).mcpServers['routine-browser'];
    server = spawn(config.command, config.args, { env: { ...process.env, ...config.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    server.stderr.pipe(process.stderr);
    const pending = new Map(); let serial = 0;
    readline.createInterface({ input: server.stdout }).on('line', line => {
      const reply = JSON.parse(line), p = pending.get(reply.id);
      if (p) { pending.delete(reply.id); if (reply.error || reply.result?.isError) p.reject(new Error(JSON.stringify(reply))); else p.resolve(reply.result); }
    });
    const rpc = (method, params) => new Promise((resolve, reject) => {
      const id = ++serial; pending.set(id, { resolve, reject });
      server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
    const call = (name, args) => rpc('tools/call', { name, arguments: args });
    await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'visual-fixture', version: '1' } });
    await gate('start');
    await call('navigate', { url: `${process.env.ROUTINE_VISUAL_ORIGIN}/before` });
    await call('screenshot', { name: 'before' }); say('Screenshot prima disponibile');
    await gate('after');
    await call('navigate', { url: `${process.env.ROUTINE_VISUAL_ORIGIN}/after` });
    await call('screenshot', { name: 'after' }); say('Screenshot dopo disponibile');
    await gate('overwrite');
    await call('navigate', { url: `${process.env.ROUTINE_VISUAL_ORIGIN}/after-revised` });
    await call('screenshot', { name: 'after' }); say('Screenshot aggiornato nello stesso file');
    await gate('next');
    const exited = once(server, 'exit'); server.stdin.end(); await exited; server = undefined;
  } else { say('Secondo passo dal terminale'); await gate('finish'); }
  await fs.mkdir(path.join(dir, 'evidence'), { recursive: true });
  await fs.writeFile(path.join(dir, 'evidence', 'notes.md'), '# Verifica sintetica\n\nCLI reale, motore simulato; nessun servizio esterno.\n');
  await fs.writeFile(path.join(dir, 'step-result.json'), JSON.stringify({ outcome: 'done', summary: 'Verifica sintetica completata' }));
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success' }) + '\n');
} finally { server?.kill(); }
