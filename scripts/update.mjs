// Verified update payloads for the existing stable launcher. Staging never switches current, launches, kills or
// touches userData. The UI owns download trust and explicit consent; release.mjs owns activation/rollback.
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_FILES = ['release.mjs', 'update.mjs', 'icon.ico', 'LICENSE'];
export const RELEASE_WRITER_PROTOCOL = 1;
const leases = new WeakMap();
const JOURNAL_FILES = [...ROOT_FILES, 'current.json', 'launch.cmd', 'launch.vbs', 'launch.sh', 'second-brain.command'];

/** Cooperative cross-process mutex. Never steal by age/PID; dirty failures preserve owner+journal for maintenance. */
export function acquireReleaseLock(root, operation) {
  root = path.resolve(root);
  fs.mkdirSync(root, { recursive: true });
  if (!equalPath(root, fs.realpathSync(root))) throw new Error('release root symlinks/junctions are not allowed');
  const stateFile = safePayloadPath(root, 'current.json');
  if (fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (state.current != null && state.writerProtocol !== RELEASE_WRITER_PROTOCOL) throw new Error('legacy release root requires offline migration with all legacy writers stopped');
  }
  const dir = path.join(root, '.release-writer-lock');
  try { fs.mkdirSync(dir); } catch (e) {
    if (e.code === 'EEXIST') throw new Error('release writer lock held; preserve its owner token/journal, no automatic recovery');
    throw e;
  }
  const identity = fs.lstatSync(dir);
  const owner = { protocol: RELEASE_WRITER_PROTOCOL, token: randomUUID(), pid: process.pid, operation, dirty: false, at: new Date().toISOString() };
  const ownerPath = path.join(dir, 'owner.json');
  const save = () => {
    const tmp = path.join(dir, `${owner.token}.tmp`);
    const fd = fs.openSync(tmp, 'wx');
    try { fs.writeFileSync(fd, JSON.stringify(owner, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, ownerPath);
  };
  const lease = {
    begin() {
      assertReleaseLease(root, lease);
      if (owner.dirty) return;
      // Persist rollback evidence before the first mutation. Maintenance must inspect, never blindly remove a lock.
      const before = {};
      fs.mkdirSync(path.join(dir, 'before'));
      for (const file of JOURNAL_FILES) {
        const source = path.join(root, file);
        if (!fs.existsSync(source)) { before[file] = null; continue; }
        const stat = fs.lstatSync(source);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw new Error('unsafe release journal source');
        const data = fs.readFileSync(source);
        const fd = fs.openSync(path.join(dir, 'before', file), 'wx');
        try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        before[file] = createHash('sha256').update(data).digest('hex');
      }
      owner.before = before;
      owner.dirty = true;
      save();
    },
    commit() {
      assertReleaseLease(root, lease);
      const wasDirty = owner.dirty;
      owner.dirty = false;
      try { save(); } catch (error) { owner.dirty = wasDirty; throw error; }
    },
    release() {
      assertReleaseLease(root, lease);
      if (owner.dirty) throw new Error('release mutation interrupted; owner token and rollback journal preserved');
      const stat = fs.lstatSync(dir);
      const disk = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
      if (stat.isSymbolicLink() || stat.ino !== identity.ino || stat.dev !== identity.dev || disk.token !== owner.token || disk.dirty) throw new Error('release lock ownership changed or is dirty; preserve it');
      if (path.dirname(dir) !== root || !equalPath(fs.realpathSync(dir), dir)) throw new Error('unsafe release lock cleanup');
      fs.rmSync(dir, { recursive: true });
      leases.delete(lease);
    },
  };
  leases.set(lease, { root, owner, dir, identity });
  save();
  return lease;
}

export function assertReleaseLease(root, lease) {
  const record = leases.get(lease);
  if (!record || !equalPath(record.root, path.resolve(root))) throw new Error('release mutation requires the owning writer lease');
  const stat = fs.lstatSync(record.dir);
  const file = path.join(record.dir, 'owner.json');
  if (stat.isSymbolicLink() || stat.ino !== record.identity.ino || stat.dev !== record.identity.dev || fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 16384 || JSON.parse(fs.readFileSync(file, 'utf8')).token !== record.owner.token) throw new Error('release lock ownership changed; preserve it');
}

export function withReleaseLock(root, operation, run) {
  const lease = acquireReleaseLock(root, operation);
  let result;
  try {
    if (run.constructor.name === 'AsyncFunction') throw new Error('release lock callback must be synchronous');
    result = run(lease);
    if (result && typeof result.then === 'function') throw new Error('release lock callback must be synchronous');
    lease.commit();
  } catch (error) {
    try { lease.release(); } catch (locked) { throw new Error(`${error.message}; ${locked.message}`, { cause: error }); }
    throw error;
  }
  lease.release();
  return result;
}

export function releaseLockInfo(root) {
  const file = path.join(root, '.release-writer-lock', 'owner.json');
  if (!fs.existsSync(path.join(root, '.release-writer-lock'))) return null;
  try {
    if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 16384) throw new Error('invalid owner');
    const { protocol, token, pid, operation, dirty, at } = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { protocol, token, pid, operation, dirty, at };
  } catch { return { blocked: true, reason: 'incomplete release lock; preserve it for maintenance' }; }
}
export const hashFile = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Atomic rename that waits out Windows sharing locks: open handles on files inside the source (antivirus scanning
 *  just-copied files) fail it with EPERM/EBUSY; retried for a bounded time, then the last error (EACCES may be a real ACL). */
function renameRetry(from, to, ms = 5000) {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (const until = Date.now() + ms; ;) {
    try { fs.renameSync(from, to); return; } catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code) || Date.now() > until) throw e;
      Atomics.wait(pause, 0, 0, 20);
    }
  }
}
const idOk = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id);
const inside = (root, file) => { const p = path.relative(root, file); return p !== '' && !p.startsWith('..') && !path.isAbsolute(p); };
const equalPath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

