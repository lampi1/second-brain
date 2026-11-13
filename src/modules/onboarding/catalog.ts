// Audited official HTTP providers. Authentication always belongs to the harness, never this module.
import type { Harness, Provider } from './contract';
export const CATALOG_VERSION = '2026-10-17.1';
export const providers = {
  github: { name: 'GitHub', source: 'https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md', endpoint: 'https://api.githubcopilot.com/mcp/readonly' },
  jira: { name: 'Jira Cloud', source: 'https://github.com/atlassian/atlassian-mcp-server', endpoint: 'https://mcp.atlassian.com/v1/mcp' },
  azure: { name: 'Azure DevOps', source: 'https://learn.microsoft.com/en-us/azure/devops/mcp-server/remote-mcp-server', endpoint: 'https://mcp.dev.azure.com/' },
} as const;
export function providerEndpoint(provider: Provider, organization?: string): string {
  if (!Object.hasOwn(providers, provider)) throw new Error('Unknown provider');
  if (provider !== 'azure') return providers[provider].endpoint;
  if (!organization || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/.test(organization)) throw new Error('Choose your Azure DevOps organization');
  return providers.azure.endpoint + organization;
}
export function compatibility(provider: Provider, harness: Harness): string | null {
  if (provider !== 'azure') return null;
  return harness === 'codex' ? 'Azure remote authentication is unsupported by Codex; configuration is not changed.' : 'Azure requires an organization-managed Entra application; configuration is not changed until a supported adapter exists.';
}
