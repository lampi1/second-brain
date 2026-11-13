// Records a fresh reviewer's explicit verdict for the current exact commit, outside the product worktree.
// Invoke only after reading the independent report; report bytes are hashed, never copied into product history.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const value = flag => args[args.indexOf(flag) + 1];
const head = value('--head'), dimension = value('--dimension'), reviewer = value('--reviewer'), report = value('--report'), verdict = value('--verdict');
const git = (...params) => execFileSync('git', ['--no-replace-objects', '-c', 'core.fsmonitor=false', ...params], { encoding: 'utf8', windowsHide: true }).trim();
try {
  if (!['--head', '--dimension', '--reviewer', '--report', '--verdict'].every(flag => args.includes(flag)) || !/^[0-9a-f]{40,64}$/.test(head) || !['correctness', 'security', 'usability'].includes(dimension) || !reviewer?.trim() || reviewer.length > 120 || !['passed', 'failed'].includes(verdict)) throw new Error('usage');
  if (git('rev-parse', 'HEAD') !== head || git('status', '--porcelain', '--untracked-files=all')) throw new Error('dirty');
  const bytes = fs.readFileSync(report);
  if (!bytes.length || bytes.length > 1000000) throw new Error('report');
  const common = git('rev-parse', '--path-format=absolute', '--git-common-dir');
  const file = path.join(common, 'sb-proposal-reviews.json'), lock = `${file}.lock`;
  const fd = fs.openSync(lock, 'wx', 0o600);
  let temp;
  try {
    const ledger = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, reviews: {} };
    if (ledger.version !== 1 || !ledger.reviews || typeof ledger.reviews !== 'object' || Array.isArray(ledger.reviews)) throw new Error('ledger');
    ledger.reviews[head] ??= {};
    ledger.reviews[head][dimension] = { verdict, reviewer, at: new Date().toISOString(), reportSha256: createHash('sha256').update(bytes).digest('hex') };
    temp = `${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(ledger), { flag: 'wx', mode: 0o600 });
    if (git('rev-parse', 'HEAD') !== head || git('status', '--porcelain', '--untracked-files=all')) throw new Error('changed');
    fs.renameSync(temp, file);
    console.log(`Recorded ${dimension}: ${verdict} for ${head}`);
  } finally {
    if (temp && fs.existsSync(temp)) fs.unlinkSync(temp);
    fs.closeSync(fd); fs.unlinkSync(lock);
  }
} catch {
  console.error('Review not recorded. Supply --head <full current SHA> --dimension correctness|security|usability --reviewer <independent reviewer> --report <report file> --verdict passed|failed in a clean worktree. Existing ledger must be valid and unlocked.');
  process.exitCode = 1;
}
