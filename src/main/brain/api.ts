// Brain data API for the brain pages of the UI: the brain's own data server (makeServer of <brainRoot>/ops/tools/
// brain-site.mjs: tables, now, cost, day, map, files, file, search) runs in an Electron-node child on a random
// 127.0.0.1 port, and the main process proxies GET requests to it for the 'brain:api' channel. Why a child: makeServer
// runs slow tools (cost, map: 5-40 s, some synchronous) and spawns `process.execPath` itself, which in the main process
// would start a second Electron app. Why a proxy: the renderer stays sandboxed and never talks to a port. Safety: only
// GET, only the read-only /api/ paths listed below (never /api/send, never raw downloads), Host header localhost (the
// server refuses others: DNS rebinding), the child dies with the app (its stdin is our pipe). Fails soft: no server in
// the brain = { ok: false, error }. Started on the first request, or earlier by warm() (brain/index.ts, soon after boot:
// the child's start took 9-13 s on a busy machine, so the first brain page waited for it). Used by brain/index.ts. A few paths are answered
// by main itself (`local`, e.g. /api/quality: brain/quality.ts), with what only the app knows; same checks, no child.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { BrainApiResult } from '../../shared/contract';
import { log, errText } from '../log';
import type { NodeRunner } from './node';

export const API_PATHS = new Set(['/api/tables', '/api/now', '/api/cost', '/api/day', '/api/map', '/api/files', '/api/file', '/api/search', '/api/version', '/api/status', '/api/quality', '/api/procedures', '/api/procedure', '/api/improve']);

/** Paths answered by main itself instead of the brain's server (brain.serveApi). */
export type LocalApi = Map<string, (query: URLSearchParams) => unknown | Promise<unknown>>;

/** A renderer path → the path to forward, or an Italian error. Only known read-only endpoints; drops `raw`. */
export function checkApiPath(p: unknown): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof p !== 'string' || p.length > 2000 || !p.startsWith('/api/')) return { ok: false, error: 'percorso non valido: deve iniziare con /api/' };
  let u: URL;
  try { u = new URL(p, 'http://localhost'); } catch { return { ok: false, error: 'percorso non valido' }; }
  if (u.host !== 'localhost' || !API_PATHS.has(u.pathname)) return { ok: false, error: `percorso non permesso: ${u.pathname}` };
  u.searchParams.delete('raw');
  return { ok: true, path: `${u.pathname}${u.search}` };
}

// The child: imports the brain's makeServer and listens on a free port; prints {"port":N}; exits when our pipe closes.
const CHILD = [
  "import { pathToFileURL } from 'node:url';",
  'const root = process.env.SB_BRAIN_ROOT;',
  "const m = await import(pathToFileURL(process.env.SB_BRAIN_SITE).href);",
  'const srv = m.makeServer(root);',
  "srv.on('error', e => { process.stderr.write(String(e && e.message || e)); process.exit(1); });",
  "srv.listen(0, '127.0.0.1', () => process.stdout.write(JSON.stringify({ port: srv.address().port }) + '\\n'));",
  "process.stdin.on('end', () => process.exit(0)); process.stdin.on('error', () => process.exit(0)); process.stdin.resume();",
].join('\n');

export class BrainApi {
  private child: ChildProcess | null = null;
  private port: Promise<number> | null = null;

  constructor(private root: string | null, private node: NodeRunner, private timeoutMs = 120e3, private local: LocalApi = new Map()) {}

  get script(): string | null { return this.root ? path.join(this.root, 'ops', 'tools', 'brain-site.mjs') : null; }

  private start(): Promise<number> {
    if (this.port) return this.port;
    this.port = new Promise<number>((resolve, reject) => {
      const script = this.script;
      if (!script || !fs.existsSync(script)) { reject(new Error('questo cervello non ha un server dati (ops/tools/brain-site.mjs)')); return; }
      const child = spawn(this.node.exe, ['--input-type=module', '-e', CHILD], {
        cwd: this.root!, env: { ...this.node.env, SB_BRAIN_ROOT: this.root!, SB_BRAIN_SITE: script }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.child = child;
      let out = '', err = '';
      const timer = setTimeout(() => { reject(new Error('il server dati del cervello non è partito in 20 s')); child.kill(); }, 20e3);
      child.stdout!.on('data', d => {
        out += String(d);
        const m = out.match(/\{"port":(\d+)\}/);
        if (m) { clearTimeout(timer); log.info('brain', 'brain data server started', { data: { port: Number(m[1]) } }); resolve(Number(m[1])); }
      });
      child.stderr!.on('data', d => { err = (err + String(d)).slice(-2000); });
      child.on('exit', code => {
        clearTimeout(timer);
        if (this.child === child) { this.child = null; this.port = null; }
        reject(new Error(`server dati del cervello uscito (${code}): ${err.trim().slice(0, 300)}`));
        if (code) log.warn('brain', 'brain data server exited', { data: { code, stderr: err.slice(0, 500) } });
      });
      child.on('error', e => { clearTimeout(timer); reject(e); });
    });
    this.port.catch(() => { this.port = null; });
    return this.port;
  }

  /** Starts the child ahead of the first request (no-op without a brain server); failures are retried by get(). */
  warm(): void {
    if (this.script && fs.existsSync(this.script)) this.start().catch(() => { /* get() starts it again and reports why */ });
  }

  async get(p: unknown): Promise<BrainApiResult> {
    const c = checkApiPath(p);
    if (!c.ok) return c;
    const u = new URL(c.path, 'http://localhost');
    const own = this.local.get(u.pathname);
    if (own) { try { return { ok: true, data: await own(u.searchParams) }; } catch (e) { return { ok: false, error: errText(e) }; } }
    let port: number;
    try { port = await this.start(); } catch (e) { return { ok: false, error: errText(e) }; }
    return new Promise<BrainApiResult>(resolve => {
      const req = http.get({ host: '127.0.0.1', port, path: c.path, headers: { host: 'localhost', accept: 'application/json' }, timeout: this.timeoutMs }, res => {
        const chunks: Buffer[] = [];
        res.on('error', e => resolve({ ok: false, error: errText(e) }));
        res.on('aborted', () => resolve({ ok: false, error: 'Il server dati ha interrotto la risposta.' }));
        let size = 0;
        res.on('data', (d: Buffer) => { size += d.length; if (size > 50e6) { req.destroy(); resolve({ ok: false, error: 'risposta troppo grande' }); } else chunks.push(d); });
        res.on('end', () => {
          let data: unknown;
          try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { resolve({ ok: false, error: `risposta non JSON (${res.statusCode})` }); return; }
          if (res.statusCode === 200) resolve({ ok: true, data });
          else resolve({ ok: false, error: String((data as { error?: unknown })?.error ?? `errore ${res.statusCode}`) });
        });
      });
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'il server dati del cervello non ha risposto in tempo' }); });
      req.on('error', e => resolve({ ok: false, error: errText(e) }));
    });
  }

  stop(): void {
    const c = this.child;
    this.child = null; this.port = null;
    if (c) { try { c.stdin?.end(); } catch { /* gone */ } setTimeout(() => { if (c.exitCode === null) c.kill(); }, 1000).unref(); }
  }
}
