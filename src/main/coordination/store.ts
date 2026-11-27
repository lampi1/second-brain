// Incremental SQLite coordination journal. CAS commits precede delivery; restart exposes uncertainty, never replays effects.
// Electron-free so the runtime host can own this store. Host callers authenticate the actor before invoking resolve.
import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { migrate, openAppDb, reopenAppDb, tx } from '../app-db';
import type { WorkThread } from '../../shared/workflows';
import type { DecisionActor, DecisionReceipt, DeliveryReceipt, ExecutionEvidence, RequestKey, RequestRecord } from './model';
import type { AssignmentProjection } from './assignments';

/** Deterministic JSON: reordered object keys cannot change a proposal's identity. Arrays keep their meaningful order. */
export function proposalHash(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)]));
    return v;
  };
  return createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'null').digest('hex');
}
const identity = (key: RequestKey) => proposalHash(key);
const parse = <T>(row: unknown): T | undefined => row ? JSON.parse((row as { json: string }).json) as T : undefined;
type JoinedRequest = { request_json: string; decision_json: string | null; delivery_json: string | null };
const decodeRequests = (rows: JoinedRequest[]): RequestRecord[] => rows.map(r => ({ ...JSON.parse(r.request_json) as RequestRecord,
  ...(r.decision_json ? { decision: JSON.parse(r.decision_json) as DecisionReceipt } : {}),
  ...(r.delivery_json ? { delivery: JSON.parse(r.delivery_json) as DeliveryReceipt } : {}) }));

/** Changes whenever the file changed: another connection's commit (data_version) or this connection's own write
 *  (total_changes). Two cheap pragma reads, no table scanned. */
const changeStamp = (db: DatabaseSync): string =>
  `${(db.prepare('pragma data_version').get() as { data_version: number }).data_version}:${(db.prepare('select total_changes() n').get() as { n: number }).n}`;

/** The delivered permissions the app's own gate allowed, asked before ?: what pruneAutoPermits removes. */
const GATE_ALLOWED = `select r.id rid, d.id did from coordination_requests r
  join coordination_decisions d on d.request_id=r.id join coordination_deliveries l on l.decision_id=d.id
  where r.state='accepted' and r.at < ? and json_extract(r.json,'$.kind')='permission'
    and json_extract(d.json,'$.actor.kind')='policy' and json_extract(d.json,'$.actor.policy') in ('auto-permit','role-gate')
    and json_extract(d.json,'$.answer.allow')=1 and json_extract(l.json,'$.state')='delivered'`;

export class CoordinationStore {
  private handle: DatabaseSync;
  private openCache?: { db: DatabaseSync; stamp: string; cap: number; rows: RequestRecord[] };
  constructor(readonly file: string, private now = Date.now) {
    const opened = openAppDb(file);
    this.handle = opened.db;
    if (opened.aside) { this.handle.close(); throw new Error(`Coordination database recovery requires inspection; original preserved at ${opened.aside}`); }
    coordinationSchema(this.handle);
  }
  private get db(): DatabaseSync {
    if (!this.handle.isOpen) this.handle = reopenAppDb(this.file);
    return this.handle;
  }
  close(): void { if (this.handle.isOpen) this.handle.close(); }
  assignments(): AssignmentProjection[] {
    return (this.db.prepare(`select a.json from coordination_current_assignments c join coordination_assignments a on a.run_id=c.run_id
      order by c.started_at desc limit 2000`).all() as { json: string }[]).map(r => JSON.parse(r.json) as AssignmentProjection);
  }

