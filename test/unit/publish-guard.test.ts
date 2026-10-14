// The product's publish guard on this repo: the owner's product sync publishes the app's tracked files to a GitHub repo
// only after a fail-closed scan (no personal or company data: names, hosts, e-mails, secrets), so a word that would block
// it fails `npm run check` here first, not the sync after a promotion (2026-10-13: every sync blocked for two days).
// The scanner, the deny list and the allow file are not in this repo (the deny list is private): the sync leaves copies
// in its folder (%LOCALAPPDATA%/second-brain/publish: scan.mjs, deny.txt, guardallow, refreshed at each sync). Without
// them (a machine that never synced) there is nothing private to check and the test is skipped. Read-only: it scans a
// temp copy of the files the sync would publish and prints only file:line + rule, never a matched value.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const PUB = process.env.SB_PUBLISH_DIR ?? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'second-brain', 'publish');
const SCAN = path.join(PUB, 'scan.mjs');
const DENY = path.join(PUB, 'deny.txt');
const ALLOW = path.join(PUB, 'guardallow');
const ready = fs.existsSync(SCAN) && fs.existsSync(DENY);
// Same as the sync's exclusions (its manifest, APP_EXCLUDE): research notes, mockups, build output, images except the
// hash-pinned ones the product needs (icon, e2e baselines, README screenshots).
const EXCLUDE = [/^docs\/research\//, /^docs\/mockups\//, /^test-results\//, /^out\//,
  /^(?!build\/icon\.png$|test\/e2e\/[^/]+-snapshots\/[^/]+\.png$|docs\/screenshots\/[^/]+\.webp$).*\.(png|jpe?g|gif|webp)$/i];

const root = path.resolve(import.meta.dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-publish-guard-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe.skipIf(!ready)('publish guard', () => {
  it('the files the product sync would publish carry no finding', () => {
    // tracked files and new ones not yet added (ignored ones never are), as they are on disk now
    const files = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
      .split('\0').filter(f => f && !EXCLUDE.some(re => re.test(f)) && fs.existsSync(path.join(root, f)));
    for (const f of new Set(files)) {
      fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
      fs.copyFileSync(path.join(root, f), path.join(tmp, f));
    }
    const args = [SCAN, tmp, '--deny', DENY, '--json', ...(fs.existsSync(ALLOW) ? ['--allow', ALLOW] : [])];
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
    expect(r.status === 0 || r.status === 2, `scan failed: ${r.stderr}`).toBe(true);
    const found = (JSON.parse(r.stdout) as { findings: { where: string; line: number; rule: string }[] }).findings
      .map(f => `${f.where}${f.line ? `:${f.line}` : ''}  ${f.rule}`);
    // a finding: use a generic placeholder (example.com, "Studio Demo", a made-up name); see the line, not this output
    expect(found).toEqual([]);
  }, 60_000);
});
