// Claude Code cloud sessions through the Claude Code CLI (ADR 0080): `claude --cloud "<task>"` starts one (it prints
// the session id and its claude.ai URL), `claude -p "<msg>" --cloud <id> --output-format json` queues a follow-up
// ({ok, session_id, url}). That is all Anthropic documents today: no list, no transcript, no stop outside the web UI,
// so the app keeps the ids it started itself (store.ts), shows the status as "unknown" and opens claude.ai for the
// rest. Never scrapes claude.ai nor calls undocumented endpoints (owner default, ADR 0080 §4). Runs with the user's
// claude.ai sign-in (`claude auth login`; an API key, Bedrock or Vertex has no cloud sessions). Used by service.ts;
// tests replay test/fixtures/cloud/claude-*.txt|json through a fake Exec.
import type { CloudAgent, CloudReady } from '../../shared/cloud';
import { drift } from '../chats/drift';
import type { Exec } from './exec';
import { rec, str, vendorUrl, type CloudProvider, type StartInput } from './provider';

const SESSION_ID = /^[A-Za-z0-9_-]{6,120}$/;

/** `claude --cloud` / `claude -p … --cloud` output → the session's id, page and branch when given (JSON or text). */
export function parseClaudeCloud(stdout: string): { id: string; url: string; branch?: string } | null {
  let o: Record<string, unknown> | null = null;
  try { o = rec(JSON.parse(stdout)); } catch { /* text output */ }
  if (o) {
    if (o.ok === false) return null;
    const id = str(o.session_id ?? o.sessionId ?? o.id, 120);
    const branch = str(o.branch, 160);
    if (id && SESSION_ID.test(id)) return { id, url: vendorUrl('claude', o.url) ?? `https://claude.ai/code/${id}`, ...(branch ? { branch } : {}) };
  }
  const m = /https:\/\/claude\.ai\/code\/([A-Za-z0-9_-]{6,120})/.exec(stdout);
  if (m?.[1]) return { id: m[1], url: m[0] };
  const s = /\b(session_[A-Za-z0-9_-]{6,120})\b/.exec(stdout);
  return s?.[1] ? { id: s[1], url: `https://claude.ai/code/${s[1]}` } : null;
}

/** `claude auth status` (JSON) → ready for cloud sessions only with a claude.ai sign-in. */
export function claudeLogin(stdout: string): CloudReady {
  let s: Record<string, unknown>;
  try { s = rec(JSON.parse(stdout)); } catch { return { ok: false, why: 'accesso a Claude non verificato: accedi con claude.ai' }; }
  if (s.loggedIn !== true) return { ok: false, why: 'Claude non ha un accesso: accedi con claude.ai (Impostazioni → Motori → Claude Code → Accedi)' };
  const how = String(s.authMethod ?? s.subscriptionType ?? '');
  if (/api.?key|bedrock|vertex|console/i.test(how)) return { ok: false, why: 'le sessioni cloud di Claude Code richiedono l’accesso con un abbonamento claude.ai (non una chiave API)' };
  return { ok: true };
}

const noFlag = (s: string) => (/^-/.test(s) ? `Compito: ${s}` : s);

export class ClaudeCloud implements CloudProvider {
  readonly engine = 'claude' as const;
  constructor(private readonly exec: Exec) {}

  async readiness(): Promise<CloudReady> {
    const r = await this.exec('claude', ['auth', 'status'], { timeoutMs: 20_000 });
    if (r.code === null) return { ok: false, why: `Claude Code non disponibile (${r.stderr.slice(0, 120)})` };
    return claudeLogin(r.stdout);
  }

  async start(i: StartInput): Promise<CloudAgent> {
    const r = await this.exec('claude', ['--cloud', noFlag(i.prompt)], { cwd: i.repo.root, timeoutMs: 120_000 });
    if (r.code !== 0) throw new Error(`claude --cloud non riuscito: ${(r.stderr || r.stdout).trim().slice(0, 300) || 'errore'} (servono l’app GitHub di Claude sul repository e le sessioni remote consentite dall’organizzazione)`);
    const s = parseClaudeCloud(r.stdout);
    if (!s) { drift('claude-cloud', null, 'start', 'no session id in the output'); throw new Error('Claude non ha detto l’id della sessione: guardala su claude.ai/code'); }
    return { id: s.id, engine: 'claude', by: 'user', title: i.title, status: 'unknown', url: s.url, repo: i.repo.repo, cwd: i.repo.root, ...(s.branch ? { branch: s.branch } : {}), updatedAt: Date.now() };
  }

  async followUp(a: CloudAgent, text: string): Promise<Partial<CloudAgent>> {
    if (!SESSION_ID.test(a.id)) throw new Error('id sessione non valido');
    const r = await this.exec('claude', ['-p', noFlag(text), '--cloud', a.id, '--output-format', 'json'], { ...(a.cwd ? { cwd: a.cwd } : {}), timeoutMs: 120_000 });
    const s = r.code === 0 ? parseClaudeCloud(r.stdout) : null;
    if (!s) throw new Error(`messaggio non accodato: ${(r.stderr || r.stdout).trim().slice(0, 300) || 'risposta non leggibile'}`);
    return { url: s.url, ...(s.branch ? { branch: s.branch } : {}) };
  }
}
