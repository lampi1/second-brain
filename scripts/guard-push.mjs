// guard-push: the pre-push net (ADR 0061). For each ref being pushed it lists the commits the remote does not have yet
// (the tip minus the remote's old value and the remote's tracking refs; to an unknown remote: the whole history) and
// scans every one of them with tools/guard/scan.mjs --commits: every blob of their trees (so the tip's whole tree too),
// every message, author and committer; also the pushed ref names (deletions too) and annotated tag objects (message and
// tagger), even when no commit is new. File and folder names go through the rules too (scan.mjs). Allow file: the
// .guardallow of the pushed tip (never for commit, ref or tag text); deny list: `guard.denyList` when set (set but
// missing → blocked). When `guard.email` is set, every new commit's author and committer and every pushed tag's tagger
// e-mail must be that one. Fail-closed: any error blocks the push. Never skippable from the app or by agents (no --no-verify).
// Exit 0 → the push goes on; 1 → blocked, with file:line or commit + rule (never the value) and the fix.
// Run by .githooks/pre-push (args: remote name, url; stdin: one line per ref); tested in test/unit/guard-push-hook.test.ts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { GuardError, blockMessage, denyArgs, git, gitOk, identEmail, identityFix, identityProblems, readGuardConfig, runScan } from './guard-lib.mjs';

const ZERO = /^0+$/;
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/i;

/** pre-push stdin → [{ localRef, localSha, remoteRef, remoteSha }]; a malformed line blocks. */
export function parseUpdates(text) {
  return text.split(/\r?\n/).filter(l => l.trim()).map(l => {
    const [localRef, localSha, remoteRef, remoteSha, extra] = l.trim().split(/\s+/);
    if (extra !== undefined || !remoteRef || !SHA.test(localSha ?? '') || !SHA.test(remoteSha ?? '')) throw new GuardError(`guard: BLOCKED, unexpected pre-push input line: ${l.slice(0, 200)}`);
    return { localRef, localSha, remoteRef, remoteSha };
  });
}

/** The commits of one update the remote does not have: [{ sha, author, committer }] (e-mails lowercase). */
export function newCommits(top, remote, u) {
  const not = [];
  if (!ZERO.test(u.remoteSha) && git(['cat-file', '-e', `${u.remoteSha}^{commit}`], top).status === 0) not.push(u.remoteSha);
  const remotes = gitOk(['remote'], top).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const args = ['rev-list', '--no-commit-header', '--format=%H%x00%ae%x00%ce', u.localSha, ...not.map(s => `^${s}`)];
  if (remotes.includes(remote)) args.push('--not', `--remotes=${remote}`);
  return gitOk(args, top).split('\n').filter(Boolean).map(l => {
    const [sha, author, committer] = l.split('\0');
    return { sha, author: (author ?? '').toLowerCase(), committer: (committer ?? '').toLowerCase() };
  });
}

export function guardPush(remote, stdinText, cwd = process.cwd()) {
  const top = gitOk(['rev-parse', '--show-toplevel'], cwd).trim();
  const cfg = readGuardConfig(top);
  const deny = denyArgs(cfg);
  let scanned = 0;
  const updates = parseUpdates(stdinText);
  for (const [i, u] of updates.entries()) {
    // the ref names are published too (a branch or tag named after a customer), deletions included; the labels never
    // carry the name (it may be the matched value): the update's position in this push
    const meta = [
      { label: `pushed ref ${i + 1} of ${updates.length}, local name`, text: u.localRef },
      { label: `pushed ref ${i + 1} of ${updates.length}, remote name`, text: u.remoteRef },
    ];
    const deleting = ZERO.test(u.localSha);
    const commits = deleting ? [] : newCommits(top, remote, u);
    const idents = commits.flatMap(c => [
      { where: `commit ${c.sha.slice(0, 8)}`, who: 'author', email: c.author },
      { where: `commit ${c.sha.slice(0, 8)}`, who: 'committer', email: c.committer },
    ]);
    // annotated tags (nested too): their message and tagger are published as they are
    let tagged = false;
    for (let sha = u.localSha, depth = 0; !deleting && u.localSha !== u.remoteSha; depth++) {
      if (depth > 20) throw new GuardError(`guard: BLOCKED, ${u.localRef}: a tag chain deeper than 20`);
      if (gitOk(['cat-file', '-t', sha], top).trim() !== 'tag') break;
      const raw = gitOk(['cat-file', 'tag', sha], top);
      meta.push({ label: `tag object ${sha.slice(0, 8)} (tagger/message)`, text: raw });
      idents.push({ where: `tag object ${sha.slice(0, 8)}`, who: 'tagger', email: identEmail(/^tagger (.*)$/m.exec(raw)?.[1]) });
      tagged = true;
      const next = /^object ([0-9a-f]{40,64})$/m.exec(raw)?.[1];
      if (!next) throw new GuardError(`guard: BLOCKED, ${u.localRef}: unreadable tag object ${sha.slice(0, 8)}`);
      sha = next;
    }
    const wrong = identityProblems(cfg.email, idents);
    if (wrong.length) {
      throw new GuardError([`guard: BLOCKED, pushed ref ${i + 1} of ${updates.length}: commits or tags not made with guard.email`, ...wrong, identityFix(cfg.email, true),
        ...(tagged ? ['  a tag: delete it and create it again with the right identity (git tag -d <name>, then git tag -a <name>)'] : [])].join('\n'));
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-guard-push-'));
    try {
      const list = path.join(tmp, 'commits.txt');
      fs.writeFileSync(list, commits.map(c => c.sha).join('\n') + '\n');
      const metaFile = path.join(tmp, 'meta.json');
      fs.writeFileSync(metaFile, JSON.stringify(meta));
      const allow = path.join(tmp, 'guardallow');
      const tipAllow = deleting ? { status: 1 } : git(['cat-file', 'blob', `${u.localSha}:.guardallow`], top, { buffer: true });
      fs.writeFileSync(allow, tipAllow.status === 0 ? tipAllow.stdout : '');
      const findings = runScan([top, '--commits', list, '--meta', metaFile, '--allow', allow, ...deny]);
      if (findings.length) {
        const full = new Map(commits.map(c => [c.sha.slice(0, 8), c.sha]));
        throw new GuardError(`pushed ref ${i + 1} of ${updates.length}:\n` + blockMessage(findings, where => {
          const at = where.lastIndexOf('@');
          const sha = at > 0 ? full.get(where.slice(at + 1)) : null;
          if (!sha) return null;
          const blob = git(['cat-file', 'blob', `${sha}:${where.slice(0, at)}`], top, { buffer: true });
          return blob.status === 0 ? { path: where.slice(0, at), buf: blob.stdout } : null;
        }, { pushing: true }));
      }
      scanned += commits.length;
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  return { commits: scanned };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const r = guardPush(process.argv[2] ?? '', fs.readFileSync(0, 'utf8'));
    if (r.commits) console.error(`guard: ${r.commits} new commit${r.commits === 1 ? '' : 's'} checked, clean`);
  } catch (e) {
    console.error(e instanceof GuardError ? e.message : `guard: BLOCKED, the pre-push check failed (${e?.message ?? e})`);
    process.exit(1);
  }
}
