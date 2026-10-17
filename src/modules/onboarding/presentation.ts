// Pure discovery presentation and deterministic connection intents; no model, credentials or filesystem access.
import type { Discovery, Harness, Provider } from './contract';
export const harnessNames: Record<Harness, string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor' };
export const serviceNames: Record<Provider, string> = { github: 'GitHub', azure: 'Azure DevOps', jira: 'Jira Cloud' };
export function discoveryView(found: Discovery | null) {
  const evidence = found?.evidence ?? [], repos = evidence.filter(e => e.kind === 'repo');
  const projects = repos.length ? repos : evidence.filter(e => e.kind === 'workspace');
  const installed = (['claude', 'codex', 'cursor'] as const).filter(h => evidence.some(e => e.kind === 'cli' && e.source === h));
  const services = (['github', 'azure'] as const).filter(p => repos.some(e => e.remoteHosts?.includes(p === 'github' ? 'github.com' : 'dev.azure.com')));
  return { repos, projects, installed, services };
}
export function connectionIntent(text: string): Provider | null {
  const match = text.trim().match(/^(?:collega|connect)\s+(jira(?:\s+cloud)?|github|azure(?:\s+devops)?|ado)[.!]?$/i);
  const name = match?.[1]?.toLowerCase();
  return name?.startsWith('jira') ? 'jira' : name === 'github' ? 'github' : name ? 'azure' : null;
}
export function projectName(file: string): string { return file.split(/[\\/]/).filter(Boolean).at(-1) ?? file; }