/** Reject traversal and junctions before any read or write; a manifest never supplies an absolute path. */
export function safePayloadPath(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.split('/').some(p => !p || p === '.' || p === '..' || p.includes(':'))) throw new Error('unsafe payload path');
  const file = path.resolve(root, ...relative.split('/'));
  if (!inside(root, file)) throw new Error('payload escapes its root');
  let ancestor = file;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const actual = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, file));
  if (!equalPath(actual, file)) throw new Error('payload symlinks/junctions are not allowed');
  return file;
}

function filesUnder(root, relative) {
  const dir = safePayloadPath(root, relative);
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.isSymbolicLink()) throw new Error('payload symlinks are not allowed');
    const p = `${relative}/${e.name}`;
    return e.isDirectory() ? filesUnder(root, p) : [p];
  });
}

export function manifestPayload(root, release, source, clean) {
  const names = [...ROOT_FILES, ...filesUnder(root, `releases/${release.id}`), ...filesUnder(root, `electron/${release.electron}`), ...filesUnder(root, 'engines')].sort();
  const manifest = { schema: 1, writerProtocol: RELEASE_WRITER_PROTOCOL, id: release.id, version: release.version, source, clean, electron: release.electron, files: Object.fromEntries(names.map(f => [f, hashFile(safePayloadPath(root, f))])) };
  fs.writeFileSync(path.join(root, 'payload.json'), JSON.stringify(manifest, null, 2));
  return { manifest, sha256: hashFile(path.join(root, 'payload.json')) };
}

function readManifest(file, expectedSha256) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 ?? '') || hashFile(file) !== expectedSha256) throw new Error('update manifest SHA-256 mismatch');
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (m.schema !== 1 || !idOk(m.id) || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(m.electron) || !m.files || typeof m.files !== 'object' || Array.isArray(m.files)) throw new Error('unsupported update manifest');
  const names = Object.keys(m.files);
  for (const required of [...ROOT_FILES, `releases/${m.id}/release.json`, `releases/${m.id}/package.json`, `releases/${m.id}/out/main/index.js`, `electron/${m.electron}/electron.exe`]) if (!names.includes(required)) throw new Error(`incomplete update: ${required}`);
  for (const [name, hash] of Object.entries(m.files)) {
    if (!(ROOT_FILES.includes(name) || name.startsWith(`releases/${m.id}/`) || name.startsWith(`electron/${m.electron}/`) || /^engines\/claude\/[^/]+\/claude\.exe$/.test(name)) || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('unexpected update asset');
  }
  return m;
}

function verifyFiles(m, locate) {
  for (const [name, hash] of Object.entries(m.files)) {
    const file = locate(name);
    if (!fs.lstatSync(file).isFile() || hashFile(file) !== hash) throw new Error(`update asset hash mismatch: ${name}`);
  }
  const rel = JSON.parse(fs.readFileSync(locate(`releases/${m.id}/release.json`), 'utf8'));
  if (rel.id !== m.id || rel.writerProtocol !== RELEASE_WRITER_PROTOCOL || rel.electron !== m.electron || rel.repo || !/^engines\/claude\/[^/]+\/claude\.exe$/.test(String(rel.claudeEngine).replaceAll('\\', '/')) || !m.files[String(rel.claudeEngine).replaceAll('\\', '/')]) throw new Error('update release metadata is not portable or writer-compatible');
}

export function stageUpdate(root, payload, expectedSha256) {
  return withReleaseLock(root, 'stage-update', lease => stageUpdateLocked(root, payload, expectedSha256, lease));
}

export function stageInstall(root, payload, expectedSha256, lease) {
  assertReleaseLease(root, lease);
  return stageUpdateLocked(root, payload, expectedSha256, lease, true);
}

