// Codex cloud tasks through the Codex CLI (ADR 0080): `codex cloud exec --env <ENV_ID> "<task>"` starts one,
// `codex cloud list --json` lists them (id, url, title, status, updated_at, environment, summary), `codex apply <id>`
// brings the diff into a fresh worktree. The CLI runs with the user's own ChatGPT sign-in (Codex cloud requires it; an
// API-key login has no cloud): the app holds no key. Follow-up and stop are not in the CLI, so the strip opens the task's
// page on chatgpt.com for them. Every parse is tolerant; unknown statuses and shapes are CLI drift (ADR 0055). Used by
// service.ts; tests replay test/fixtures/cloud/codex-*.json|txt through a fake Exec.
import type { CloudAgent, CloudReady, CloudStatus } from '../../shared/cloud';
import { drift } from '../chats/drift';
import type { Exec } from './exec';
import { githubRepo } from './repo';
import { rec, str, timeOf, vendorUrl, type CloudProvider, type StartInput } from './provider';

const STATUS: Record<string, CloudStatus> = {
  pending: 'queued', queued: 'queued', created: 'queued',
  running: 'running', in_progress: 'running', working: 'running',
  ready: 'done', completed: 'done', complete: 'done', done: 'done', succeeded: 'done', applied: 'done',
  error: 'failed', failed: 'failed',
  cancelled: 'stopped', canceled: 'stopped', archived: 'stopped',
};
export function codexStatus(v: unknown): CloudStatus {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  const out = STATUS[s];
  if (!out) drift('codex-cloud', null, 'status', `unknown status ${s.slice(0, 30) || '(none)'}`);
  return out ?? 'unknown';
}

/** A task id as the CLI and its URLs write it (task_e_…), safe as an argument. */
const TASK_ID = /^[A-Za-z0-9_-]{4,120}$/;

/** One `codex cloud list --json` task → a CloudAgent (null without a usable id). */
export function fromCodex(v: unknown, now = Date.now()): CloudAgent | null {
  const o = rec(v), env = rec(o.environment);
  const id = str(o.id, 120);
  if (!id || !TASK_ID.test(id)) return null;
  const repoRaw = String(o.repo ?? o.repository ?? env.repo ?? '');
  const gh = githubRepo(repoRaw.includes('github.com') ? repoRaw : repoRaw ? `https://github.com/${repoRaw}` : '');
  const summary = str(o.summary, 600), branch = str(o.branch ?? o.branch_name, 160);
  return {
    id, engine: 'codex', by: 'vendor',
    title: str(o.title, 120) ?? id,
    status: codexStatus(o.status),
    url: vendorUrl('codex', o.url) ?? `https://chatgpt.com/codex/tasks/${id}`,
    repo: 'repo' in gh ? gh.repo : '',
    ...(branch ? { branch } : {}),
    updatedAt: timeOf(o.updated_at ?? o.updatedAt ?? o.created_at, now),
    ...(summary ? { summary } : {}),
  };
}

/** `codex cloud list --json` output → tasks (an array, or { tasks | items | data }). */
export function parseCodexList(stdout: string): CloudAgent[] {
  let j: unknown;
  try { j = JSON.parse(stdout); } catch { drift('codex-cloud', null, 'list', 'not JSON'); return []; }
  const o = rec(j);
  const items = Array.isArray(j) ? j : Array.isArray(o.tasks) ? o.tasks : Array.isArray(o.items) ? o.items : Array.isArray(o.data) ? o.data : null;
  if (!items) { drift('codex-cloud', null, 'list', 'no tasks array'); return []; }
  return items.map(x => fromCodex(x)).filter((x): x is CloudAgent => !!x);
}

