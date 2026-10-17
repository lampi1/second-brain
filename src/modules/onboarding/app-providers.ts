// Bounded read-only provider probes with injectable transports; main uses official gh and HTTPS Jira Cloud only.
import type { ConnectorProject } from '../../shared/connectors';
import { jiraCredential, type JiraCredential } from './app-service';
const projects = (value: unknown): ConnectorProject[] => {
  if (!Array.isArray(value)) throw new Error('Elenco progetti non valido');
  return value.slice(0, 100).map((p: { id?: unknown; name?: unknown }) => {
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || p.id.length > 200 || p.name.length > 300) throw new Error('Progetto non valido');
    return { id: p.id, name: p.name };
  });
};
export async function githubProbe(run: (args: string[]) => Promise<string>) {
  const account = (await run(['api', '--hostname', 'github.com', 'user', '--jq', '.login'])).trim();
  const list = JSON.parse(await run(['api', '--hostname', 'github.com', 'user/repos?per_page=100&sort=updated', '--jq', '[.[] | {id: (.id|tostring), name: .full_name}]'])) as unknown;
  if (!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(account)) throw new Error('Account non valido');
  return { identity: `github.com/${account}`, account, projects: projects(list) };
}
export async function jiraProbe(raw: JiraCredential, request: typeof fetch = fetch) {
  const value = jiraCredential(raw);
  const read = async (suffix: string): Promise<unknown> => {
    const response = await request(`${value.site}/rest/api/3/${suffix}`, { method: 'GET', headers: { Authorization: `Basic ${Buffer.from(`${value.email}:${value.token}`).toString('base64')}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok || !response.body) throw new Error('Jira non disponibile');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > 512 * 1024) throw new Error('Risposta troppo grande'); chunks.push(part.value); } }
    finally { await reader.cancel(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  };
  const account = await read('myself') as { accountId?: unknown; displayName?: unknown };
  const list = await read('project/search?maxResults=100') as { values?: unknown };
  if (typeof account.accountId !== 'string' || typeof account.displayName !== 'string') throw new Error('Account Jira non valido');
  return { identity: `${value.site}/${account.accountId}`, account: account.displayName, projects: projects(list.values) };
}