function stageUpdateLocked(root, payload, expectedSha256, lease, installer = false) {
  root = path.resolve(root); payload = fs.realpathSync(payload);
  fs.mkdirSync(root, { recursive: true });
  root = fs.realpathSync(root);
  const m = readManifest(safePayloadPath(payload, 'payload.json'), expectedSha256);
  if (m.writerProtocol !== RELEASE_WRITER_PROTOCOL) throw new Error('incompatible release writer protocol');
  if ((!installer && m.clean !== true) || !/^[a-f0-9]{40}$/.test(m.source ?? '')) throw new Error('draft payloads cannot be applied as stable updates');
  verifyFiles(m, name => safePayloadPath(payload, name));
  const staged = safePayloadPath(root, `staged/${m.id}`);
  const locate = name => safePayloadPath(root, ROOT_FILES.includes(name) ? `staged/${m.id}/files/${name}` : name);
  const groupOf = name => name.startsWith('engines/') ? name.split('/').slice(0, 3).join('/') : name.split('/').slice(0, 2).join('/');
  const groups = [...new Set(Object.keys(m.files).filter(name => !ROOT_FILES.includes(name)).map(groupOf))];
  const existing = new Set(groups.filter(group => fs.existsSync(safePayloadPath(root, group))));
  // Check every collision before copying: an existing version is immutable, including a running runtime.
  for (const [name, hash] of Object.entries(m.files)) {
    const dest = locate(name);
    if (!ROOT_FILES.includes(name) && existing.has(groupOf(name)) && !fs.existsSync(dest)) throw new Error(`immutable update directory is incomplete: ${name}`);
    if (fs.existsSync(dest) && hashFile(dest) !== hash) throw new Error(`immutable update asset already exists with different content: ${name}`);
  }
  lease.begin();
  // New directories are assembled privately, then renamed whole. A crash never leaves a partial active runtime.
  for (const group of groups.filter(g => !existing.has(g))) {
    const work = safePayloadPath(root, `staged/${m.id}/work-${randomUUID()}`);
    fs.mkdirSync(work, { recursive: true });
    for (const name of Object.keys(m.files).filter(n => n.startsWith(`${group}/`))) {
      const dest = safePayloadPath(work, name.slice(group.length + 1));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(safePayloadPath(payload, name), dest, fs.constants.COPYFILE_EXCL);
      if (hashFile(dest) !== m.files[name]) throw new Error(`copied update asset mismatch: ${name}`);
    }
    const target = safePayloadPath(root, group);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    renameRetry(work, target); // freshly copied runtime files are what antivirus scans first
  }
  for (const name of ROOT_FILES) {
    const dest = locate(name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest)) fs.copyFileSync(safePayloadPath(payload, name), dest, fs.constants.COPYFILE_EXCL);
  }
  verifyFiles(m, locate);
  fs.mkdirSync(staged, { recursive: true });
  const manifestDest = safePayloadPath(root, `staged/${m.id}/payload.json`);
  const manifestTmp = `${manifestDest}.${randomUUID()}.tmp`;
  fs.copyFileSync(safePayloadPath(payload, 'payload.json'), manifestTmp, fs.constants.COPYFILE_EXCL);
  if (hashFile(manifestTmp) !== expectedSha256) throw new Error('update manifest changed during staging');
  fs.renameSync(manifestTmp, manifestDest);
  const marker = { id: m.id, version: m.version, source: m.source, manifestSha256: expectedSha256, at: new Date().toISOString() };
  const markerPath = safePayloadPath(root, `staged/${m.id}.json`);
  const tmp = `${markerPath}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(marker, null, 2), { flag: 'wx' });
  fs.renameSync(tmp, markerPath);
  return marker;
}

/** Called only after UI consent. Returns the validated id; caller atomically activates it, then chooses when to quit. */
export function prepareApply(root, id, expectedSha256, lease) {
  if (!idOk(id)) throw new Error('invalid staged release identifier');
  root = fs.realpathSync(root);
  assertReleaseLease(root, lease);
  const marker = JSON.parse(fs.readFileSync(safePayloadPath(root, `staged/${id}.json`), 'utf8'));
  if (marker.id !== id || marker.manifestSha256 !== expectedSha256) throw new Error('staged marker does not match consent');
  const m = readManifest(safePayloadPath(root, `staged/${id}/payload.json`), expectedSha256);
  if (m.writerProtocol !== RELEASE_WRITER_PROTOCOL) throw new Error('incompatible release writer protocol');
  if (m.id !== id) throw new Error('staged manifest does not match release');
  const locate = name => safePayloadPath(root, ROOT_FILES.includes(name) ? `staged/${id}/files/${name}` : name);
  verifyFiles(m, locate);
  lease.begin();
  for (const name of ROOT_FILES) {
    const dest = safePayloadPath(root, name);
    const tmp = `${dest}.${randomUUID()}.tmp`;
    fs.copyFileSync(locate(name), tmp, fs.constants.COPYFILE_EXCL);
    fs.renameSync(tmp, dest);
  }
  return id;
}

export function stagedUpdates(root) {
  const dir = path.join(root, 'staged');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).flatMap(f => {
    try { const m = JSON.parse(fs.readFileSync(safePayloadPath(root, `staged/${f}`), 'utf8')); return idOk(m.id) && f === `${m.id}.json` ? [m] : []; } catch { return []; }
  });
}
