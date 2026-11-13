// cli-fixtures: turns the CLI message shapes the dev instance recorded (src/main/chats/drift.ts record, sanitized: no
// prompt, answer, path or id) into the contract fixtures test/fixtures/cli/<cli>/<version>.jsonl, one {key, msg} per
// line, merged with what is already there. test/unit/chats/cli-contract.test.ts replays them through the real parsers
// with no token spent; a version that has a file counts as "tested" for `npm run doctor` (ADR 0055).
//   node scripts/cli-fixtures.mjs                 from %APPDATA%/second-brain-dev/cli-records
//   node scripts/cli-fixtures.mjs --from <dir>    another records folder (the live smoke's temp folder)
// Also imported by test/live/claude.live.test.ts (importRecords).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = path.join(root, 'test', 'fixtures', 'cli');
const safe = s => String(s).replace(/[^\w.-]/g, '_');

/** Records folder → fixtures folder. Returns [{ cli, version, added, total }] per file written. Versions the CLI did
 *  not name ("?") are left out: they cannot be told apart later. */
export function importRecords(from, to = FIXTURES) {
  const out = [];
  if (!fs.existsSync(from)) return out;
  for (const f of fs.readdirSync(from).filter(n => n.endsWith('.jsonl'))) {
    const cli = f.slice(0, -'.jsonl'.length);
    const byVersion = new Map();
    for (const l of fs.readFileSync(path.join(from, f), 'utf8').split('\n')) {
      if (!l.trim()) continue;
      let r; try { r = JSON.parse(l); } catch { continue; }
      if (!r.version || r.version === '?' || !r.key) continue;
      const list = byVersion.get(r.version) ?? [];
      list.push(JSON.stringify({ key: r.key, msg: r.msg }));
      byVersion.set(r.version, list);
    }
    for (const [version, lines] of byVersion) {
      const file = path.join(to, safe(cli), `${safe(version)}.jsonl`);
      const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
      const all = [...new Set([...old, ...lines])].sort((a, b) => JSON.parse(a).key.localeCompare(JSON.parse(b).key));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${all.join('\n')}\n`);
      out.push({ cli, version, added: all.length - old.length, total: all.length });
    }
  }
  return out;
}

/** The versions with a fixture file, by CLI: what doctor calls "tested". */
export function testedVersions(dir = FIXTURES) {
  const res = {};
  if (!fs.existsSync(dir)) return res;
  for (const cli of fs.readdirSync(dir)) res[cli] = fs.readdirSync(path.join(dir, cli)).filter(f => f.endsWith('.jsonl')).map(f => f.slice(0, -'.jsonl'.length));
  return res;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--from');
  const from = i > 0 ? process.argv[i + 1] : path.join(process.env.APPDATA ?? path.join(os.homedir(), '.config'), 'second-brain-dev', 'cli-records');
  const done = importRecords(from);
  if (!done.length) console.log(`no records in ${from}: use real chats in the dev instance (npm run dev) first`);
  for (const d of done) console.log(`${d.cli} ${d.version}: ${d.added} new shapes, ${d.total} in test/fixtures/cli/${safe(d.cli)}/${safe(d.version)}.jsonl`);
  if (done.length) console.log('next: npx vitest run test/unit/chats/cli-contract.test.ts, then commit the fixtures');
}
