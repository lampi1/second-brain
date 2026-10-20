// Settings Azure connector reuses Azure CLI's login and the app's read-only DevOps service.
// Credentials remain owned by Azure CLI; only account and project evidence crosses to Settings.
import { execFile, spawn } from 'node:child_process';
import { findCli } from '../../main/chats/cli';
import type { TasksState } from '../../shared/contract';
import type { ConnectorProof } from './app-service';
import { launchPosixLogin } from '../ai-first/login-terminal';

function executable(): string {
  const file = findCli('az');
  if (!file || /["\r\n%&|<>^!]/.test(file)) throw new Error('Installa Azure CLI, poi riprova');
  return file;
}
export async function azureLogin(): Promise<void> {
  const file = executable();
  if (process.platform === 'darwin' || process.platform === 'linux') return launchPosixLogin(process.platform, file, ['login', '--allow-no-subscriptions']);
  if (process.platform !== 'win32') throw new Error('Sistema non supportato');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `start "Accesso Azure DevOps" cmd /d /s /k ""${file}" login --allow-no-subscriptions"`], { detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: true });
    child.once('error', () => reject(new Error('Accesso Azure non avviato')));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
export function azureAccount(): Promise<string> {
  const file = executable();
  const args = ['account', 'show', '--query', '{tenant:tenantId,user:user.name}', '--output', 'json'];
  const cmd = process.platform === 'win32' && /\.cmd$/i.test(file);
  return new Promise((resolve, reject) => execFile(cmd ? process.env.ComSpec ?? 'cmd.exe' : file,
    cmd ? ['/d', '/s', '/c', `""${file}" account show --query "{tenant:tenantId,user:user.name}" --output json"`] : args,
    { windowsHide: true, windowsVerbatimArguments: cmd, timeout: 20000, maxBuffer: 65536, encoding: 'utf8' },
    (error, stdout) => error ? reject(new Error('Accesso Azure non disponibile')) : resolve(stdout)));
}
type AzureAccount = { tenant: string; user: string };
function accountOf(raw: string): AzureAccount {
  const account = JSON.parse(raw) as { tenant?: unknown; user?: unknown };
  if (typeof account.tenant !== 'string' || !account.tenant || typeof account.user !== 'string' || !account.user || account.user.length > 254 || account.tenant.length > 100) throw new Error('Account Azure non valido');
  return { tenant: account.tenant, user: account.user };
}
export async function azureProof(readAccount: () => Promise<string>, refresh: () => Promise<TasksState>): Promise<ConnectorProof> {
  const account = accountOf(await readAccount());
  const state = await refresh();
  if (state.error || !state.at) throw new Error('Lettura DevOps non riuscita');
  const after = JSON.parse(await readAccount()) as { tenant?: unknown; user?: unknown };
  if (after.tenant !== account.tenant || after.user !== account.user) throw new Error('Account Azure cambiato durante la verifica');
  return proofOf(account, state);
}
/** A good Task page read that just happened (not started by a probe) as proof: the Azure CLI account now plus the
 *  projects that read listed (issue #95). The read must have no error; the account is read after it. */
export async function azureReadProof(readAccount: () => Promise<string>, state: TasksState): Promise<ConnectorProof> {
  if (state.error || !state.at) throw new Error('Lettura DevOps non riuscita');
  return proofOf(accountOf(await readAccount()), state);
}
function proofOf(account: AzureAccount, state: TasksState): ConnectorProof {
  const projects = new Map<string, { id: string; name: string }>();
  for (const record of [...state.assigned, ...state.urgent, ...state.prs, ...state.reviews]) {
    let url: URL;
    try { url = new URL(record.url); } catch { continue; }
    const parts = url.pathname.split('/').filter(Boolean);
    const organization = url.hostname === 'dev.azure.com' ? parts[0] : /^[a-z\d-]+\.visualstudio\.com$/i.test(url.hostname) ? url.hostname.split('.')[0] : null;
    if (url.protocol !== 'https:' || url.username || url.password || !organization || !record.project) continue;
    const id = `${organization}/${record.project}`;
    if (id.length <= 200) projects.set(id, { id, name: id });
  }
  return { identity: `${account.tenant}/${account.user}`, account: account.user, projects: [...projects.values()].slice(0, 100) };
}
