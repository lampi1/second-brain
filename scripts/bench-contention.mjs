// CPU-contention bench for the 2026-10-27 freezes: a stand-in for the app's main process (the stall watch's 100 ms
// tick, plus one parse + serialize of a chats.json-sized store a second, the work a busy app does) next to N CPU-bound
// child processes, the agents' load (engines, MCP servers, builds, taskkill storms). Run once with the children at
// normal priority (the app before) and once lowered the way jobguard.ts lowerEnginePriority lowers engines (after);
// prints stalls a minute (ticks late by >= 200 ms, perf.ts STALL_MS), worst and p99 lateness. Who: agents checking the
// engine-priority fix. A load test: run it only outside the owner's working hours on their PC (AGENTS.md rule 7).
//   node scripts/bench-contention.mjs [--secs 20] [--hogs <n, default 2 x cores>] [--store <chats.json>]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const SECS = Number(arg('--secs', 20)), HOGS = Number(arg('--hogs', os.availableParallelism() * 2));
const store = arg('--store') ? fs.readFileSync(arg('--store'), 'utf8') : JSON.stringify({ version: 2, chats: Array.from({ length: 75 }, (_, i) => ({ id: `c_${i}`, title: 'x'.repeat(200), items: 'y'.repeat(18_000) })) });
const BELOW = os.constants.priority.PRIORITY_BELOW_NORMAL;

async function run(lowered) {
  const hogs = Array.from({ length: HOGS }, () => spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore', windowsHide: true }));
  if (lowered) for (const h of hogs) os.setPriority(h.pid, BELOW);
  await new Promise(r => setTimeout(r, 500));
  const late = [];
  let last = performance.now();
  const tick = setInterval(() => { const t = performance.now(); late.push(t - last - 100); last = t; }, 100);
  const work = setInterval(() => { JSON.stringify(JSON.parse(store)); }, 1000);
  await new Promise(r => setTimeout(r, SECS * 1000));
  clearInterval(tick); clearInterval(work);
  for (const h of hogs) h.kill();
  const s = [...late].sort((a, b) => a - b);
  const stalls = late.filter(l => l >= 200).length;
  return { hogs: HOGS, lowered, stallsPerMin: Math.round(stalls / SECS * 60 * 10) / 10, p99: Math.round(s[Math.floor(s.length * 0.99)]), worst: Math.round(s.at(-1)), lateTotalMs: Math.round(late.filter(l => l > 0).reduce((a, b) => a + b, 0)) };
}

console.log(JSON.stringify({ storeMB: +(store.length / 1e6).toFixed(2), cores: os.availableParallelism(), platform: process.platform }));
console.log('before (agents at normal priority):', JSON.stringify(await run(false)));
console.log('after  (agents below normal):      ', JSON.stringify(await run(true)));
