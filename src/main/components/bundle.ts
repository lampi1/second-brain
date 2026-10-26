// Validate inert text bundles and derive immutable manifests before routine adoption. Never writes executable files.
import { createHash } from 'node:crypto';
import type { ComponentBundle, ComponentDiff, ComponentFile } from '../../shared/components';
import { integer, keys, object, text } from '../flows/schema';
export const hash = (s: string): string => createHash('sha256').update(s).digest('hex');
export function componentPath(value: unknown): string {
  const p = text(value, 'component path', 500);
  if (p !== value || /[\\:\x00-\x1f\x7f]/.test(p) || p.split('/').some(s => !s || s === '.' || s === '..' || s.toLowerCase() === '.git' || /[. ]$/.test(s))) throw new Error('Unsafe component path');
  return p;
}
export function bundleOf(files: unknown, origin: ComponentBundle['origin'], now = Date.now()): ComponentBundle {
  const raw = object(origin, 'component origin'); keys(raw, ['repository', 'commit', 'path'], 'component origin');
  if ((raw.repository === undefined) !== (raw.commit === undefined)) throw new Error('Incomplete component origin');
  if (raw.repository !== undefined && (typeof raw.repository !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(raw.repository) || raw.repository.length > 160 || typeof raw.commit !== 'string' || !/^[a-f0-9]{40}$/.test(raw.commit))) throw new Error('Invalid component origin');
  origin = raw.repository === undefined ? { path: text(raw.path, 'bundle name', 120) } : { repository: raw.repository as string, commit: raw.commit as string, path: componentPath(raw.path) };
  integer(now, 'createdAt');
  if (!Array.isArray(files) || !files.length || files.length > 50) throw new Error('A bundle needs 1–50 text files');
  let bytes = 0; const paths = new Set<string>(), findings: ComponentBundle['findings'] = [];
  const safe: ComponentFile[] = files.map(value => {
    const f = object(value, 'component file'); keys(f, ['path', 'content', 'sha256'], 'component file');
    const path = componentPath(f.path), content = f.content;
    if (typeof content !== 'string' || content.includes('\0') || Buffer.byteLength(content) > 256 * 1024) throw new Error('Component file must be UTF-8 text, at most 256 KiB');
    if (paths.has(path.toLowerCase())) throw new Error('Duplicate component path'); paths.add(path.toLowerCase());
    bytes += Buffer.byteLength(content); if (bytes > 512 * 1024) throw new Error('Component bundle exceeds 512 KiB');
    const sha256 = hash(content); if (f.sha256 !== undefined && f.sha256 !== sha256) throw new Error('Component hash mismatch');
    if (/(?:^|\/)(?:\.env(?:\..*)?|id_rsa|credentials(?:\..*)?)$/i.test(path) || /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|sk-ant-[A-Za-z0-9_-]{20,})/.test(content)) findings.push({ severity: 'block', code: 'possible-secret', path });
    if (/(?:hooks?|settings|mcp|package)\.json$|\.(?:sh|ps1|cmd|bat|exe|js|mjs|py)$/i.test(path)) findings.push({ severity: 'review', code: 'executable-or-configuration-is-inert', path });
    if (/https?:\/\/|\b(?:npm|npx|pip|curl|wget)\b/.test(content)) findings.push({ severity: 'review', code: 'external-dependencies-require-review', path });
    return { path, content, sha256 };
  }).sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const license = safe.some(f => /(?:^|\/)(?:LICENSE|COPYING)(?:\.[^/]*)?$/i.test(f.path)) ? 'included' : 'unknown';
  if (license === 'unknown') findings.push({ severity: 'review', code: 'license-not-included' });
  const digest = hash(JSON.stringify({ schema: 1, origin, files: safe.map(({ path, sha256 }) => ({ path, sha256 })) }));
  return { schema: 1, digest, origin, files: safe, findings, license, createdAt: now };
}
export function bundleDiff(before: ComponentBundle, after: ComponentBundle): ComponentDiff {
  const old = new Map(before.files.map(f => [f.path, f.sha256])), next = new Map(after.files.map(f => [f.path, f.sha256]));
  return { added: [...next.keys()].filter(p => !old.has(p)), removed: [...old.keys()].filter(p => !next.has(p)),
    changed: [...next.keys()].filter(p => old.has(p) && old.get(p) !== next.get(p)), unchanged: [...next.keys()].filter(p => old.get(p) === next.get(p)).length };
}
