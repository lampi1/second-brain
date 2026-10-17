// Real offline Git/attestation CLI integration; split independent scenarios so process startup costs do not accumulate.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { proposalReviews, REVIEW_DIMENSIONS } from '../../src/main/improve/reviews';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-review-record-')); roots.push(root);
  const repo = path.join(root, 'product'); fs.mkdirSync(repo);
  const report = path.join(root, 'review.txt'); fs.writeFileSync(report, 'Independent fixture review: no blockers.');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, windowsHide: true, timeout: 10000, encoding: 'utf8' }).trim();
  const script = path.resolve('scripts/record-proposal-review.mjs');
  const record = (head: string, dimension: string, verdict = 'passed') => spawnSync(process.execPath, [script, '--head', head, '--dimension', dimension, '--reviewer', 'fixture-reviewer', '--report', report, '--verdict', verdict], { cwd: repo, windowsHide: true, timeout: 15000, encoding: 'utf8' });
  git('init', '-b', 'main'); fs.writeFileSync(path.join(repo, 'README.md'), 'Public product fixture'); git('add', 'README.md');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'Fixture');
  const head = git('rev-parse', 'HEAD'), file = path.join(repo, '.git', 'sb-proposal-reviews.json');
  const seedPassed = () => {
    const attestation = { verdict: 'passed', reviewer: 'fixture-reviewer', at: new Date().toISOString(), reportSha256: createHash('sha256').update(fs.readFileSync(report)).digest('hex') };
    fs.writeFileSync(file, JSON.stringify({ version: 1, reviews: { [head]: Object.fromEntries(REVIEW_DIMENSIONS.map(dimension => [dimension, attestation])) } }));
    expect(proposalReviews(JSON.parse(fs.readFileSync(file, 'utf8')), head)).toBe(true);
  };
  return { repo, git, record, head, file, seedPassed };
}

// Starts3 real Node recorders, each with5 Git subprocesses, plus fixture setup. The30s integration budget
// covers OS process contention, not a sleep or a relaxed application assertion.
it('records all review dimensions outside product history', () => {
  const f = fixture();
  for (const dimension of REVIEW_DIMENSIONS) expect(f.record(f.head, dimension).status).toBe(0);
  expect(proposalReviews(JSON.parse(fs.readFileSync(f.file, 'utf8')), f.head)).toBe(true);
  expect(f.git('status', '--porcelain')).toBe('');
}, 30000);

it('invalidates a previously passed exact-head ledger when a review fails', () => {
  const f = fixture(); f.seedPassed();
  expect(f.record(f.head, 'security', 'failed').status).toBe(0);
  expect(proposalReviews(JSON.parse(fs.readFileSync(f.file, 'utf8')), f.head)).toBe(false);
}, 30000);

it('refuses a stale commit without altering existing attestations', () => {
  const f = fixture(); f.seedPassed(); const before = fs.readFileSync(f.file, 'utf8');
  expect(f.record('a'.repeat(40), 'security').status).toBe(1);
  expect(fs.readFileSync(f.file, 'utf8')).toBe(before);
}, 30000);

it('refuses dirty work without altering existing attestations', () => {
  const f = fixture(); f.seedPassed(); const before = fs.readFileSync(f.file, 'utf8');
  fs.writeFileSync(path.join(f.repo, 'README.md'), 'Uncommitted');
  expect(f.record(f.head, 'security').status).toBe(1);
  expect(fs.readFileSync(f.file, 'utf8')).toBe(before);
}, 30000);