  /** One-time import preserves the legacy file and every historical event verbatim. No completion inference. */
  importJobs(source: string, rows: WorkThread[]): void {
    tx(this.db, () => {
      if (this.db.prepare('select 1 from coordination_meta where key = ?').get(source)) return;
      for (const row of rows) {
        const existing = this.work(row.id);
        if (existing && proposalHash(existing) !== proposalHash(row)) throw new Error('Conflicting work history: original preserved.');
        if (!existing) this.writeWork(row, null);
      }
      this.db.prepare('insert into coordination_meta(key,value) values(?,?)').run(source, 'imported');
    });
  }
  imported(source: string): boolean { return !!this.db.prepare('select 1 from coordination_meta where key = ?').get(source); }
  works(): WorkThread[] { return (this.db.prepare('select json from coordination_jobs order by rowid').all() as { json: string }[]).map(r => JSON.parse(r.json) as WorkThread); }
  work(id: string): WorkThread | undefined { return parse(this.db.prepare('select json from coordination_jobs where id = ?').get(id)); }
  jobFor(chatId: string): string | undefined {
    return (this.db.prepare('select job_id from coordination_links where chat_id = ? limit 1').get(chatId) as { job_id: string } | undefined)?.job_id;
  }
  private writeWork(row: WorkThread, expected: number | null): void {
    const previous = this.work(row.id)?.events ?? [];
    const result = expected === null
      ? this.db.prepare('insert into coordination_jobs(id,version,json) values(?,?,?) on conflict(id) do nothing').run(row.id, row.version, JSON.stringify(row))
      : this.db.prepare('update coordination_jobs set version = ?, json = ? where id = ? and version = ?').run(row.version, JSON.stringify(row), row.id, expected);
    if (Number(result.changes) !== 1) throw new Error('Il filo è cambiato: rileggi lo stato prima di agire.');
    // The display keeps its bounded tail; the journal retains every event, including the imported history.
    let overlap = Math.min(previous.length, row.events.length);
    while (overlap && JSON.stringify(previous.slice(-overlap)) !== JSON.stringify(row.events.slice(0, overlap))) overlap--;
    let seq = Number((this.db.prepare('select coalesce(max(seq),0) n from coordination_history where job_id = ?').get(row.id) as { n: number }).n);
    for (const event of row.events.slice(overlap)) this.db.prepare('insert into coordination_history(job_id,seq,json) values(?,?,?)').run(row.id, ++seq, JSON.stringify(event));
    this.db.prepare('delete from coordination_links where job_id = ?').run(row.id);
    if (row.status !== 'done') for (const id of row.chatIds) {
      const other = this.jobFor(id);
      if (other && other !== row.id) throw new Error('Chat già collegata a un altro filo.');
      this.db.prepare('insert into coordination_links(chat_id,job_id) values(?,?)').run(id, row.id);
    }
  }
  history(jobId: string, afterSeq = 0, limit = 200): { seq: number; event: WorkThread['events'][number] }[] {
    return (this.db.prepare('select seq,json from coordination_history where job_id = ? and seq > ? order by seq limit ?')
      .all(jobId, afterSeq, Math.max(1, Math.min(2000, limit))) as { seq: number; json: string }[]).map(r => ({ seq: r.seq, event: JSON.parse(r.json) as WorkThread['events'][number] }));
  }
  saveWork(row: WorkThread, expected: number | null, request?: Omit<RequestRecord, 'id' | 'state'>): void {
    tx(this.db, () => { this.writeWork(row, expected); if (request) this.insertRequest(request); });
  }
  private insertRequest(input: Omit<RequestRecord, 'id' | 'state'>): RequestRecord {
    const k = input.key;
    if (!k.originalRequestId || !k.jobId || !k.chatId || !Number.isSafeInteger(k.taskVersion) || k.taskVersion < 1
      || !Number.isSafeInteger(k.proposalRevision) || k.proposalRevision < 0 || !/^[a-f0-9]{64}$/.test(k.proposalHash)) throw new Error('Invalid request identity.');
    const id = identity(k), old = this.request(id);
    if (old) return old; // repeated notification is not a new unanswered request
    this.cancelPending(k.chatId, k.originalRequestId);
    const row: RequestRecord = { ...input, id, state: 'pending' };
    this.db.prepare('insert into coordination_requests(id,job_id,chat_id,original_id,state,at,json) values(?,?,?,?,?,?,?)')
      .run(id, k.jobId, k.chatId, k.originalRequestId, row.state, row.at, JSON.stringify(row));
    this.db.prepare('insert into coordination_open_requests(request_id) values(?)').run(id);
    return row;
  }
  register(input: Omit<RequestRecord, 'id' | 'state'>, supersededOriginalId?: string): RequestRecord {
    return tx(this.db, () => {
      if (supersededOriginalId && supersededOriginalId !== input.key.originalRequestId) this.cancelPending(input.key.chatId, supersededOriginalId);
      return this.insertRequest(input);
    });
  }
  request(id: string): RequestRecord | undefined {
    const row = parse<RequestRecord>(this.db.prepare('select json from coordination_requests where id = ?').get(id));
    if (!row) return undefined;
    row.decision = parse(this.db.prepare('select json from coordination_decisions where request_id = ?').get(id));
    if (row.decision) row.delivery = parse(this.db.prepare('select json from coordination_deliveries where decision_id = ?').get(row.decision.id));
    return row;
  }
  original(chatId: string, originalId: string): RequestRecord | undefined {
    const row = this.db.prepare('select id from coordination_requests where chat_id = ? and original_id = ? order by at desc limit 1').get(chatId, originalId) as { id: string } | undefined;
    return row ? this.request(row.id) : undefined;
  }
  requests(jobId?: string, limit = 200): RequestRecord[] {
    const cap = Math.max(1, Math.min(2000, limit));
    const sql = `select r.json request_json, d.json decision_json, l.json delivery_json from coordination_requests r
      left join coordination_decisions d on d.request_id = r.id left join coordination_deliveries l on l.decision_id = d.id
      ${jobId ? 'where r.job_id = ?' : ''} order by r.at desc limit ?`;
    return decodeRequests((jobId ? this.db.prepare(sql).all(jobId, cap) : this.db.prepare(sql).all(cap)) as JoinedRequest[]);
  }
  /** The open requests only (pending, or accepted and not delivered or applied: coordination_open_requests), newest
   *  first: everything a projection acts on. Read by every projection (the work driver's minute tick, app_digest,
   *  work:list); it used to decode the last 2000 rows of the whole journal, which blocked the window (ADR 0368), so
   *  closed history is read only by requests(). Cached until a connection commits to the file (data_version) or this
   *  one writes (total_changes). The rows are shared: callers only read them. */
  projectionRequests(limit = 2000): RequestRecord[] {
    const cap = Math.max(1, Math.min(2000, limit));
    const db = this.db, stamp = changeStamp(db), cached = this.openCache;
    if (cached && cached.db === db && cached.stamp === stamp && cached.cap === cap) return cached.rows;
    // cross join: the few open rows drive the query (a plain join let SQLite walk every request by its time, 37 ms)
    const rows = decodeRequests(db.prepare(`select r.json request_json, d.json decision_json, l.json delivery_json
      from coordination_open_requests o cross join coordination_requests r on r.id=o.request_id
      left join coordination_decisions d on d.request_id=r.id left join coordination_deliveries l on l.decision_id=d.id
      order by r.at desc limit ?`).all(cap) as JoinedRequest[]);
    this.openCache = { db, stamp, cap, rows };
    return rows;
  }
  /** One batch of the clean-up of old auto-permitted permissions (ADR 0368; prune.ts runs it off the hot path): a
   *  permission the app's own gate allowed (policy auto-permit or role-gate), delivered, asked before `before`, leaves
   *  the journal with its decision, delivery and execution rows. User decisions, refusals and anything still open stay.
   *  Returns how many requests it removed: fewer than `batch` means nothing is left. */
  pruneAutoPermits(before: number, batch = 500): number {
    return tx(this.db, () => {
      const rows = this.db.prepare(`${GATE_ALLOWED} limit ?`).all(before, Math.max(1, Math.trunc(batch))) as { rid: string; did: string }[];
      const byDecision = ['delete from coordination_execution where decision_id = ?', 'delete from coordination_deliveries where decision_id = ?',
        'delete from coordination_decisions where id = ?'].map(sql => this.db.prepare(sql));
      const request = this.db.prepare('delete from coordination_requests where id = ?'), open = this.db.prepare('delete from coordination_open_requests where request_id = ?');
      for (const { rid, did } of rows) { for (const st of byDecision) st.run(did); request.run(rid); open.run(rid); }
      return rows.length;
    });
  }
  /** Whether any gate-allowed permission row is left, of any age (prune.ts: the job is done only when none is). */
  autoPermitsLeft(): boolean { return !!this.db.prepare(`${GATE_ALLOWED} limit 1`).get(Number.MAX_SAFE_INTEGER); }
  /** A one-time job's mark in coordination_meta (prune.ts). */
  done(key: string): boolean { return !!this.db.prepare('select 1 from coordination_meta where key = ?').get(key); }
  markDone(key: string): void { this.db.prepare('insert into coordination_meta(key,value) values(?,?) on conflict(key) do nothing').run(key, 'done'); }
  cancelPending(chatId: string, originalId: string): void {
    const rows = this.db.prepare("select json from coordination_requests where chat_id = ? and original_id = ? and state = 'pending'").all(chatId, originalId) as { json: string }[];
    for (const { json } of rows) {
      const row = JSON.parse(json) as RequestRecord; row.state = 'cancelled';
      this.db.prepare("update coordination_requests set state = 'cancelled', json = ? where id = ? and state = 'pending'").run(JSON.stringify(row), row.id);
      this.db.prepare('delete from coordination_open_requests where request_id = ?').run(row.id);
    }
  }
  cancelOtherAssignments(chatId: string, currentRunId: string): void {
    tx(this.db, () => {
      const stale = this.db.prepare("select json from coordination_requests where chat_id = ? and state = 'pending'").all(chatId) as { json: string }[];
      for (const { json } of stale) {
        const row = JSON.parse(json) as RequestRecord;
        if (row.key.runId !== currentRunId) this.cancelPending(chatId, row.key.originalRequestId);
      }
    });
  }
  /** The caller supplies the CURRENT host binding, never a key invented by an engine. A single transaction wins. */
  resolve(key: RequestKey, actor: DecisionActor, answer: unknown, work?: { row: WorkThread; expected: number }): DecisionReceipt {
    return tx(this.db, () => {
      const id = identity(key), row = this.request(id);
      if (!row || row.state !== 'pending') throw new Error('Request is stale, already answered, or belongs to another work assignment.');
      if (actor.kind === 'agent-relay') throw new Error('An agent report or relay is not user consent.');
      if (actor.kind !== 'user' && actor.kind !== 'policy') throw new Error('Invalid decision actor.');
      const decision: DecisionReceipt = { id: randomUUID(), key: { ...key }, at: this.now(), actor: structuredClone(actor), answer: structuredClone(answer) };
      row.state = 'accepted';
      const changed = this.db.prepare("update coordination_requests set state = 'accepted', json = ? where id = ? and state = 'pending'").run(JSON.stringify(row), id);
      if (Number(changed.changes) !== 1) throw new Error('Request already answered.');
      this.db.prepare('insert into coordination_decisions(id,request_id,json) values(?,?,?)').run(decision.id, id, JSON.stringify(decision));
      if (work) { this.writeWork(work.row, work.expected); this.db.prepare('delete from coordination_open_requests where request_id = ?').run(id); }
      return decision;
    });
  }
  /** Persist dispatch intent before touching the engine. An interrupted dispatch is uncertain, not retryable. */
  beginDelivery(decisionId: string): DeliveryReceipt {
    return tx(this.db, () => {
      if (!this.db.prepare('select 1 from coordination_decisions where id = ?').get(decisionId)) throw new Error('Decision receipt required.');
      const row: DeliveryReceipt = { id: randomUUID(), decisionId, at: this.now(), state: 'dispatching' };
      const result = this.db.prepare('insert into coordination_deliveries(id,decision_id,json) values(?,?,?) on conflict(decision_id) do nothing').run(row.id, decisionId, JSON.stringify(row));
      if (Number(result.changes) !== 1) throw new Error('Delivery already attempted; inspect its receipt instead of replaying it.');
      return row;
    });
  }
  /** Called only after the host's strict checkpoint succeeds; no engine dispatch or execution ACK is implied. */
  recordApplication(decisionId: string): DeliveryReceipt {
    return tx(this.db, () => {
      if (!this.db.prepare('select 1 from coordination_decisions where id = ?').get(decisionId)) throw new Error('Decision receipt required.');
      const row: DeliveryReceipt = { id: randomUUID(), decisionId, at: this.now(), state: 'applied' };
      this.db.prepare('insert into coordination_deliveries(id,decision_id,json) values(?,?,?)').run(row.id, decisionId, JSON.stringify(row));
      this.db.prepare('delete from coordination_open_requests where request_id = (select request_id from coordination_decisions where id = ?)').run(decisionId);
      return row;
    });
  }
  finishDelivery(id: string, state: 'delivered' | 'failed' | 'uncertain', detail?: string): DeliveryReceipt {
    return tx(this.db, () => {
      const row = parse<DeliveryReceipt>(this.db.prepare('select json from coordination_deliveries where id = ?').get(id));
      if (!row || row.state !== 'dispatching') throw new Error('Delivery no longer dispatching.');
      const next = { ...row, state, at: this.now(), ...(detail ? { detail } : {}) };
      this.db.prepare('update coordination_deliveries set json = ? where id = ?').run(JSON.stringify(next), id);
      if (state === 'delivered') this.db.prepare('delete from coordination_open_requests where request_id = (select request_id from coordination_decisions where id = ?)').run(row.decisionId);
      return next;
    });
  }
  recordExecution(input: Omit<ExecutionEvidence, 'id' | 'at'>): ExecutionEvidence {
    if (!this.db.prepare('select 1 from coordination_decisions where id = ?').get(input.decisionId)) throw new Error('Decision receipt required.');
    const row = { ...input, id: randomUUID(), at: this.now() };
    this.db.prepare('insert into coordination_execution(id,decision_id,json) values(?,?,?)').run(row.id, row.decisionId, JSON.stringify(row));
    return row;
  }
  execution(decisionId: string): ExecutionEvidence[] {
    return (this.db.prepare('select json from coordination_execution where decision_id = ?').all(decisionId) as { json: string }[]).map(r => JSON.parse(r.json) as ExecutionEvidence);
  }
}

