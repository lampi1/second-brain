// DevOps TokenProviders of the routine runtime (ADR 0175): the app's Azure CLI token (Bearer) and a routine package's
// embedded Personal Access Token (Basic, ADR 0176). Both give the full Authorization header value; the token itself is
// kept in memory only and registered with the masker so it never reaches a log or a run file. Used by the DevOps
// detector and writer (through `authorizationOf`) and by the CLI host.
import { execFile } from 'node:child_process';
import { addRedaction, secretForms } from './mask';
import type { TokenProvider } from './ports';

export const DEVOPS_RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798';
export const AZ_LOGIN_MESSAGE = 'DevOps: accesso Azure CLI non disponibile. Esegui az login.';

export class TokenUnavailable extends Error {}

/** CLI output remains in memory only. Windows needs its .cmd launcher, with an entirely constant command line. */
export function azureCliToken(signal?: AbortSignal, resource = DEVOPS_RESOURCE): Promise<string> {
  if (process.env.VITEST || process.env.SB_TEST || process.env.SB_DEMO) return Promise.reject(new TokenUnavailable(AZ_LOGIN_MESSAGE));
  const args = ['account', 'get-access-token', '--resource', resource, '--query', 'accessToken', '--output', 'tsv'];
  const win = process.platform === 'win32';
  return new Promise((resolve, reject) => {
    execFile(win ? process.env.ComSpec ?? 'cmd.exe' : 'az', win ? ['/d', '/s', '/c', `az ${args.join(' ')}`] : args,
      { windowsHide: true, timeout: 30_000, maxBuffer: 32_768, encoding: 'utf8', signal }, (error, stdout) => {
        if (error || !stdout.trim()) reject(new TokenUnavailable(AZ_LOGIN_MESSAGE));
        else resolve(stdout.trim());
      });
  });
}

/** The app's provider: `Bearer <token>` from `az account get-access-token`. */
export function azureCliTokenProvider(read: (signal?: AbortSignal) => Promise<string> = azureCliToken): TokenProvider {
  return { authorization: async signal => `Bearer ${await read(signal)}` };
}

/** A package's embedded PAT: Azure DevOps takes it as Basic with an empty user name. */
export function patTokenProvider(pat: string): TokenProvider {
  const value = pat.trim();
  if (!value || /\s/.test(value) || value.length > 1024) throw new TokenUnavailable('DevOps: PAT non valido nel pacchetto della routine.');
  for (const form of secretForms(value)) addRedaction(form, true);
  const header = `Basic ${Buffer.from(`:${value}`).toString('base64')}`;
  return { authorization: async () => header };
}

/** A raw bearer token reader (the historical `token` option of the writer and the detector) as a provider. */
export const bearer = (read: (signal?: AbortSignal) => Promise<string>): TokenProvider => ({ authorization: async signal => `Bearer ${await read(signal)}` });

/** Validates a provider's header before it is sent: one scheme, one opaque value, no whitespace or control characters. */
export function checkedAuthorization(header: unknown): string {
  if (typeof header !== 'string' || header.length > 40_000 || !/^(Bearer|Basic) [^\s]+$/.test(header)) throw new TokenUnavailable(AZ_LOGIN_MESSAGE);
  return header;
}
