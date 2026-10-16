#!/usr/bin/env node
// A stand-in for the publish guard's scan.mjs (the real one is private, in %LOCALAPPDATA%/second-brain/publish), with
// the same command line and output: `node fake-scan.mjs <dir> --deny <file> [--allow <file>] --json`; every line of every
// file is checked against the deny file's words (one per line, case-insensitive); a line holding a word of the allow
// file is not a finding (a stand-in for the real allow list's format); exit 0 clean, 2 findings, 1 error; only
// file:line + rule, never the value. Used by test/unit/brain/sync.test.ts and test/e2e/brain-sync.spec.ts (SB_PUBLISH_DIR).
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const root = argv.find((a, i) => !a.startsWith('--') && !['--deny', '--allow'].includes(argv[i - 1]));
if (!root || !fs.existsSync(root) || !opt('--deny')) { console.error('usage: fake-scan <dir> --deny <file> --json'); process.exit(1); }
const words = file => fs.readFileSync(file, 'utf8').split(/\r?\n/).map(l => l.trim().toLowerCase()).filter(l => l && !l.startsWith('#'));
const deny = words(opt('--deny'));
const allow = opt('--allow') ? words(opt('--allow')) : [];
const findings = [];
const walk = dir => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '.git') walk(p); continue; }
    fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((l, i) => {
      const low = l.toLowerCase();
      if (deny.some(w => low.includes(w)) && !allow.some(w => low.includes(w))) findings.push({ where: path.relative(root, p).split(path.sep).join('/'), line: i + 1, rule: 'deny-list' });
    });
  }
};
walk(root);
console.log(JSON.stringify({ ok: findings.length === 0, findings }));
process.exit(findings.length ? 2 : 0);
