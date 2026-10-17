// Manual workflow final step: verify tag, source and exact artifact bytes before creating a draft release with gh.
// No shell interpolation, no new tags, no overwrite. Never used by promotion or local agents.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tag = process.env.RELEASE_TAG ?? '';
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RELEASE_REF !== 'refs/heads/main' || !/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(tag)) throw new Error('release drafts require a manual main workflow and a version tag');
const dir = path.join(repo, 'test-results', 'installer', 'dist');
const manifests = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
if (manifests.length !== 1) throw new Error('expected exactly one installer manifest');
const manifestPath = path.join(dir, manifests[0]);
const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const tagged = execFileSync('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], { cwd: repo, encoding: 'utf8' }).trim();
if (!m.clean || m.source !== process.env.RELEASE_SHA || tagged !== m.source || tag !== `v${m.version}`) throw new Error('tag, workflow commit and clean installer source must match');
if (typeof m.installer !== 'string' || path.basename(m.installer) !== m.installer || !m.installer.endsWith('.exe')) throw new Error('invalid installer asset name');
const exe = path.join(dir, m.installer);
if (createHash('sha256').update(fs.readFileSync(exe)).digest('hex') !== m.sha256) throw new Error('installer SHA-256 mismatch');
if (!m.update || typeof m.update.archive !== 'string' || path.basename(m.update.archive) !== m.update.archive || !m.update.archive.endsWith('.zip')) throw new Error('invalid update archive');
const archive = path.join(dir, m.update.archive);
if (createHash('sha256').update(fs.readFileSync(archive)).digest('hex') !== m.update.sha256) throw new Error('update archive SHA-256 mismatch');
execFileSync('gh', ['release', 'create', tag, exe, `${exe}.sha256`, archive, `${archive}.sha256`, manifestPath, '--verify-tag', '--draft', '--title', `second-brain ${m.version} for Windows`, '--notes', 'Offline per-user Windows x64 installer and background-update payload. Includes Electron and the Claude engine; no Node/npm or checkout required. Passed main CI, stable-copy and installed-launch checks. Verify the accompanying SHA-256 before sharing.'], { cwd: repo, stdio: 'inherit', windowsHide: true });