/** `codex cloud exec` output → the new task's id and page (JSON, or a chatgpt.com/codex/tasks/<id> URL in the text). */
export function parseCodexStart(stdout: string): { id: string; url: string } | null {
  try {
    const o = rec(JSON.parse(stdout));
    const id = str(o.id ?? o.task_id, 120);
    if (id && TASK_ID.test(id)) return { id, url: vendorUrl('codex', o.url) ?? `https://chatgpt.com/codex/tasks/${id}` };
  } catch { /* text output */ }
  const m = /https:\/\/chatgpt\.com\/codex\/tasks\/([A-Za-z0-9_-]{4,120})/.exec(stdout);
  if (m?.[1]) return { id: m[1], url: m[0] };
  const t = /\b(task_[A-Za-z0-9_-]{4,120})\b/.exec(stdout);
  return t?.[1] ? { id: t[1], url: `https://chatgpt.com/codex/tasks/${t[1]}` } : null;
}

/** `codex login status` → ready for the cloud only with a ChatGPT sign-in. */
export function codexLogin(out: string): CloudReady {
  if (/not logged in|logged out/i.test(out)) return { ok: false, why: 'Codex non ha un accesso: accedi con ChatGPT (Impostazioni → Motori → Codex → Accedi)' };
  if (/chatgpt/i.test(out)) return { ok: true };
  if (/api key/i.test(out)) return { ok: false, why: 'Codex cloud richiede l’accesso con ChatGPT: con una chiave API non ci sono attività cloud' };
  return { ok: false, why: 'accesso a Codex non verificato: accedi con ChatGPT' };
}

const ENV_ID = /^[A-Za-z0-9_.:-]{1,120}$/;

export class CodexCloud implements CloudProvider {
  readonly engine = 'codex' as const;
  constructor(private readonly exec: Exec) {}

  async readiness(): Promise<CloudReady> {
    const r = await this.exec('codex', ['login', 'status'], { timeoutMs: 20_000 });
    if (r.code === null) return { ok: false, why: `Codex CLI non disponibile (${r.stderr.slice(0, 120)})` };
    return codexLogin(`${r.stdout}\n${r.stderr}`);
  }

  async start(i: StartInput): Promise<CloudAgent> {
    if (!i.env || !ENV_ID.test(i.env)) throw new Error('manca l’ambiente Codex cloud del repository (il suo id, da chatgpt.com/codex → Ambienti)');
    // a task that starts with "-" would read as a flag
    const task = /^-/.test(i.prompt) ? `Compito: ${i.prompt}` : i.prompt;
    const r = await this.exec('codex', ['cloud', 'exec', '--env', i.env, task], { cwd: i.repo.root, timeoutMs: 120_000 });
    if (r.code !== 0) throw new Error(`codex cloud exec non riuscito: ${(r.stderr || r.stdout).trim().slice(0, 300) || 'errore'}`);
    const t = parseCodexStart(r.stdout);
    if (!t) { drift('codex-cloud', null, 'exec', 'no task id in the output'); throw new Error('Codex non ha detto l’id dell’attività: guardala su chatgpt.com/codex'); }
    return { id: t.id, engine: 'codex', by: 'user', title: i.title, status: 'queued', url: t.url, repo: i.repo.repo, cwd: i.repo.root, updatedAt: Date.now() };
  }

  async list(): Promise<CloudAgent[]> {
    const r = await this.exec('codex', ['cloud', 'list', '--json'], { timeoutMs: 60_000 });
    if (r.code !== 0) throw new Error(`codex cloud list non riuscito: ${(r.stderr || r.stdout).trim().slice(0, 300) || 'errore'}`);
    return parseCodexList(r.stdout);
  }

  async applyIn(a: CloudAgent, worktree: string): Promise<void> {
    if (!TASK_ID.test(a.id)) throw new Error('id attività non valido');
    const r = await this.exec('codex', ['apply', a.id], { cwd: worktree, timeoutMs: 120_000 });
    if (r.code !== 0) throw new Error(`codex apply non riuscito: ${(r.stderr || r.stdout).trim().slice(0, 300) || 'errore'}`);
  }
}
