// Safe routine evidence rendering and image reads. No agent-supplied HTML, remote image URL or arbitrary local path.
// Used by the host DevOps writer; strings are escaped before a tiny Markdown link/image syntax is recognized.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export interface UploadedImage { id: string; url: string; sha256: string; name: string }
export const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const escapeMd = (s: string): string => s.replace(/([\\`*_{}[\]()!#|>])/g, '\\$1').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function organizationUrl(raw: string, organization: string): string {
  if (/[\s\\\x00-\x1f]/.test(raw)) throw new Error('Only HTTPS links to the approved DevOps organization are allowed');
  let url: URL; try { url = new URL(raw); } catch { throw new Error('Invalid DevOps link'); }
  const org = organization.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
    !((url.hostname === 'dev.azure.com' && url.pathname.split('/')[1]?.toLowerCase() === org) || url.hostname === `${org}.visualstudio.com`)) throw new Error('Link is outside the approved DevOps organization');
  return url.href;
}
/** HTML for work items, Markdown for PR threads. All other syntax remains literal escaped text. */
export function renderDevOpsComment(source: string, organization: string, images: readonly UploadedImage[], format: 'html' | 'markdown' = 'html'): string {
  if (!source.trim() || source.length > 10_000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(source)) throw new Error('Invalid comment text');
  const escape = format === 'html' ? escapeHtml : escapeMd;
  const out: string[] = []; let at = 0;
  for (const match of source.matchAll(/(!?)\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})\)/g)) {
    out.push(escape(source.slice(at, match.index))); at = match.index! + match[0].length;
    const label = match[2]!, target = match[3]!;
    if (match[1]) {
      const image = images.find(i => `attachment:${i.id}` === target);
      if (!image) throw new Error('Images must reference an attachment uploaded by this run');
      const url = organizationUrl(image.url, organization);
      out.push(format === 'html' ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(label)}"/>` : `![${escapeMd(label)}](${url.replace(/[()]/g, c => encodeURIComponent(c))})`);
    } else {
      const url = organizationUrl(target, organization);
      out.push(format === 'html' ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeHtml(label)}</a>` : `[${escapeMd(label)}](${url.replace(/[()]/g, c => encodeURIComponent(c))})`);
    }
  }
  out.push(escape(source.slice(at)));
  return format === 'html' ? out.join('').replace(/\r?\n/g, '<br/>') : out.join('');
}
/** Flat, run-owned evidence only. Open once, refuse links/hardlinks, bound bytes and inspect actual image signatures. */
export function readEvidenceImage(root: string, name: string): { data: Buffer; sha256: string; name: string } {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(png|jpe?g)$/i.test(name) || name.includes('..')) throw new Error('Image must be a PNG/JPEG filename in this run evidence folder');
  const directory = fs.realpathSync(root);
  if (directory !== path.resolve(root) || fs.lstatSync(root).isSymbolicLink()) throw new Error('Evidence folder cannot contain links');
  const file = path.join(directory, name);
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Evidence image cannot be a link');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  let data: Buffer;
  try { const stat = fs.fstatSync(fd); if (!stat.isFile() || stat.nlink !== 1 || stat.size < 24 || stat.size > 8 * 1024 * 1024) throw new Error('Image must be a regular single-link file of at most 8 MiB'); data = fs.readFileSync(fd); }
  finally { fs.closeSync(fd); }
  if (data.length > 8 * 1024 * 1024) throw new Error('Image grew beyond the size limit');
  const png = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && data.toString('ascii', 12, 16) === 'IHDR' && data.subarray(-8, -4).toString('ascii') === 'IEND';
  const jpg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff && data.at(-2) === 0xff && data.at(-1) === 0xd9;
  if (/\.png$/i.test(name) ? !png : !jpg) throw new Error('Image contents do not match PNG/JPEG extension');
  if (png && (!data.readUInt32BE(16) || !data.readUInt32BE(20) || data.readUInt32BE(16) > 16_384 || data.readUInt32BE(20) > 16_384)) throw new Error('Image dimensions exceed limits');
  return { data, sha256: createHash('sha256').update(data).digest('hex'), name };
}
