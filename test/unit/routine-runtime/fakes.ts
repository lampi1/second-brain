// Fakes for the routine runtime's unit tests: an in-memory Azure DevOps (work items, comments, updates, identity) with
// injectable lost responses, a scripted EngineRunner that writes step-result.json like a Claude session would, and a
// package builder. No network, no CLI, no tokens.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { EngineRunner, EngineStepRequest, RoutinePackage, StepResult } from '../../../packages/routine-runtime/src/index';

export const tempDir = (prefix = 'routine-'): string => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

export interface FakeItem { id: number; rev: number; project: string; fields: Record<string, unknown> }
export interface FakeComment { id: number; text: string; by: string; at: number }
export interface FakeUpdate { rev: number; by: string; at: number; fields: string[] }
/** A request the fake answers abnormally: `lost` = applied, then the response is lost (a timeout to the caller);
 *  `drop` = never reaches DevOps (a timeout too); `status` = DevOps answers with that HTTP status. */
export interface Fault { method: string; path: RegExp; mode: 'lost' | 'drop' | 'status'; status?: number; times?: number }

export function fakeDevOps(options: { me?: string; now?: () => number } = {}) {
  const me = options.me ?? randomUUID();
  const now = options.now ?? (() => Date.now());
  const items = new Map<number, FakeItem>();
  const comments = new Map<number, FakeComment[]>();
  const updates = new Map<number, FakeUpdate[]>();
  const faults: Fault[] = [];
  const calls: { method: string; url: string }[] = [];
  let nextComment = 100;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const timeout = () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; return e; };

  function apply(method: string, url: URL, body: unknown, by = me): Response {
    const p = url.pathname;
    let m = /\/_apis\/wit\/workItems\/(\d+)\/comments$/i.exec(p);
    if (m) {
      const id = Number(m[1]), list = comments.get(id) ?? [];
      if (method === 'POST') {
        const c = { id: nextComment++, text: String((body as { text: string }).text), by, at: now() };
        comments.set(id, [...list, c]);
        return json({ id: c.id });
      }
      return json({ comments: [...list].reverse().map(c => ({ id: c.id, text: c.text, createdBy: { id: c.by, displayName: c.by === me ? 'Routine' : 'Person' }, createdDate: new Date(c.at).toISOString() })) });
    }
    m = /\/_apis\/wit\/workItems\/(\d+)\/updates$/i.exec(p);
    if (m) return json({ value: (updates.get(Number(m[1])) ?? []).map(u => ({ rev: u.rev, revisedBy: { id: u.by }, revisedDate: new Date(u.at).toISOString(), fields: Object.fromEntries(u.fields.map(f => [f, {}])) })) });
    if (/\/_apis\/connectionData$/i.test(p)) return json({ authenticatedUser: { id: me } });
    m = /\/_apis\/wit\/workitems\/(\d+)$/i.exec(p);
    if (m) {
      const item = items.get(Number(m[1]));
      if (!item) return json({ message: 'not found' }, 404);
      if (method === 'PATCH') {
        const changed: string[] = [];
        for (const op of body as { path: string; value: unknown }[]) { const f = op.path.replace('/fields/', ''); item.fields[f] = op.value; changed.push(f); }
        item.rev += 1;
        updates.set(item.id, [...(updates.get(item.id) ?? []), { rev: item.rev, by, at: now(), fields: changed }]);
        return json({ id: item.id, rev: item.rev });
      }
      return json({ id: item.id, rev: item.rev, fields: { ...item.fields, 'System.TeamProject': item.project }, ...(url.searchParams.get('$expand') ? { relations: [] } : {}) });
    }
    return json({ message: `fake DevOps: no route ${method} ${p}` }, 404);
  }

  const request = async (raw: string, init: RequestInit): Promise<Response> => {
    const url = new URL(raw), method = init.method ?? 'GET';
    calls.push({ method, url: raw });
    const body = typeof init.body === 'string' ? JSON.parse(init.body) as unknown : undefined;
    const fault = faults.find(f => f.method === method && f.path.test(url.pathname) && (f.times ?? 1) > 0);
    if (fault) {
      fault.times = (fault.times ?? 1) - 1;
      if (fault.mode === 'drop') throw timeout();
      if (fault.mode === 'status') return json({ message: 'fault' }, fault.status ?? 500);
      apply(method, url, body);
      throw timeout();
    }
    return apply(method, url, body);
  };

  return {
    me, request, calls, faults, items, comments, updates,
    authorization: { authorization: async () => 'Bearer fake-token' },
    addItem(item: Partial<FakeItem> & { id: number }) { items.set(item.id, { rev: 1, project: 'Proj', fields: {}, ...item }); },
    /** a comment by someone else (the escalation contact) */
    reply(id: number, by: string, text: string) { comments.set(id, [...(comments.get(id) ?? []), { id: nextComment++, text, by, at: now() }]); },
    fault(f: Fault) { faults.push(f); },
    writes() { return calls.filter(c => c.method !== 'GET'); },
  };
}
export type FakeDevOps = ReturnType<typeof fakeDevOps>;

