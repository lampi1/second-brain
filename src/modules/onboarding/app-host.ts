// Production connector adapters: fixed official gh commands and Jira Cloud read-only REST; called only by UI actions.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { safeStorage, shell } from 'electron';
import { findCli } from '../../main/chats/cli';
import { safeStorageCipher } from '../../main/engines/secrets';
import { launchPosixLogin } from '../ai-first/login-terminal';
import { AppConnectorService } from './app-service';
import type { ConnectorSelections } from './app-service';
import { githubProbe, jiraProbe } from './app-providers';
import { JiraVault } from './app-vault';
import { credentialEntry } from './credential-entry';
import { azureAccount, azureLogin, azureProof } from './app-azure';
import type { DevopsState } from '../../shared/contract';
function gh(): string {
  const exe = findCli('gh');
  if (!exe || /["\r\n%&|<>^!]/.test(exe) || (process.platform === 'win32' && !exe.toLowerCase().endsWith('.exe'))) throw new Error('Installa GitHub CLI dal sito ufficiale, poi riprova');
  return exe;
}
function run(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile(gh(), args, { windowsHide: true, timeout: 20000, maxBuffer: 256 * 1024, encoding: 'utf8' }, (error, stdout) => error ? reject(new Error('GitHub non disponibile')) : resolve(stdout)));
}
async function githubLogin() {
  const exe = gh();
  if (process.platform === 'darwin' || process.platform === 'linux') { await launchPosixLogin(process.platform, exe, ['auth', 'login', '--hostname', 'github.com', '--web', '--git-protocol', 'https']); return; }
  if (process.platform !== 'win32') throw new Error('Sistema non supportato');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `start "Accesso GitHub" /wait "${exe}" auth login --hostname github.com --web --git-protocol https`], { detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: true });
    child.once('error', () => reject(new Error('Accesso GitHub non avviato'))); child.once('spawn', () => { child.unref(); resolve(); });
  });
}
export function createAppConnectors(userData: string, refreshDevops: () => Promise<DevopsState>) {
  const file = path.join(userData, 'connector-projects.json');
  let selections: ConnectorSelections = {};
  const enabled = () => {
    if (process.env.SB_TEST || process.env.SB_DEMO || process.env.SB_HIDDEN === '1') throw new Error('Accesso reale disabilitato nelle sessioni di test');
  };
  const service = new AppConnectorService({
    async azureLogin() { enabled(); await azureLogin(); },
    async azureProbe() { enabled(); return azureProof(azureAccount, refreshDevops); },
    vault: new JiraVault(userData, safeStorageCipher(safeStorage)),
    loadSelections: () => selections,
    async saveSelections(value) {
      await fs.mkdir(userData, { recursive: true }); const temporary = `${file}.${randomUUID()}.tmp`;
      try { await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); await fs.rename(temporary, file); selections = value; }
      finally { await fs.rm(temporary, { force: true }); }
    },
    async githubLogin() { enabled(); await githubLogin(); },
    async githubProbe() {
      enabled(); return githubProbe(run);
    },
    async jiraLogin(save, signal) { enabled(); await credentialEntry(url => shell.openExternal(url), save, signal); },
    async jiraProbe(value) {
      enabled(); return jiraProbe(value);
    },
  });
  // Load only app-owned, bounded, nonsecret selection metadata, never credential/config files.
  const ready = (async () => {
    try {
      const stat = await fs.stat(file); if (stat.size > 65536) return;
      const data = JSON.parse(await fs.readFile(file, 'utf8')) as ConnectorSelections;
      for (const id of ['github', 'jira', 'azure'] as const) {
        const entry = data[id];
        if (entry && typeof entry.identity === 'string' && entry.identity.length <= 600 && Array.isArray(entry.projects) && entry.projects.length <= 100 && entry.projects.every(s => typeof s === 'string' && s.length <= 200)) selections[id] = entry;
      }
    } catch { /* Missing/invalid selections never authorize connections or network calls. */ }
  })();
  return { service, ready };
}
