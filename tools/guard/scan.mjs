#!/usr/bin/env node
// guard/scan: blocks a publish when a tree or a git history carries secrets, personal or company data.
// Why: the second-brain product is exported from a personal brain; one leaked name, path or key is enough to make the
// repo unsafe to share. Fail-closed: anything suspicious blocks, false positives are silenced only by an explicit
// allow file (`.guardallow`), never by weakening a rule. No dependencies, no downloads: every rule is written here.
// Used by: the exporter before every commit/push (product-sync), and by hand before any push of the product.
//
// Usage:
//   node scan.mjs <dir>                         scan the working tree (files tracked or not, minus .git)
//   node scan.mjs <dir> --history               also every blob, commit message and author of every commit
//   options: --deny <file>    words/regexes that must never appear (one per line, `#` comment, `re:` prefix = regex)
//            --allow <file>   default <dir>/.guardallow: lines `<path glob> <rule> [sha256:<hex>]` that silence a known false
//                             positive (with a hash: only that exact file content)
//            --json           machine output
// Exit: 0 clean · 2 findings (publish must stop) · 1 error. The matched value is never printed, only file:line + rule.

import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const argv = process.argv.slice(2);
const flag = n => argv.includes(n);
const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const values = new Set(['--deny', '--allow', '--commits', '--meta']);
const switches = new Set(['--history', '--json', '--no-skip']);
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (values.has(argv[i])) { if (!argv[++i] || argv[i].startsWith('--')) { console.error('guard: missing option argument'); process.exit(1); } }
  else if (argv[i].startsWith('--')) { if (!switches.has(argv[i])) { console.error('guard: unknown option'); process.exit(1); } }
  else positional.push(argv[i]);
}
const root = positional.length === 1 ? positional[0] : null;
if (!root || !existsSync(root)) { console.error('usage: node scan.mjs <dir> [--history] [--deny <file>] [--allow <file>] [--json]'); process.exit(1); }
if (flag('--history') && opt('--commits')) { console.error('guard: use either --history or --commits'); process.exit(1); }

function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '');
}