export type Script = (request: EngineStepRequest) => Promise<StepResult | 'no-result' | 'crash'> | StepResult | 'no-result' | 'crash';

/** An engine that "runs" a session: streams a few stream-json lines, saves evidence and a screenshot, writes the result. */
export function scriptedEngine(script: Script, extra: { leak?: string } = {}): EngineRunner & { requests: EngineStepRequest[] } {
  const requests: EngineStepRequest[] = [];
  return {
    requests,
    async run(request) {
      requests.push(request);
      // like the CLI, the init line reports the model in use (the requested one, else the default)
      request.onLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: `s-${request.stepId}-${request.attempt}`, model: request.model ?? 'claude-sonnet-5' }));
      request.onLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: `echo working on ${request.stepId}${extra.leak ? ` ${extra.leak}` : ''}` } }] } }));
      fs.writeFileSync(path.join(request.stepDir, 'evidence', 'notes.md'), `step ${request.stepId}${extra.leak ? ` password ${extra.leak}` : ''}\n`);
      fs.writeFileSync(path.join(request.stepDir, 'screenshots', `${request.stepId}.png`), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const result = await script(request);
      if (result === 'crash') return { exitCode: 1, error: 'killed' };
      if (result !== 'no-result') fs.writeFileSync(path.join(request.stepDir, 'step-result.json'), JSON.stringify(result));
      request.onLine(JSON.stringify({ type: 'result', subtype: 'success', session_id: `s-${request.stepId}-${request.attempt}` }));
      return { exitCode: 0, sessionId: `s-${request.stepId}-${request.attempt}` };
    },
  };
}

export function routinePackage(over: Partial<RoutinePackage['routine']> = {}, extra: Partial<RoutinePackage> = {}): RoutinePackage {
  return {
    format: 'second-brain-routine', schemaVersion: 1,
    routine: {
      id: 'demo', title: 'Demo routine', description: '', inputs: [{ name: 'workItem' }],
      steps: [
        { id: 'analyse', title: 'Analyse', prompt: 'Analyse work item {{workItem}}.' },
        { id: 'fix', title: 'Fix', prompt: 'Fix it.' },
        { id: 'report', title: 'Report', prompt: 'Report.' },
      ],
      devops: { organization: 'contoso', projects: ['Proj'], ops: ['comment', 'state', 'fields', 'tags'], fields: ['Custom.Notes'] },
      ...over,
    },
    ...extra,
  };
}

export const done = (summary: string, devopsWrites?: StepResult['devopsWrites']): StepResult => ({ outcome: 'done', summary, ...(devopsWrites ? { devopsWrites } : {}) });

/** Every file under a folder, as text. */
export function folderText(dir: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else out.push({ file: f, text: fs.readFileSync(f).toString('utf8') }); } };
  walk(dir);
  return out;
}
