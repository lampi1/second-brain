// The measurements behind ADR 0368 (main-process stalls, checkpoint, stop), bundled and run by
// scripts/bench-main-stalls.mjs: never part of the test suite (it times real work on a real SQLite file and real git).
// It seeds a coordination journal shaped like the owner's (66,689 auto-permitted permission rows, a few open requests
// and work threads) and times what the 60 s work-driver tick reads (Workflows.projection), the journal writes one
// auto-permitted permission used to cost, the clean-up batches, and the pre-turn git checkpoint on a clean and a
// dirty repository. Used by agents working on main-process speed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { CoordinationStore, proposalHash } from '../src/main/coordination/store';
import { Workflows } from '../src/main/workflows/service';
import * as checkpoints from '../src/main/chats/checkpoints';
import type { RequestKey } from '../src/main/coordination/model';
import { PRUNE_BATCH } from '../src/main/coordination/prune';

const ROWS = Number(process.env.BENCH_ROWS ?? 66_689);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const time = (fn: () => unknown, n: number): number => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) { const t = performance.now(); fn(); out.push(performance.now() - t); }
  return Math.round(median(out) * 100) / 100;
};
const timeAsync = async (fn: () => Promise<unknown>, n: number): Promise<number> => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) { const t = performance.now(); await fn(); out.push(performance.now() - t); }
  return Math.round(median(out) * 10) / 10;
};

function seed(file: string): void {
  new CoordinationStore(file).close();
  const db = new DatabaseSync(file);
  const now = Date.now(), day = 86_400_000;
  db.exec('begin');
  const req = db.prepare('insert into coordination_requests(id,job_id,chat_id,original_id,state,at,json) values(?,?,?,?,?,?,?)');
  const dec = db.prepare('insert into coordination_decisions(id,request_id,json) values(?,?,?)');
  const del = db.prepare('insert into coordination_deliveries(id,decision_id,json) values(?,?,?)');
  for (let i = 0; i < ROWS; i++) {
    const chatId = `chat-${i % 40}`, at = now - 3 * day + i * 1000;
    const key: RequestKey = { originalRequestId: `toolu_${i}`, jobId: `chat:${chatId}`, chatId, runId: `run-${i % 40}`, taskVersion: 1, proposalRevision: at, proposalHash: proposalHash({ i }) };
    const id = proposalHash(key);
    const payload = { id: key.originalRequestId, chatId, type: 'permission', tool: 'Bash', at, title: 'Bash' };
    req.run(id, key.jobId, chatId, key.originalRequestId, 'accepted', at, JSON.stringify({ key, kind: 'permission', at, payload, id, state: 'accepted' }));
    const decisionId = randomUUID();
    dec.run(decisionId, id, JSON.stringify({ id: decisionId, key, at, actor: { kind: 'policy', policy: 'auto-permit' }, answer: { kind: 'permission', allow: true } }));
    const deliveryId = randomUUID();
    del.run(deliveryId, decisionId, JSON.stringify({ id: deliveryId, decisionId, at, state: 'delivered' }));
  }
  db.exec('commit');
  db.close();
  const store = new CoordinationStore(file);
  for (let i = 0; i < 5; i++) {
    store.register({ key: { originalRequestId: `open-${i}`, jobId: `chat:open-${i}`, chatId: `open-${i}`, runId: null, taskVersion: 1, proposalRevision: i, proposalHash: proposalHash({ open: i }) }, kind: 'question', at: now - i, payload: { title: `Open ${i}` } });
  }
  store.close();
}

function gitRepo(dir: string, dirty: boolean): string {
  fs.mkdirSync(dir, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 'b', GIT_AUTHOR_EMAIL: 'b@localhost', GIT_COMMITTER_NAME: 'b', GIT_COMMITTER_EMAIL: 'b@localhost' } });
  git('init', '-q');
  for (let i = 0; i < 2000; i++) { const sub = path.join(dir, `d${i % 50}`); fs.mkdirSync(sub, { recursive: true }); fs.writeFileSync(path.join(sub, `f${i}.txt`), `line ${i}\n`.repeat(20)); }
  git('add', '-A'); git('commit', '-q', '-m', 'init');
  if (dirty) fs.writeFileSync(path.join(dir, 'd0', 'f0.txt'), 'changed\n');
  return dir;
}

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-bench-stalls-'));
  try {
    const file = path.join(dir, 'app.db');
    let t = performance.now();
    seed(file);
    console.log(`seeded ${ROWS} auto-permit rows in ${Math.round(performance.now() - t)} ms`);
    const store = new CoordinationStore(file);
    const wf = new Workflows(path.join(dir, 'work.json'), () => {}, Date.now, undefined, { store, chats: () => [], pending: () => [] });
    t = performance.now(); const firstRows = store.projectionRequests().length;
    console.log(`projectionRequests() first call: ${firstRows} rows in ${Math.round((performance.now() - t) * 100) / 100} ms`);
    console.log(`projectionRequests() median ms (x5, repeated reads): ${time(() => store.projectionRequests(), 5)}`);
    console.log(`Workflows.projection() median ms (x5, the work-driver tick): ${time(() => wf.projection(), 5)}`);
    // one auto-permitted permission's journal writes as manager-requests.ts made them (register, resolve, begin, finish)
    let n = 0;
    console.log(`journal writes per auto-permitted permission, median ms (x200): ${time(() => {
      const key: RequestKey = { originalRequestId: `bench-${n++}`, jobId: 'chat:bench', chatId: 'bench', runId: null, taskVersion: 1, proposalRevision: n, proposalHash: proposalHash({ n }) };
      store.register({ key, kind: 'permission', at: Date.now(), payload: { title: 'Bash' } });
      const d = store.resolve(key, { kind: 'policy', policy: 'auto-permit' }, { kind: 'permission', allow: true });
      store.finishDelivery(store.beginDelivery(d.id).id, 'delivered');
    }, 200)}`);
    const prune = (store as unknown as { pruneAutoPermits?: (before: number, batch: number) => number }).pruneAutoPermits;
    if (prune) {
      const cutoff = Date.now() - 86_400_000, batches: number[] = [];
      let total = 0;
      for (;;) { t = performance.now(); const k = prune.call(store, cutoff, PRUNE_BATCH); batches.push(performance.now() - t); total += k; if (k < PRUNE_BATCH) break; }
      console.log(`clean-up: ${total} rows in ${batches.length} batches, median batch ms ${Math.round(median(batches) * 100) / 100}, worst ${Math.round(Math.max(...batches) * 100) / 100}`);
      console.log(`after clean-up: Workflows.projection() median ms (x5): ${time(() => wf.projection(), 5)}`);
    }
    store.close();

    for (const dirty of [false, true]) {
      const repo = gitRepo(path.join(dir, dirty ? 'dirty' : 'clean'), dirty);
      let i = 0;
      const full = await timeAsync(() => checkpoints.snapshot(repo, `refs/sb/checkpoints/bench/${i++}`), 7);
      const quick = (checkpoints as unknown as { turnCheckpoint?: (cwd: string, ref: string, root?: string) => Promise<unknown> }).turnCheckpoint;
      const fast = quick ? await timeAsync(() => quick(repo, `refs/sb/checkpoints/bench/q${i++}`, repo), 7) : null;
      console.log(`checkpoint ${dirty ? 'dirty' : 'clean'} repo (2000 files): snapshot() median ${full} ms${fast !== null ? `, turnCheckpoint() median ${fast} ms` : ''}`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
void main();