// ---- rules -------------------------------------------------------------------------------------------------------
// Secrets: shapes of real credentials. Placeholders like <token>, {{X}}, xxx, example are not secrets.
export const SECRET_RULES = [
  ['private-key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY/],
  ['aws-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['openai-key', /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/],
  ['google-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['azure-storage-key', /AccountKey=[A-Za-z0-9+/=]{40,}/i],
  ['azure-sas', /[?&]sig=[A-Za-z0-9%+/=]{30,}/],
  ['conn-string-password', /\b(?:Password|Pwd)\s*=\s*(?!\s*[<{$%]|\s*;|\s*\*+)[^;'"\s]{4,}/i],
  ['url-credentials', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]+:[^\s/@'"<{]{3,}@/i],
  ['assigned-secret', /\b(?:api[_-]?key|apikey|secret|client[_-]?secret|access[_-]?token|auth[_-]?token|password|passwd|pat)\b["']?\s*[:=]\s*["'](?![<{$]|x{3,}|\*{3,}|example|changeme|your[_-]|test|dummy|fake|placeholder)[^"'\s]{12,}["']/i],
  ['pat-azure-devops', /\b[a-z2-7]{52}\b/],
];

// Personal / company data that is never product, whatever the deny list says.
export const DATA_RULES = [
  ['user-path', /\b[A-Za-z]:(?:\\\\|\\|\/)+Users(?:\\\\|\\|\/)+(?!Public\b|Default\b|<|\{\{|%|\$|\*|you\b|USERNAME\b|name\b|me\b)[A-Za-z0-9._~-]{2,}/i],
  ['short-user-name', /\b[A-Z0-9]{2,6}~\d\.[A-Z0-9]{1,3}\b/],   // Windows 8.3 short name of a user folder
  ['home-path', /(?:^|[^\w.])\/(?:[a-z]\/)?(?:home|Users)\/(?!runner\/|user\/|you\/|me\/|name\/|<|\{\{|\$)[a-z0-9._~-]{2,}\//i],
  ['email', /\b[A-Za-z0-9._%+-]+@(?!(?:users\.noreply\.github\.com|example\.(?:com|org|net)|localhost)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
  ['guid', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ['ipv4-private', /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/],
  ['internal-host', /\b[a-z0-9-]+\.(?:database\.windows\.net|vault\.azure\.net|azurewebsites\.net|scm\.azurewebsites\.net|visualstudio\.com|blob\.core\.windows\.net|servicebus\.windows\.net)\b|\bdev\.azure\.com\/(?!\{\{)[A-Za-z0-9-]{3,}/i],
];
// GUIDs that are public constants (not data) or obviously synthetic (test fixtures: few distinct hex digits).
const PUBLIC_GUIDS = new Set(['499b84ac-1321-427f-aa17-267ca6975798']); // Azure DevOps resource id, documented by Microsoft
const realGuid = line => [...line.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi)]
  .some(([g]) => !PUBLIC_GUIDS.has(g.toLowerCase()) && new Set(g.toLowerCase().replace(/-/g, '')).size > 9);

// Files that are never product, by name or path.
const FORBIDDEN_FILES = [
  [/(^|\/)\.env(\.|$)(?!example$)/, 'env-file'], [/\.(pem|pfx|p12|key|keystore|jks|kdbx)$/i, 'key-file'],
  [/(^|\/)id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/, 'ssh-key'], [/credentials/i, 'credentials-file'],
  [/(^|\/)(ai-errors|ai-wins|ai-reflections|now|ideas|people|bug-log|measures)\.(md|jsonl)$/, 'personal-memory-file'],
  [/(^|\/)journal\/(?!index\.md$|README\.md$)[^/]+/, 'journal-entry'], [/\.(sqlite|db|mdb|bak|bacpac)$/i, 'database-file'],
  [/\.(png|jpe?g|gif|webp|bmp|mp4|mov|pdf|docx?|xlsx?|pptx?)$/i, 'binary-media'],
];
// personal-memory-file: the template ships those names EMPTY; the exporter allows them only when they hold no entry
// (a header and placeholders): `templateOnly` below reads them and fails if a dated entry is present.
const TEMPLATE_ENTRY = /^(?:- \*\*[^*\n]+\*\* · |- \*\*P-\d+|- \d{4}-\d{2}-\d{2}|- \d{2}:\d{2} · |\d{4}-\d{2}-\d{2} \d{2}:\d{2}|## \d{4}-\d{2}-\d{2}|### B-\d+|\{")/m;

// ---- inputs ------------------------------------------------------------------------------------------------------
const denyRules = [];
if (opt('--deny')) {
  for (const raw of decodeText(readFileSync(opt('--deny'))).split(/\r?\n/)) {
    // `re:` regex (any case) · `cs:` regex (exact case) · `w:` whole word · a plain word of 5+ chars matches anywhere,
    // even inside identifiers (fromMario) and after escapes (\nMario); shorter plain words match whole words only.
    const l = raw.trim(); if (!l || l.startsWith('#')) continue;
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const word = s => `(?<![A-Za-z0-9])${esc(s)}(?![A-Za-z0-9])`;
    const [src, flags] = l.startsWith('re:') ? [l.slice(3), 'i'] : l.startsWith('cs:') ? [l.slice(3), ''] :
      l.startsWith('w:') ? [word(l.slice(2)), 'i'] : [l.length >= 5 ? esc(l) : word(l), 'i'];
    try { denyRules.push(['deny-list', new RegExp(src, flags)]); } catch { console.error('guard: bad deny regular expression'); process.exit(1); }
  }
  if (!denyRules.length) { console.error('guard: the configured deny list has no entries'); process.exit(1); }
}
const allowFile = opt('--allow') ?? join(root, '.guardallow');
const allows = existsSync(allowFile) ? decodeText(readFileSync(allowFile)).split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  .map(l => { const [glob, rule, pin, extra] = l.split(/\s+/);
    // a malformed pin must never fall back to "any content": refuse the whole allow file
    if (!rule || extra || (pin !== undefined && !/^sha256:[0-9a-fA-F]{64}$/.test(pin))) { console.error('guard: bad allow line'); process.exit(1); }
    return { re: new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$'), rule, sha: pin?.startsWith('sha256:') ? pin.slice(7).toLowerCase() : null }; }) : [];
// An entry with `sha256:<hex>` (e.g. a binary icon a human looked at) holds only for that exact content: a changed
// file blocks again until someone checks it and ADDS a line with the new hash (old lines stay: the public history
// keeps the old blobs, and --history checks them).
const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const allowed = (path, rule, buf) => allows.some(a => a.re.test(path) && (a.rule === '*' || a.rule === rule) && (!a.sha || (buf && sha256(buf) === a.sha)));

const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', 'dist', 'test-results']);
const TEXT_MAX = 2_000_000;
const isBinary = buf => buf.subarray(0, 8000).includes(0);

// ---- scanning ----------------------------------------------------------------------------------------------------
const findings = [];
const allRules = [...SECRET_RULES, ...DATA_RULES, ...denyRules];
const masked = text => allRules.reduce((value, [, re]) => value.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), '***'), text);
const add = (path, label, line, rule, buf, canAllow = true) => { if (!canAllow || !allowed(path, rule, buf)) findings.push({ where: masked(label), line, rule }); };

function scanName(path, label) {
  for (const [name, re] of allRules) if (re.test(path) && (name !== 'guid' || realGuid(path))) add(path, `${label} (path)`, 0, name, undefined, false);
}

// buf: the file's bytes, so a hash-pinned allow line can hold for a line finding too (only for that exact content);
// commit messages pass none, so no pinned line ever silences them
function scanText(path, text, label = path, buf, canAllow = true) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]; if (l.length > 5000) { add(path, label, i + 1, 'long-line-unscanned', buf, canAllow); continue; }
    for (const [name, re] of allRules) if (re.test(l) && (name !== 'guid' || realGuid(l))) add(path, label, i + 1, name, buf, canAllow);
  }
}

function scanFile(path, buf, label = path) {
  scanName(path, label);
  for (const [re, rule] of FORBIDDEN_FILES) {
    if (!re.test(path)) continue;
    if (rule === 'personal-memory-file' || rule === 'journal-entry') {
      if (!isBinary(buf) && !TEMPLATE_ENTRY.test(buf.toString('utf8').split(/\r?\n/).filter(l => !l.startsWith('#') && !l.startsWith('>')).join('\n'))) continue;
    }
    add(path, label, 0, rule, buf);
  }
  // never fail-open: UTF-16 (PowerShell's default) is decoded; anything else unreadable is a finding
  let text;
  if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.subarray(2).toString('utf16le');
  else if (buf[0] === 0xfe && buf[1] === 0xff) text = Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  else if (isBinary(buf)) { if (!FORBIDDEN_FILES.some(([re, r]) => r === 'binary-media' && re.test(path))) add(path, label, 0, 'unscanned-binary', buf); return; }
  else text = buf.toString('utf8');
  if (text.length > TEXT_MAX) { add(path, label, 0, 'too-large-unscanned', buf); return; }
  scanText(path, text, label, buf);
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isDirectory()) { if (name !== '.git' && (flag('--no-skip') || !SKIP_DIRS.has(name))) walk(p); continue; }
    const rel = relative(root, p).split(sep).join('/');
    if (rel === '.guardallow') continue;
    if (st.isSymbolicLink()) { scanName(rel, rel); add(rel, rel, 0, 'unscanned-link'); continue; }
    scanFile(rel, readFileSync(p));
  }
}

// One git process per commit tree and ONE for all blobs (`cat-file --batch`): a process per blob took minutes and a
// single failed spawn among thousands crashed the release sync with no message (2026-10-14). Same blobs, same labels.
function scanHistory(selected) {
  const git = (args, input) => execFileSync('git', ['-C', root, ...args], { maxBuffer: 1 << 30, ...(input ? { input } : {}), stdio: ['pipe', 'pipe', 'pipe'] });
  const commits = selected ?? git(['rev-list', '--all']).toString().split('\n').filter(Boolean);
  if (!commits.every(c => /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(c))) throw new Error('invalid commit list');
  const seen = new Map(); // one blob read, every distinct path scanned (path rules apply to every alias)
  for (const c of commits) {
    const meta = git(['show', '-s', '--format=%an%x00%ae%x00%cn%x00%ce%x00%B', c]).toString();
    scanText(`commit:${c.slice(0, 8)}`, meta.replace(/\x00/g, '\n'), `commit ${c.slice(0, 8)} (message/author)`, undefined, false);
    for (const row of git(['ls-tree', '-r', '-z', c]).toString('utf8').split('\0').filter(Boolean)) {
      const tab = row.indexOf('\t');
      const [, type, sha] = row.slice(0, tab).split(' '); const path = row.slice(tab + 1);
      if (type !== 'blob') continue;
      const aliases = seen.get(sha) ?? new Map();
      if (!aliases.has(path)) aliases.set(path, `${path}@${c.slice(0, 8)}`);
      seen.set(sha, aliases);
    }
  }
  if (!seen.size) return;
  // output: "<sha> blob <size>\n<bytes>\n" per input line, in input order
  const out = git(['cat-file', '--batch'], [...seen.keys()].join('\n') + '\n');
  let at = 0;
  for (const [sha, aliases] of seen) {
    const nl = out.indexOf(0x0a, at);
    const [got, type, size] = out.subarray(at, nl).toString().split(' ');
    if (got !== sha || type !== 'blob') throw new Error(`cat-file --batch: expected blob ${sha}, got "${out.subarray(at, nl)}"`);
    const start = nl + 1, end = start + Number(size);
    for (const [path, label] of aliases) scanFile(path, out.subarray(start, end), label);
    at = end + 1;
  }
}

// a failure is an error (exit 1, fail-closed) that says what failed, never a bare Node stack
try {
  if (!opt('--commits')) walk(root);
  if (flag('--history') || opt('--commits')) scanHistory(opt('--commits') ? decodeText(readFileSync(opt('--commits'))).split(/\r?\n/).filter(Boolean) : undefined);
  if (opt('--meta')) {
    const meta = JSON.parse(decodeText(readFileSync(opt('--meta'))));
    if (!Array.isArray(meta)) throw new Error('invalid metadata');
    for (const [i, item] of meta.entries()) {
      if (!item || typeof item.label !== 'string' || typeof item.text !== 'string') throw new Error('invalid metadata item');
      const label = /^(?:pushed ref \d+ of \d+, (?:local|remote) name|tag object [0-9a-f]{8} \(tagger\/message\))$/.test(item.label) ? item.label : `metadata ${i + 1}`;
      scanText('', item.text, label, undefined, false);
    }
  }
} catch { console.error('guard: scan failed; check the inputs and Git object availability'); process.exit(1); }

const uniq = [...new Map(findings.map(f => [`${f.where}:${f.line}:${f.rule}`, f])).values()];
if (flag('--json')) console.log(JSON.stringify({ ok: uniq.length === 0, findings: uniq }, null, 1));
else if (!uniq.length) console.log(`guard: clean (${root}${flag('--history') ? ', history included' : ''})`);
else {
  const byRule = uniq.reduce((m, f) => (m[f.rule] = (m[f.rule] || 0) + 1, m), {});
  for (const f of uniq.slice(0, 200)) console.log(`${f.where}${f.line ? ':' + f.line : ''}  ${f.rule}`);
  if (uniq.length > 200) console.log(`... ${uniq.length - 200} more`);
  console.log(`guard: BLOCKED, ${uniq.length} findings (${Object.entries(byRule).map(([r, n]) => `${r} ${n}`).join(', ')})`);
}
process.exit(uniq.length ? 2 : 0);
