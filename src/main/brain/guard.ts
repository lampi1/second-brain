// The publish guard before every push of a brain domain (ADR 0059): the app's own fail-closed scanner
// (tools/guard/scan.mjs, the one the repo's git hooks run, ADR 0061; scripts/build.mjs copies it to out/guard/scan.mjs, so
// the dev build and every frozen release, which is a copy of out/, carry it) with the deny list the domain names
// (domain.json `denyList`, default deny-work.txt: work facts only, owner 2026-10-16), a private file in the publish
// folder (%LOCALAPPDATA%/second-brain/publish on Windows; SB_PUBLISH_DIR for tests, which then also holds the scanner),
// run on what the push would send: for each commit not on the remote yet, the files it adds or changes, as they are in
// that commit (a word written and then removed in a later commit would still reach the remote's history). Findings come
// back as file:line + rule, never the matched value. No scanner or no such deny list on this PC = the push is blocked
// with a hint (fail closed). Also scanned: each commit's message, author and committer (a word in a commit message is
// pushed too), and a merge's own changes against its first parent. The allow list is never read from the domain (what
// is being checked cannot exempt itself): only a private allow-<domain>.txt beside the deny list, optional; a domain's
// own .guardallow is scanned like any other file. Plain Node; git and the scanner run as child processes. Used by
// brain/sync.ts.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sharedDir } from '../platform';
import type { NodeRunner } from './node';
import { runNode } from './node';

export interface GuardPaths { scan: string; deny: string; /** private allow list in the publish folder; absent = no allows */ allow?: string }
export interface GuardFinding { file: string; line: number | null; rule: string; commit?: string }
export type GuardResult = { ok: true } | { ok: false; findings: GuardFinding[] } | { ok: false; missing: string } | { ok: false; error: string };

/** Why the push is blocked when the guard is missing (Italian, shown in the sync status), naming the folder this PC
 *  really reads (it differs per OS). */
export const noGuardHint = (denyList = 'deny-work.txt', env: NodeJS.ProcessEnv = process.env): string =>
  `manca la lista delle parole vietate ${denyList} in ${publishDir(env)}: creala lì, una parola per riga (nomi di clienti, colleghi, server che non devono uscire), poi riprova`;

/** The private allow list's file name for a domain: allow-<name>.txt, the name reduced to safe characters. */
export const allowFileName = (domain: string): string => `allow-${domain.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 50) || 'domain'}.txt`;

/** The scanner shipped with the app: out/guard/scan.mjs beside the main bundle (out/main/index.js), in the dev build
 *  and in a release alike (scripts/build.mjs copies it there; a release is a copy of out/). Null where there is no file
 *  URL (never in the app). */
export function appScanner(bundleUrl: string = import.meta.url): string | null {
  try { return path.join(path.dirname(fileURLToPath(bundleUrl)), '..', 'guard', 'scan.mjs'); } catch { return null; }
}

/** The private folder of the deny and allow lists: SB_PUBLISH_DIR, else <shared app folder>/publish. */
export const publishDir = (env: NodeJS.ProcessEnv = process.env): string => env.SB_PUBLISH_DIR || path.join(sharedDir(env), 'publish');

/** Where the guard lives on this PC: the app's scanner (`scanner`; with SB_PUBLISH_DIR set, the scan.mjs in that
 *  folder instead: tests put a fake there), the deny list `denyList` (a bare file name, checked by domains.ts) and the
 *  domain's private allow list if there is one; null = something missing (the caller blocks the push). */
export function findGuard(denyList: string, env: NodeJS.ProcessEnv = process.env, domain?: string, scanner: string | null = appScanner()): GuardPaths | null {
  if (!denyList || path.basename(denyList) !== denyList) return null;
  const dir = publishDir(env);
  const scan = env.SB_PUBLISH_DIR ? path.join(dir, 'scan.mjs') : scanner;
  const deny = path.join(dir, denyList);
  if (!scan || !fs.existsSync(scan) || !fs.existsSync(deny)) return null;
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

/** An empty allow file outside any scanned folder: "no allows", stated explicitly to the scanner. */
let emptyAllow: string | null = null;
function noAllow(): string {
  if (!emptyAllow || !fs.existsSync(emptyAllow)) {
    emptyAllow = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-domain-allow-')), 'allow-none.txt');
    fs.writeFileSync(emptyAllow, '');
  }
  return emptyAllow;
}

/** Scans the commits `commits` (oldest first) of the repo at `root`. Never throws. */
export async function scanCommits(root: string, commits: string[], guard: GuardPaths | null, node: NodeRunner, missingHint = noGuardHint()): Promise<GuardResult> {
  if (!guard) return { ok: false, missing: missingHint };
  if (!commits.length) return { ok: true };
  const findings: GuardFinding[] = [];
  for (const c of commits) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-domain-guard-'));
    try {
      const files = await changedIn(root, c);
      for (const f of files) {
        // the scanner reads a top-level .guardallow as its allow list and never scans it: the domain's own is a plain
        // file here (scanned, never obeyed), under a name no committed file took
        let dest = path.join(tmp, f === '.guardallow' ? 'guardallow-del-dominio.txt' : f);
        const taken = new Set(files.map(x => x.toLowerCase()));
        if (f === '.guardallow') while (taken.has(path.relative(tmp, dest).split(path.sep).join('/').toLowerCase())) dest = dest.replace(/\.txt$/, '_.txt');
        // a path that would leave the temp folder is not a file git could have committed: refuse the push
        if (!path.resolve(dest).startsWith(path.resolve(tmp) + path.sep)) return { ok: false, error: `percorso non valido nel commit ${c.slice(0, 7)}` };
        // two paths that differ only in case land on one file on Windows: the second would hide the first from the scan
        if (fs.existsSync(dest)) return { ok: false, error: `due percorsi nel commit ${c.slice(0, 7)} differiscono solo per maiuscole: rinominane uno` };
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, await gitOut(root, ['cat-file', 'blob', `${c}:${f}`]));
      }
      // the commit's message and who wrote it are pushed too (a name no committed file took)
      let meta = path.join(tmp, metaFileName(c));
      while (fs.existsSync(meta)) meta = meta.replace(/\.txt$/, '_.txt');
      fs.writeFileSync(meta, await gitOut(root, ['log', '-1', '--format=%an <%ae>%n%cn <%ce>%n%B', c]));
      // always an explicit allow file (never <tmp>/.guardallow) and --no-skip (a domain's top-level out/ or
      // node_modules/ is pushed like anything else)
      const args = [tmp, '--deny', guard.deny, '--json', '--no-skip', '--allow', guard.allow ?? noAllow()];
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
