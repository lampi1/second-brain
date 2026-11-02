#!/usr/bin/env node
// The functions that used the main thread in a .cpuprofile (src/main/perf-profile.ts saves one per freeze into
// <logs>/profiles): self time and total time per function, slowest first. Usage:
//   node scripts/profile-top.mjs <file.cpuprofile> [--top 40]
// With no file: the newest profile in the dev and stable app data folders' logs/profiles.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const topAt = args.indexOf('--top');
const top = topAt >= 0 ? Number(args[topAt + 1]) || 40 : 40;
let file = args.find((a, i) => !a.startsWith('--') && i !== topAt + 1);
if (!file) {
  const base = process.env.APPDATA ?? (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));
  const found = ['second-brain', 'second-brain-dev'].flatMap(n => { const d = path.join(base, n, 'logs', 'profiles'); try { return fs.readdirSync(d).filter(f => f.endsWith('.cpuprofile')).map(f => path.join(d, f)); } catch { return []; } });
  file = found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!file) { console.error('no .cpuprofile found: pass the file'); process.exit(1); }
}
const p = JSON.parse(fs.readFileSync(file, 'utf8'));
const byId = new Map(p.nodes.map(n => [n.id, n]));
const parent = new Map();
for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const dt = new Map();
p.samples.forEach((id, i) => dt.set(id, (dt.get(id) ?? 0) + (p.timeDeltas[i] ?? 0) / 1000));
const key = n => { const f = n.callFrame; const url = f.url ? f.url.replace(/^.*[\\/](out|node_modules)[\\/]/, '$1/') : ''; return `${f.functionName || '(anonymous)'} ${url}${url ? `:${f.lineNumber + 1}` : ''}`; };
const self = new Map(), total = new Map();
for (const [id, ms] of dt) {
  const n = byId.get(id);
  self.set(key(n), (self.get(key(n)) ?? 0) + ms);
  const seen = new Set();
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) { const k = key(byId.get(cur)); if (seen.has(k)) continue; seen.add(k); total.set(k, (total.get(k) ?? 0) + ms); }
}
const all = [...dt.values()].reduce((a, b) => a + b, 0);
const idle = [...dt].filter(([id]) => /^\((idle|program)\)$/.test(byId.get(id).callFrame.functionName)).reduce((a, [, ms]) => a + ms, 0);
console.log(`${file}\n${Math.round(all)} ms recorded, ${Math.round(all - idle)} ms busy\n`);
const show = (title, m) => { console.log(title); for (const [k, ms] of [...m].filter(([k]) => !/^\((root|idle|program)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`${String(Math.round(ms)).padStart(8)} ms  ${k}`); console.log(''); };
show('self time', self);
show('total time (with callees)', total);
