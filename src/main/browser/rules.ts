// Browser rules enforced by the tools themselves, so they hold with any model (the owner, 2026-10-16: rules written
// only in the brain's on-demand files were skipped by weaker models; ADR 0063). Each check returns a refusal text with
// the exact fix, or null. A refusal is an error of the tool call: the model reads why and calls again the right way.
//   - envRefusal: a local stack (localhost, 127.0.0.1, ::1, *.localhost) always loads in environment "local", and
//     "local" holds only local stacks (a Sonnet chat opened localhost in another environment: no session there);
//   - loginRefusal: a login hand-off needs a page in the tab; on a local stack with a test account in the user's
//     credentials file the agent signs in itself (the hand-off is refused); on a remote host with entries for it the
//     agent names one of them (the banner then shows URL, account and a Copia password button).
// Pure (no Electron), unit-tested in test/unit/browser-rules.test.ts; used by browser/tools.ts.
import { envForUrl } from './envs';
import { isLocalHost } from './guard';

export const LOCAL_ENV = 'local';

const hostOf = (url: string): string => { try { return new URL(url).host.toLowerCase(); } catch { return ''; } };
const isWeb = (url: string): boolean => /^https?:\/\//i.test(url);

/** Refusal when url would load in environment env against the local-stack rule, else null. */
export function envRefusal(url: string, env: string): string | null {
  if (!isWeb(url)) return null;
  const derived = envForUrl(url);
  if (derived === LOCAL_ENV && env !== LOCAL_ENV) {
    return `Refused: ${hostOf(url)} is a local stack, and local stacks always load in environment "${LOCAL_ENV}" (its own session for the local test accounts), not "${env}". ` +
      `Call again with env "${LOCAL_ENV}" or without env (the default from the host is "${LOCAL_ENV}"; with navigate, env "${LOCAL_ENV}" opens a tab there). Open it yourself: never ask the user to open a browser or a URL.`;
  }
  if (env === LOCAL_ENV && derived !== LOCAL_ENV && !isLocalHost(url)) {
    return `Refused: environment "${LOCAL_ENV}" holds only local stacks (localhost, 127.0.0.1, *.localhost), and ${hostOf(url)} is a remote host. ` +
      `Call again without env (the default from the host is "${derived}") or with env "${derived}".`;
  }
  return null;
}

export interface LoginCheck {
  /** the tab's current URL */
  url: string;
  /** the account the agent named ('' when none) */
  account: string;
  /** user names of the credentials-file entries whose URL host is the page's host */
  accounts: string[];
  /** where the credentials file is, relative to the brain (for the hint; never its content) */
  file: string;
}

/** Refusal of a handoff_to_user kind "login", else null. */
export function loginRefusal(c: LoginCheck): string | null {
  if (!isWeb(c.url)) {
    return 'Refused: your tab has no page yet. Open the sign-in page in your own tab first (tabs_create with its url), then call handoff_to_user kind "login" with the account: never ask the user to open a browser or a URL.';
  }
  const host = hostOf(c.url);
  const list = c.accounts.map(a => `"${a}"`).join(', ');
  if (isLocalHost(c.url) && c.accounts.length) {
    return `Refused: ${host} is a local stack with test accounts in the user's credentials file (${c.file}): ${list}. ` +
      'On a local stack you sign in yourself (type / fill_form are allowed here): do not ask the user.';
  }
  if (!c.accounts.length) return null;
  const want = c.account.trim().toLowerCase();
  if (want && c.accounts.some(a => a.toLowerCase() === want)) return null;
  return `Refused: ${want ? `account "${c.account.trim()}" is not among the` : 'no account given; there are'} entries for ${host} in the user's credentials file (${c.file}): ${list}. ` +
    'Call handoff_to_user again with account = one of them: the banner shows its URL and account with a Copia password button (never write a password or sign-in steps in chat).';
}
