// Safe routine evidence rendering and image reads. No agent-supplied HTML, remote image URL or arbitrary local path.
// Used by the host DevOps writer; strings are escaped before a tiny Markdown link/image syntax is recognized (Markdown code stays verbatim).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export interface UploadedImage { id: string; url: string; sha256: string; name: string }
export const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// only what could build a link, an image, HTML or a code span is escaped: bold, lists, headings and tables stay Markdown;
// the GFM autolink triggers (scheme://, www., @) too, so a bare URL or e-mail never becomes a link nor swallows a backtick
const escapeMd = (s: string): string => s.replace(/([\\[\]()!`@])/g, '\\$1').replace(/(https?|ftp):\/\//gi, '$1\\://').replace(/(www)\./gi, '$1\\.')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FENCE_INFO = /^[\w#+.-]*$/;
const TABLE_RULE = /^[ \t|:-]*-[ \t|:-]*$/;
interface Segment { raw: boolean; text: string }
/** Splits Markdown into code kept verbatim (fenced blocks opened at column 0, code spans within one line) and plain
 * text. Safety rests on one invariant: every backtick (and fence-like tilde run) left in plain text is escaped, so a
 * renderer can only see the fences and spans chosen here, never pair them differently around plain text. Anything
 * ambiguous stays plain: a fence right after a possible table row (some renderers keep it in the table), a span
 * holding `|` (table cells split on it, even inside code), a span glued to a word with `:./@` (a renderer's linkifier
 * may take its opening backticks into a bare link, whatever autolink syntax it knows). Indented code blocks are not recognized (escapes show).
 * A line only some renderers close a fence on leaves the code and turns fences off for the rest: their backticks are
 * then escaped as plain text, so a renderer still in its fence stays in it to the end and one that left it sees only
 * escaped text. Expects \n line endings only (renderDevOpsComment normalizes them). */
function splitMarkdownCode(source: string): Segment[] {
  const out: Segment[] = [];
  const push = (raw: boolean, text: string) => {
    if (!text) return;
    const last = out.at(-1);
    if (last && last.raw === raw) last.text += text; else out.push({ raw, text });
  };
  let fence: { char: string; size: number; marker: string } | undefined, table = false, fences = true;
  for (const line of source.split(/(?<=\n)/)) {
    const body = line.replace(/\n$/, ''), end = line.slice(body.length);
    if (fence) {
      push(true, line);
      // CommonMark closes on the fence char at least size times, then spaces or tabs; marked 18 on the opener, any
      // mix of ` and ~, then spaces only. Any of them closing is enough to leave the code.
      const close = /^ {0,3}(`+|~+)([`~]*)([ \t]*)$/.exec(body);
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.size) {
        const commonMark = !close[2], marked = close[1]!.startsWith(fence.marker) && !close[3]!.includes('\t');
        if (!(commonMark && marked)) fences = false; // only some renderers close here: no fence is trusted after it
        fence = undefined;
      }
      continue;
    }
    const open = /^(`{3,}|~{3,})(.*)$/.exec(body);
    if (open && fences && !table && FENCE_INFO.test(open[2]!.trim())) { fence = { char: open[1]![0]!, size: open[1]!.length, marker: open[1]! }; push(true, line); continue; }
    table = body.trim() ? table || TABLE_RULE.test(body) : false;
    let rest = body;
    const tildes = /^( {0,3})(~{3,})/.exec(rest);
    if (tildes) { push(false, tildes[1]!); push(true, tildes[2]!.replace(/~/g, '\\~')); rest = rest.slice(tildes[0].length); }
    const runs = [...rest.matchAll(/`+/g)];
    let at = 0;
    for (let i = 0; i < runs.length; i++) {
      const size = runs[i]![0].length, j = runs.findIndex((r, k) => k > i && r[0].length === size);
      if (j < 0) continue;
      const from = runs[i]!.index!, to = runs[j]!.index! + size;
      // a span glued to a word that may be a bare link (scheme, domain, path, e-mail) stays plain: a linkifier may swallow its opening backticks
      if (!rest.slice(from + size, to - size).includes('|') && !/[:./@]\S*$/.test(rest.slice(0, from))) { push(false, rest.slice(at, from)); push(true, rest.slice(from, to)); at = to; }
      i = j;
    }
    push(false, rest.slice(at) + end);
  }
  return out;
}
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
  const out: string[] = [];
  // Markdown: every line ending a renderer may see (CRLF, a lone CR as in CommonMark, U+2028/2029/0085 in some) becomes
  // \n, so the lines split here are the renderer's lines
  const markdown = () => splitMarkdownCode(source.replace(/\r\n?|[\u2028\u2029\u0085]/g, '\n'));
  for (const segment of format === 'html' ? [{ raw: false, text: source }] : markdown()) {
    if (segment.raw) out.push(segment.text); else renderPlain(segment.text, organization, images, format, out);
  }
  return format === 'html' ? out.join('').replace(/\r?\n/g, '<br/>') : out.join('');
}
/** Plain text: escaped, except the approved links and this run's images. */
function renderPlain(source: string, organization: string, images: readonly UploadedImage[], format: 'html' | 'markdown', out: string[]): void {
  const escape = format === 'html' ? escapeHtml : escapeMd;
  const target = (url: string) => url.replace(/[()`]/g, c => encodeURIComponent(c));
  let at = 0;
  for (const match of source.matchAll(/(!?)\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})\)/g)) {
    out.push(escape(source.slice(at, match.index))); at = match.index! + match[0].length;
    const label = match[2]!, href = match[3]!;
    if (match[1]) {
      const image = images.find(i => `attachment:${i.id}` === href);
      if (!image) throw new Error('Images must reference an attachment uploaded by this run');
      const url = organizationUrl(image.url, organization);
      out.push(format === 'html' ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(label)}"/>` : `![${escapeMd(label)}](${target(url)})`);
    } else {
      const url = organizationUrl(href, organization);
      out.push(format === 'html' ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeHtml(label)}</a>` : `[${escapeMd(label)}](${target(url)})`);
    }
  }
  out.push(escape(source.slice(at)));
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
