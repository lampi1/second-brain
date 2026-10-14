// The clicks of the Miglioramento page (ADR 0030): [Applica] / [No] on a proposal of the brain's shared
// self-improvement loop and [Ripristina] of a policy's previous version. The app never writes the loop's state
// (<brain>/ops/state/improve): each click runs the brain's own CLI, ops/improve/improve.mjs apply|reject|rollback
// --json, as an Electron-node child in the brain folder, one at a time (the CLI appends to shared files), like the
// model comparisons' switch.mjs (compare.ts). The page reads the loop through the brain proxy (/api/improve). Used by
// brain/index.ts ('learn:act').
import fs from 'node:fs';
import path from 'node:path';
import type { LearnResult } from '../../shared/contract';
import { log } from '../log';
import { errLine } from './compare';
import { runNode, type NodeRunner } from './node';

/** Who the loop's audit names for a click in the app (the owner's name stays out of the app's code). */
export const BY = 'app (clic)';
const ID = /^[a-z][a-z0-9-]{0,30}-\d{1,6}$/; // lib.mjs nextProposalId: "<domain>-<n>"
const DOMAIN = /^[a-z][a-z0-9-]{0,30}$/;

/** A renderer request → the CLI's arguments, or an Italian error (only the three actions, only well-formed names). */
export function learnArgs(a: unknown): { ok: true; args: string[] } | { ok: false; error: string } {
  const x = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
  if (x.action === 'apply' || x.action === 'reject') {
    if (typeof x.id !== 'string' || !ID.test(x.id)) return { ok: false, error: 'proposta non valida' };
    return { ok: true, args: [x.action, x.id, '--by', BY, '--json'] };
  }
  if (x.action === 'rollback') {
    if (typeof x.domain !== 'string' || !DOMAIN.test(x.domain)) return { ok: false, error: 'politica non valida' };
    return { ok: true, args: ['rollback', '--domain', x.domain, '--by', BY, '--json'] };
  }
  return { ok: false, error: 'azione sconosciuta (apply, reject, rollback)' };
}

/** The CLI's JSON line → what the page says after the click. */
export function learnMessage(args: string[], out: Record<string, unknown>): string {
  const p = (out.proposal && typeof out.proposal === 'object' ? out.proposal : {}) as Record<string, unknown>;
  if (args[0] === 'apply') return `Applicata: ${String(p.domain ?? '')} ora è alla v${String(p.version ?? '?')}`;
  if (args[0] === 'reject') return 'Proposta scartata';
  return `Ripristinata la v${String(out.version ?? '?')} (era v${String(out.from ?? '?')})`;
}

export class Learn {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private root: () => string | null, private node: NodeRunner, private timeoutMs = 120e3) {}

  act(a: unknown): Promise<LearnResult> {
    const run = this.queue.then(() => this.actNow(a));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async actNow(a: unknown): Promise<LearnResult> {
    const v = learnArgs(a);
    if (!v.ok) return v;
    const root = this.root();
    if (!root) return { ok: false, error: 'nessuna cartella del cervello scelta' };
    const script = path.join(root, 'ops', 'improve', 'improve.mjs');
    if (!fs.existsSync(script)) return { ok: false, error: 'questo cervello non ha il ciclo di miglioramento (ops/improve)' };
    const r = await runNode(this.node, script, v.args, root, this.timeoutMs);
    let out: Record<string, unknown> | null = null;
    try { out = JSON.parse(r.stdout.trim().split('\n').at(-1) ?? '') as Record<string, unknown>; } catch { /* below */ }
    if (r.code !== 0 || out?.ok !== true) {
      log.warn('brain', 'improve.mjs click failed', { data: { args: v.args, code: r.code, stderr: r.stderr.slice(0, 500) } });
      const why = typeof out?.error === 'string' ? out.error : errLine(r.stderr) || r.error || `uscita ${r.code}`;
      return { ok: false, error: `non fatto: ${why}` };
    }
    log.info('brain', 'improve.mjs click', { data: { args: v.args } });
    return { ok: true, message: learnMessage(v.args, out) };
  }
}
