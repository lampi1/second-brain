// Last step of a Windows release: verify tag, source and exact artifact bytes before creating a DRAFT release with gh.
// Runs in the manual workflow, or with --local on the owner's Windows PC after `npm run package:windows` (GitHub
// Actions may be off: `npm run release:draft -- v0.1.0`; ADR 0074). No shell interpolation, no new tags, no
// overwrite, never a published release: the owner reviews and publishes the draft. Never used by promotion or agents.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = process.argv.includes('--local') && process.env.GITHUB_ACTIONS !== 'true';
const tag = process.env.RELEASE_TAG ?? (local ? process.argv.slice(2).find(a => a.startsWith('v')) ?? '' : '');
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
if (local) {
  // the owner's clean main, the tag on its tip: the same source the workflow would have checked out
  if (git('branch', '--show-current') !== 'main' || git('status', '--porcelain')) throw new Error('local release drafts require a clean main checkout');
  process.env.RELEASE_REF = 'refs/heads/main';
  process.env.RELEASE_SHA = git('rev-parse', 'HEAD');
}
if ((!local && process.env.GITHUB_ACTIONS !== 'true') || process.env.RELEASE_REF !== 'refs/heads/main' || !/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(tag)) throw new Error('release drafts require a manual main workflow (or --local on a clean main) and a version tag');
const dir = path.join(repo, 'test-results', 'installer', 'dist');
const manifests = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
if (manifests.length !== 1) throw new Error('expected exactly one installer manifest');
const manifestPath = path.join(dir, manifests[0]);
const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const tagged = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`);
if (!m.clean || m.source !== process.env.RELEASE_SHA || tagged !== m.source || tag !== `v${m.version}`) throw new Error('tag, workflow commit and clean installer source must match');
if (typeof m.installer !== 'string' || path.basename(m.installer) !== m.installer || !m.installer.endsWith('.exe')) throw new Error('invalid installer asset name');
const exe = path.join(dir, m.installer);
if (createHash('sha256').update(fs.readFileSync(exe)).digest('hex') !== m.sha256) throw new Error('installer SHA-256 mismatch');
if (!m.update || typeof m.update.archive !== 'string' || path.basename(m.update.archive) !== m.update.archive || !m.update.archive.endsWith('.zip')) throw new Error('invalid update archive');
const archive = path.join(dir, m.update.archive);
if (createHash('sha256').update(fs.readFileSync(archive)).digest('hex') !== m.update.sha256) throw new Error('update archive SHA-256 mismatch');
execFileSync('gh', ['release', 'create', tag, exe, `${exe}.sha256`, archive, `${archive}.sha256`, manifestPath, '--verify-tag', '--draft', '--title', `second-brain ${m.version} for Windows`, '--notes', `Offline per-user Windows x64 installer and background-update payload. Includes Electron and the Claude engine; no Node/npm or checkout required. ${local ? 'Built and checked on the maintainer’s Windows PC (npm run check, test:stable, test:installer).' : 'Passed main CI, stable-copy and installed-launch checks.'} Verify the accompanying SHA-256 before sharing.`], { cwd: repo, stdio: 'inherit', windowsHide: true });
