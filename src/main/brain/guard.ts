// The publish guard before every push of a brain domain (ADR 0059): the same fail-closed scanner as the product sync
// (scan.mjs, left by the product sync in %LOCALAPPDATA%/second-brain/publish; SB_PUBLISH_DIR for tests) with the deny
// list the domain names (domain.json `denyList`, default deny-work.txt: work facts only, owner 2026-10-16; the public
// product sync keeps deny.txt),
// run on what the push would send: for each commit not on the remote yet, the files it adds or changes, as they are in
// that commit (a word written and then removed in a later commit would still reach the remote's history). Findings come
// back as file:line + rule, never the matched value. No scanner or no such deny list on this PC = the push is blocked
// with a hint (fail closed). Also scanned: each commit's message, author and committer (a word in a commit message is
// pushed too), and a merge's own changes against its first parent. The allow list is never read from the domain (what
// is being checked cannot exempt itself): only a private allow-<domain>.txt beside the scanner, optional. Plain Node; git
// and the scanner run as child processes. Used by brain/sync.ts.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NodeRunner } from './node';
import { runNode } from './node';

export interface GuardPaths { scan: string; deny: string; /** private allow list in the publish folder; absent = no allows */ allow?: string }
export interface GuardFinding { file: string; line: number | null; rule: string; commit?: string }
export type GuardResult = { ok: true } | { ok: false; findings: GuardFinding[] } | { ok: false; missing: string } | { ok: false; error: string };

/** Why the push is blocked when the guard is missing (Italian, shown in the sync status). */
export const noGuardHint = (denyList = 'deny-work.txt'): string =>
  `il controllo di pubblicazione (scan.mjs e ${denyList} in %LOCALAPPDATA%/second-brain/publish) manca su questo PC: copialo dal PC di lavoro o fai girare la sincronizzazione del prodotto una volta`;
export const NO_GUARD_HINT = noGuardHint();

/** The private allow list's file name for a domain: allow-<name>.txt, the name reduced to safe characters. */
export const allowFileName = (domain: string): string => `allow-${domain.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 50) || 'domain'}.txt`;

/** Where the guard lives on this PC, with the deny list `denyList` (a bare file name, checked by domains.ts) and the
 *  domain's private allow list if there is one; null = missing (the caller blocks the push). */
export function findGuard(denyList: string, env: NodeJS.ProcessEnv = process.env, domain?: string): GuardPaths | null {
  if (!denyList || path.basename(denyList) !== denyList) return null;
  const dir = env.SB_PUBLISH_DIR || path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'second-brain', 'publish');
  const scan = path.join(dir, 'scan.mjs');
  const deny = path.join(dir, denyList);
  if (!fs.existsSync(scan) || !fs.existsSync(deny)) return null;
  const allow = domain ? path.join(dir, allowFileName(domain)) : null;
  return allow && fs.existsSync(allow) ? { scan, deny, allow } : { scan, deny };
}

const gitOut = (cwd: string, args: string[]): Promise<Buffer> => new Promise((resolve, reject) => {
  execFile('git', ['-C', cwd, ...args], { encoding: 'buffer', maxBuffer: 1 << 28, windowsHide: true, timeout: 60_000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
});

/** The files a commit adds or changes (renames and copies by their new path); deletions carry nothing to scan. A merge
 *  is compared with its first parent: what it brings in, its own edits included (plain diff-tree lists nothing for it). */
async function changedIn(root: string, commit: string): Promise<string[]> {
  const parents = (await gitOut(root, ['rev-list', '--parents', '-n', '1', commit])).toString('utf8').trim().split(/\s+/).slice(1);
  const range = parents.length > 1 ? [`${commit}^1`, commit] : ['--root', commit];
  const out = await gitOut(root, ['-c', 'core.quotePath=false', 'diff-tree', '--no-commit-id', '-r', '-z', '--name-only', '--diff-filter=AMRCT', ...range]);
  return out.toString('utf8').split('\0').filter(Boolean);
}

/** The scanned name of a commit's metadata file (message, author, committer). */
export const metaFileName = (commit: string): string => `_commit-${commit.slice(0, 7)}.txt`;

/** Scans the commits `commits` (oldest first) of the repo at `root`. Never throws. */
export async function scanCommits(root: string, commits: string[], guard: GuardPaths | null, node: NodeRunner, missingHint = NO_GUARD_HINT): Promise<GuardResult> {
  if (!guard) return { ok: false, missing: missingHint };
  if (!commits.length) return { ok: true };
  const findings: GuardFinding[] = [];
  for (const c of commits) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-domain-guard-'));
    try {
      const files = await changedIn(root, c);
      for (const f of files) {
        const dest = path.join(tmp, f);
        // a path that would leave the temp folder is not a file git could have committed: refuse the push
        if (!path.resolve(dest).startsWith(path.resolve(tmp) + path.sep)) return { ok: false, error: `percorso non valido nel commit ${c.slice(0, 7)}` };
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, await gitOut(root, ['cat-file', 'blob', `${c}:${f}`]));
      }
      // the commit's message and who wrote it are pushed too (a name no committed file took)
      let meta = path.join(tmp, metaFileName(c));
      while (fs.existsSync(meta)) meta = meta.replace(/\.txt$/, '_.txt');
      fs.writeFileSync(meta, await gitOut(root, ['log', '-1', '--format=%an <%ae>%n%cn <%ce>%n%B', c]));
      const args = [tmp, '--deny', guard.deny, '--json', ...(guard.allow ? ['--allow', guard.allow] : [])];
      const r = await runNode(node, guard.scan, args, tmp, 120_000);
      if (r.code !== 0 && r.code !== 2) return { ok: false, error: `il controllo non è partito (codice ${r.code ?? '?'}): ${r.stderr.trim().split('\n').pop() ?? ''}`.slice(0, 300) };
      let parsed: { findings?: { where?: unknown; line?: unknown; rule?: unknown }[] };
      try { parsed = JSON.parse(r.stdout) as typeof parsed; } catch { return { ok: false, error: 'il controllo ha risposto in un formato sconosciuto' }; }
      if (r.code === 2 && !parsed.findings?.length) return { ok: false, error: 'il controllo ha bloccato senza dire dove' };
      for (const f of parsed.findings ?? []) {
        findings.push({
          file: String(f.where ?? '?').replace(/\\/g, '/'),
          line: typeof f.line === 'number' && f.line > 0 ? f.line : null,
          rule: String(f.rule ?? '?').slice(0, 60),
          commit: c.slice(0, 7),
        });
      }
    } catch (e) {
      return { ok: false, error: `controllo non riuscito: ${(e instanceof Error ? e.message : String(e)).split('\n')[0]}`.slice(0, 300) };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  return findings.length ? { ok: false, findings: findings.slice(0, 50) } : { ok: true };
}
