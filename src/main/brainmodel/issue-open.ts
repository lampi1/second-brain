// Opens a maintenance card's GitHub issue at once when the user approves it in Proposte (ADR 0149; before it «Apri
// issue» handed the text to the Orchestrator, ADR 0132). First `gh issue create` with the user's own gh login (the app
// never sees a token: gh keeps its own), the body passed on stdin, never through a shell; labels the repository does
// not have make gh fail, so it tries once more without them. When gh is missing, not logged in or refused, the
// repository's new-issue page opens in the browser with the title and body already filled in: the user only presses
// «Submit». Pure over its ports (run, openUrl). Used by wiring.ts; tests: test/unit/brainmodel/issue-open.test.ts.
import { execFile } from 'node:child_process';
import type { ResearchIssue } from '../../shared/maintenance-research';

export interface IssueOpenPorts {
  /** runs gh with these arguments and stdin; resolves its stdout, rejects with its stderr */
  run(args: string[], stdin: string): Promise<string>;
  /** opens a https page in the system browser */
  openUrl(url: string): Promise<void>;
}
export interface IssueOpened { url: string; via: 'gh' | 'browser' }

/** GitHub refuses a longer new-issue link; the body is cut there with a line that says so. */
const MAX_URL = 7500;

/** The new-issue page with the title, body and labels filled in. */
export function newIssueUrl(repo: string, issue: ResearchIssue): string {
  const base = `https://github.com/${repo}/issues/new`;
  const q = (body: string) => {
    const p = new URLSearchParams({ title: issue.title, body });
    if (issue.labels?.length) p.set('labels', issue.labels.join(','));
    return `${base}?${p.toString()}`;
  };
  let body = issue.body, url = q(body);
  while (url.length > MAX_URL && body.length > 200) {
    body = `${body.slice(0, Math.floor(body.length * 0.8))}\n\n…`;
    url = q(body);
  }
  return url;
}

/** The issue's link from gh's output (its last line is the new issue's URL). */
const urlOf = (out: string, repo: string): string | null => {
  const m = new RegExp(`https://github\\.com/${repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/issues/\\d+`).exec(out);
  return m ? m[0] : null;
};

export async function openIssue(repo: string, issue: ResearchIssue, ports: IssueOpenPorts): Promise<IssueOpened> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Repository dell\'app sconosciuto: la issue non si può aprire.');
  const base = ['issue', 'create', '--repo', repo, '--title', issue.title, '--body-file', '-'];
  const labels = (issue.labels ?? []).flatMap(l => ['--label', l]);
  for (const args of labels.length ? [[...base, ...labels], base] : [base]) {
    try {
      const url = urlOf(await ports.run(args, issue.body), repo);
      if (url) return { url, via: 'gh' };
    } catch { /* no gh, not logged in, an unknown label: next try, then the browser */ }
  }
  const url = newIssueUrl(repo, issue);
  await ports.openUrl(url);
  return { url, via: 'browser' };
}

/** gh on the PATH, with no window, a minute at most, its body on stdin. */
export const ghRun = (args: string[], stdin: string): Promise<string> => new Promise((resolve, reject) => {
  const child = execFile('gh', args, { windowsHide: true, timeout: 60_000, maxBuffer: 1e6, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } }, (err, stdout, stderr) => {
    if (err) reject(new Error(String(stderr || err.message).trim().slice(0, 300))); else resolve(String(stdout));
  });
  child.stdin?.end(stdin);
});