/** Shared by the job/request service and RunsDb, using the app's existing area-version transaction protocol. */
export function coordinationSchema(db: DatabaseSync): void {
  migrate(db, 'coordination', [connection => connection.exec(`
    create table coordination_jobs(id text primary key, version integer not null, json text not null);
    create table coordination_links(chat_id text not null, job_id text not null, primary key(chat_id, job_id));
    create table coordination_meta(key text primary key, value text not null);
    create table coordination_history(job_id text not null, seq integer not null, json text not null, primary key(job_id,seq));
    create table coordination_requests(id text primary key, job_id text not null, chat_id text not null,
      original_id text not null, state text not null, at real not null, json text not null);
    create index coordination_requests_job on coordination_requests(job_id, state, at);
    create index coordination_requests_chat on coordination_requests(chat_id, original_id, state);
    create index coordination_requests_state on coordination_requests(state, at);
    create index coordination_requests_at on coordination_requests(at);
    create table coordination_decisions(id text primary key, request_id text not null unique, json text not null);
    create table coordination_deliveries(id text primary key, decision_id text not null unique, json text not null);
    create table coordination_execution(id text primary key, decision_id text not null, json text not null);
    create index coordination_execution_decision on coordination_execution(decision_id);
    create table coordination_assignments(run_id text primary key, task_id text not null, chat_id text not null, version integer not null, started_at real not null, json text not null);
    create index coordination_assignments_task on coordination_assignments(task_id,version,started_at);
    create index coordination_assignments_chat on coordination_assignments(chat_id);
    create table coordination_current_assignments(task_id text primary key, run_id text not null, version integer not null, started_at real not null);
    create index coordination_current_started on coordination_current_assignments(started_at);
    create index coordination_current_run on coordination_current_assignments(run_id);
  `), connection => connection.exec(`
    create table coordination_open_requests(request_id text primary key);
    insert into coordination_open_requests(request_id)
      select r.id from coordination_requests r left join coordination_decisions d on d.request_id=r.id
      left join coordination_deliveries l on l.decision_id=d.id
      where r.state='pending' or (r.state='accepted' and json_extract(r.json,'$.kind') != 'workflow'
        and coalesce(json_extract(l.json,'$.state'),'') != 'delivered');
  `), connection => connection.exec(`
    create index if not exists coordination_requests_chat_state_run
      on coordination_requests(chat_id, state, json_extract(json,'$.key.runId'));
  `)]);
}
