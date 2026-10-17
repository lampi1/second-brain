// Build an offline per-user Windows installer without promoting or touching any running instance. CI/main then
// runs test:installer on this exact executable; the manual release workflow is the only distribution path.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compiler, INNO, run } from './inno.mjs';
import { hashFile, manifestPayload } from './update.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('the Windows installer currently targets x64; build on Windows x64');
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const source = git('rev-parse', 'HEAD');
const statusBefore = git('status', '--porcelain');
const diffBefore = git('diff', 'HEAD', '--binary');
const clean = !statusBefore;
const dir = path.join(repo, 'test-results', 'installer');
fs.mkdirSync(dir, { recursive: true });
const payload = fs.mkdtempSync(path.join(dir, 'payload-'));
run(process.execPath, [path.join(repo, 'scripts', 'release.mjs'), 'stage-test'], { cwd: repo, env: { ...process.env, SB_RELEASES_ROOT: payload, SB_NO_SYNC: '1', ELECTRON_RUN_AS_NODE: '1' } });
const { current: id } = JSON.parse(fs.readFileSync(path.join(payload, 'current.json'), 'utf8'));
const release = JSON.parse(fs.readFileSync(path.join(payload, 'releases', id, 'release.json'), 'utf8'));
if (!release.claudeEngine) throw new Error('the pinned Windows Claude engine is missing: npm run setup must install optional dependencies');
const assertSource = () => {
  if (git('rev-parse', 'HEAD') !== source || git('status', '--porcelain') !== statusBefore || git('diff', 'HEAD', '--binary') !== diffBefore || !source.startsWith(release.sha)) throw new Error('source changed during packaging; discard this candidate and build again');
};
assertSource();
const name = `second-brain-${id}-windows-x64-setup`;
const output = path.join(dir, 'dist');
fs.mkdirSync(output, { recursive: true });
fs.copyFileSync(path.join(repo, 'LICENSE'), path.join(payload, 'LICENSE'));
const { sha256: payloadManifestSha256 } = manifestPayload(payload, release, source, clean);
const archive = path.join(output, `${name.replace('-setup', '')}-update.zip`);
const powershell = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
run(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(repo, 'scripts', 'zip-payload.ps1'), '-PayloadRoot', payload, '-Output', archive]);
const update = { archive: path.basename(archive), sha256: hashFile(archive), payloadManifestSha256 };
assertSource();
fs.writeFileSync(`${archive}.sha256`, `${update.sha256}  ${path.basename(archive)}\n`);
if (process.argv.includes('--payload-only')) {
  fs.writeFileSync(path.join(dir, 'latest-payload.json'), JSON.stringify({ payload, archive, id, source, clean, update }, null, 2));
  console.log(`payload only: ${archive}\ninstaller compiler not invoked; this is not a Setup executable`);
  process.exit(0);
}
run(await compiler(repo), ['/Qp', `/DPayload=${payload}`, `/DPayloadManifestSha256=${payloadManifestSha256}`, `/DReleaseId=${id}`, `/DAppVersion=${release.version}`, `/DElectronVersion=${release.electron}`, `/DOutputName=${name}`, `/O${output}`, path.join(repo, 'build', 'windows.iss')]);
assertSource();
const installer = path.join(output, `${name}.exe`);
const sha256 = createHash('sha256').update(fs.readFileSync(installer)).digest('hex');
fs.writeFileSync(`${installer}.sha256`, `${sha256}  ${path.basename(installer)}\n`);
const manifest = { id, version: release.version, source, clean, arch: 'x64', compiler: INNO.version, installer: path.basename(installer), sha256, update };
fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify(manifest, null, 2));
// Local orchestration only: never publish builder paths in a distributed artifact.
fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ installer, payload, manifest }, null, 2));
console.log(`installer: ${installer}\nSHA-256: ${sha256}\n${clean ? 'clean source; still requires installer smoke and release gates' : 'DRAFT: uncommitted source, never distribute'}`);
