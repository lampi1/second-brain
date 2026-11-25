// The one-time move to the plans (ADR 0359). At app start, before the plans load, the old records become plans, and the old
// files stay exactly as they were. This is the one isolated reader of the retired formats; nothing else in the app knows them:
//   1. the work maps: <userData>/work-maps/<id>/map.json + history.jsonl (archived ones included), each one a plan; the maps of the
//      same job (the same chat, or the same title but for a trailing «(2)»), or of a project named by their title («Air refactoring ·
//      …» and the map «air-refactoring»), are one plan: the newest is the base, every other step, answer, doubt and version comes in,
//      the others' names go to `from`;
//   2. the project maps: <brain>/projects/<name>/map.json (+ history.jsonl), each one a plan whose steps are the map's steps; their
//      other pieces stay in `legacy-map.json` beside the plan; a map's status is no proof, so what it called done is «da verificare»;
//   3. the project folders with no map: a plan that links their files (plan.md and the rest are linked, never copied); a folder whose
//      name is part of a map's name joins that map's plan.
// A step called done is «fatto» only when its chat's report can still be read (reportOf), else «da verificare». Before anything is
// written the old files are copied to <userData>/backups/plans-migration-<time>/ with a fingerprint (sha256) of each, and the copy
// is checked. The plans are written in a folder of their own and moved in at the end: a failure leaves the old data and the plans
// already there as they were, and says why. It is repeatable: a record already named in some plan's \`from\` is never made twice.
// A report with the counts before and after is kept in <userData>/plans/.migration.json. Used by wiring-shared.ts attachPlans;
// pinned by test/unit/plans/migrate.test.ts (run twice on a copy, a simulated failure).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PLAN_ID, PLAN_LIMITS, planStateOf, readPlanRecord, type Plan, type PlanLink } from '@shared/plan';
import { proved, readSteps, type PlanStep } from '@shared/plan-steps';
import type { StrategyPlan } from '@shared/strategy';
import { errText, log } from '../log';
import { PlanStore } from './store';

export interface MigrationDeps {
  userData: string;
  brainRoot: string | null;
  now?: () => number;
  /** the report a chat gave, when it can still be read (outcome, its summary, when) */
  reportOf?: (chatId: string) => { outcome: 'done' | 'partial' | 'blocked'; summary: string; at: number } | null;
  /** tests: fails the move of the plans into place */
  failMove?: boolean;
}
export interface MigrationReport {
  at: number;
  /** before: the records found; after: the plans made */
  before: { workMaps: number; projectMaps: number; folders: number };
  after: { plans: number; merged: number; steps: number; check: number; doubts: number; versions: number };
  /** what each plan came from, by name */
  plans: { id: string; title: string; from: string[]; steps: number; check: number }[];
}
export interface MigrationResult { ran: boolean; report?: MigrationReport; error?: string; skipped?: string[] }

type Raw = Record<string, unknown>;
const obj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const read = (file: string): unknown => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const lines = (file: string): unknown[] => { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } }); } catch { return []; } };
const sha = (file: string): string => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const slug = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const baseTitle = (t: string): string => t.replace(/\s*\(\d+\)\s*$/, '').trim().toLowerCase();

/** One old record, read: its current content and every version it had. */
interface Source { token: string; kind: 'wm' | 'pm' | 'fo'; name: string; current: Raw; versions: Raw[]; dir: string; files: string[]; updatedAt: number }

function workMaps(userData: string): Source[] {
  const root = path.join(userData, 'work-maps');
  let names: string[] = [];
  try { names = fs.readdirSync(root).filter(n => /^wm_[a-z0-9]{6,24}$/.test(n)); } catch { return []; }
  return names.flatMap(n => {
    const dir = path.join(root, n), current = read(path.join(dir, 'map.json'));
    if (!obj(current) || !str(current.title)) return [];
    return [{ token: n, kind: 'wm' as const, name: String(current.title), current, versions: lines(path.join(dir, 'history.jsonl')).filter(obj), dir, files: ['map.json', 'history.jsonl'], updatedAt: num(current.updatedAt) ? current.updatedAt : 0 }];
  });
}
function projects(brainRoot: string | null): Source[] {
  if (!brainRoot) return [];
  const root = path.join(brainRoot, 'projects');
  let names: string[] = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { return []; }
  return names.map(n => {
    const dir = path.join(root, n), map = read(path.join(dir, 'map.json')), has = obj(map) && Array.isArray(map.elements);
    const files = (() => { try { return fs.readdirSync(dir); } catch { return []; } })();
    return { token: `projects/${n}`, kind: has ? 'pm' as const : 'fo' as const, name: n, current: has ? map : {}, versions: has ? lines(path.join(dir, 'history.jsonl')).filter(obj) : [], dir, files, updatedAt: has && num(map.updatedAt) ? map.updatedAt : 0 };
  });
}

/** What the old project map's status says of a piece: never a proof, so «ok» and «work» are to verify. */
const MAP_STATE: Record<string, string> = { ok: 'done', work: 'done', blocked: 'blocked', planned: 'todo', todo: 'todo' };
function mapSteps(map: Raw): Raw[] {
  const els = (Array.isArray(map.elements) ? map.elements : []).filter(obj).filter(e => e.kind === 'step' && str(e.name));
  return els.slice(0, 300).map(e => ({ title: String(e.name).slice(0, 160), ...(str(e.description) ? { detail: String(e.description).slice(0, 1200) } : {}), state: MAP_STATE[String(e.status)] ?? 'todo', ...(e.par === true ? { par: true } : {}) }));
}
const FOLDER_LINKS = (s: Source): PlanLink[] => {
  const rel = (f: string) => `projects/${s.name}/${f}`, out: PlanLink[] = s.files.filter(f => f !== 'map.json' && f !== 'history.jsonl').slice(0, PLAN_LIMITS.links - 1).map(f => ({ kind: 'file' as const, ref: rel(f), ...(f === 'plan.md' ? { label: 'piano' } : {}) }));
  return s.files.length > out.length + 2 ? [...out, { kind: 'file', ref: `projects/${s.name}`, label: 'cartella' }] : out;
};

/** The plan a snapshot of an old work map or project map says, under a new id. */
function snapshot(src: Source, raw: Raw, id: string, from: string[], reportOf: MigrationDeps['reportOf']): Plan | null {
  const isMap = src.kind === 'pm';
  const steps = readSteps(isMap ? mapSteps(raw) : (obj(raw.plan) ? raw.plan.steps : [])) ?? [];
  const fixed = reportOf ? proved(steps, cid => reportOf(cid)) : steps;
  const plan: StrategyPlan | undefined = isMap ? (fixed.length ? { phase: 'approved', clarified: [], steps: fixed, at: num(raw.updatedAt) ? raw.updatedAt : 1 } : undefined)
    : obj(raw.plan) ? { ...(raw.plan as unknown as StrategyPlan), steps: fixed } : undefined;
  const title = str(raw.title) ? raw.title.slice(0, PLAN_LIMITS.title) : src.name.slice(0, PLAN_LIMITS.title);
  const at = num(raw.createdAt) ? raw.createdAt : 1;
  const rec = readPlanRecord({
    id, version: 1, title, ...(str(raw.idea) ? { idea: raw.idea } : {}), ...(isMap && str(raw.description) ? { idea: raw.description } : {}), project: str(raw.project) ? raw.project : isMap ? src.name : undefined,
    constraints: [], links: [], from, ...(plan ? { plan } : {}), owner: obj(raw.owner) ? raw.owner : undefined, past: raw.past, stopped: raw.stopped, finishedAt: raw.finishedAt, seenAt: raw.seenAt, archivedAt: raw.archivedAt,
    createdAt: at, updatedAt: num(raw.updatedAt) ? raw.updatedAt : at, by: str(raw.by) ? raw.by : 'app', summary: str(raw.summary) ? raw.summary : '',
  }, id);
  return rec;
}

/** Everything the migration decided, before a byte is written. */
function plan(sources: Source[], d: MigrationDeps, taken: ReadonlySet<string>, newId: () => string): { plans: { rec: Plan; versions: Plan[]; legacy: Source[] }[]; skipped: string[] } {
  const fresh = sources.filter(s => !taken.has(s.token)), skipped = sources.filter(s => taken.has(s.token)).map(s => s.token);
  const wms = fresh.filter(s => s.kind === 'wm'), pms = fresh.filter(s => s.kind === 'pm'), fos = fresh.filter(s => s.kind === 'fo');
  // union-find over the work maps: the same chat, or the same title but for a trailing «(2)»
  const parent = new Map(wms.map(s => [s.token, s.token]));
  const find = (x: string): string => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; } return x; };
  const join = (a: string, b: string) => { parent.set(find(a), find(b)); };
  const key = new Map<string, string>();
  for (const s of wms) for (const k of [obj(s.current.owner) && str(s.current.owner.chatId) ? `chat:${s.current.owner.chatId}` : '', `title:${baseTitle(s.name)}`].filter(Boolean)) { const was = key.get(k); if (was) join(was, s.token); else key.set(k, s.token); }
  // a project named by the title («Air refactoring · …»): the work maps and the project map are one plan
  const byProject = new Map<string, string>();
  for (const s of wms) { const head = slug(s.name.split(' · ')[0] ?? ''); if (head && pms.some(p => p.name === head)) { const was = byProject.get(head); if (was) join(was, s.token); else byProject.set(head, s.token); } }
  const groups = new Map<string, Source[]>();
  for (const s of wms) groups.set(find(s.token), [...(groups.get(find(s.token)) ?? []), s]);
  const made: { members: Source[]; pm?: Source }[] = [...groups.values()].map(members => ({ members }));
  for (const [head, token] of byProject) { const g = made.find(m => m.members.some(x => find(x.token) === find(token)))!; g.pm = pms.find(p => p.name === head); }
  for (const p of pms) if (!made.some(m => m.pm === p)) made.push({ members: [], pm: p });
  // a folder with no map: part of a map's name = that map's plan; else its own
  const tokens = (n: string) => n.split('-').filter(Boolean);
  for (const f of fos) { const into = made.find(m => m.pm && tokens(f.name).every(t => tokens(m.pm!.name).includes(t)) && f.name !== m.pm.name); if (into) into.members.push(f); else made.push({ members: [f] }); }
  const out = made.map(m => {
    const all = [...m.members, ...(m.pm ? [m.pm] : [])], base = [...m.members.filter(x => x.kind === 'wm')].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? m.pm ?? m.members[0]!;
    const id = newId(), from = all.map(s => s.token);
    const versions = all.filter(s => s.kind !== 'fo').flatMap(s => (s.versions.length ? s.versions : [s.current]).flatMap(v => { const r = snapshot(s, v, id, from, d.reportOf); return r ? [{ ...r, summary: `[${s.name.slice(0, 40)}] ${r.summary}`.slice(0, PLAN_LIMITS.summary) }] : []; })).sort((a, b) => a.updatedAt - b.updatedAt);
    let rec = snapshot(base, base.current, id, from, d.reportOf) ?? readPlanRecord({ id, version: 1, title: base.name, constraints: [], links: [], from, createdAt: 1, updatedAt: 1, by: 'app', summary: '' }, id)!;
    // what the others bring: steps, answers, doubts; every step keeps its own state and proof
    for (const s of all.filter(x => x !== base && x.kind !== 'fo')) {
      const o = snapshot(s, s.current, id, from, d.reportOf);
      if (!o?.plan?.steps.length && !o?.plan?.doubts?.length && !o?.plan?.clarified.length) continue;
      const mine = rec.plan ?? { phase: 'approved' as const, clarified: [], steps: [], at: rec.updatedAt };
      const ids = new Map<string, string>(), used = [...mine.steps];
      const add: PlanStep[] = (o.plan?.steps ?? []).map(st => { let n = used.length + 1; while ([...used].some(u => u.id === `s${n}`)) n++; const nid = `s${n}`; ids.set(st.id, nid); const step = { ...st, id: nid }; used.push(step); return step; })
        .map(st => { const after = (st.after ?? []).map(x => ids.get(x)).filter((x): x is string => !!x); const { after: _a, ...rest } = st; return after.length ? { ...rest, after } : rest; });
      rec = { ...rec, plan: { ...mine, steps: [...mine.steps, ...add].slice(0, 400), clarified: [...mine.clarified, ...(o.plan?.clarified ?? []).filter(c => !mine.clarified.some(x => x.q === c.q))].slice(0, 8),
        ...((mine.doubts?.length || o.plan?.doubts?.length) ? { doubts: [...(mine.doubts ?? []), ...(o.plan?.doubts ?? []).filter(x => !(mine.doubts ?? []).some(y => y.text === x.text))] } : {}) } };
    }
    const links = all.filter(x => x.kind === 'fo' || x.kind === 'pm').flatMap(FOLDER_LINKS).slice(0, PLAN_LIMITS.links);
    const project = rec.project ?? m.pm?.name ?? m.members[0]?.name;
    rec = { ...rec, links, ...(project ? { project: project.slice(0, PLAN_LIMITS.project) } : {}), from: from.slice(0, PLAN_LIMITS.from) };
    rec = { ...rec, state: planStateOf(rec) };
    return { rec, versions, legacy: all.filter(x => x.kind === 'pm') };
  });
  return { plans: out, skipped };
}

/** Runs the migration; never throws. */
export function migratePlans(d: MigrationDeps): MigrationResult {
  const now = d.now?.() ?? Date.now(), dest = path.join(d.userData, 'plans');
  let tmp = '';
  const moved: string[] = [];
  try {
    const found = [...workMaps(d.userData), ...projects(d.brainRoot)];
    if (!found.length) return { ran: false };
    // what the plans already say they came from: never made twice
    const taken = new Set<string>();
    for (const store of [new PlanStore(dest)]) for (const p of store.load()) for (const f of p.from ?? []) taken.add(f);
    const fresh = found.filter(s => !taken.has(s.token));
    if (!fresh.length) return { ran: false, skipped: found.map(s => s.token) };
    const ids = new Set<string>(); try { for (const n of fs.readdirSync(dest)) ids.add(n); } catch { /* none yet */ }
    const newId = () => { let id = ''; do id = `pl_${crypto.randomBytes(6).toString('hex')}`; while (ids.has(id)); ids.add(id); return id; };
    const made = plan(found, d, taken, newId);
    if (!made.plans.length) return { ran: false, skipped: made.skipped };
    // 1. the old files are copied first, with a fingerprint each, and the copy is checked
    const backup = path.join(d.userData, 'backups', `plans-migration-${new Date(now).toISOString().replace(/[:.]/g, '-')}`), manifest: { file: string; sha256: string }[] = [];
    for (const s of fresh) for (const f of s.files) {
      const from = path.join(s.dir, f);
      if (!fs.existsSync(from) || !fs.statSync(from).isFile()) continue;
      const to = path.join(backup, s.kind === 'wm' ? 'work-maps' : 'projects', s.kind === 'wm' ? s.token : s.name, f);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      const a = sha(from);
      if (sha(to) !== a) throw new Error(`la copia di ${s.token}/${f} non coincide: non cambio niente`);
      manifest.push({ file: `${s.token}/${f}`, sha256: a });
    }
    fs.mkdirSync(backup, { recursive: true });
    fs.writeFileSync(path.join(backup, 'manifest.json'), `${JSON.stringify({ at: now, files: manifest }, null, 2)}\n`);
    // 2. the plans are written in a folder of their own, then moved in together
    tmp = path.join(d.userData, `plans.migrating-${now}`);
    const store = new PlanStore(tmp);
    for (const m of made.plans) {
      const vs = [...m.versions, { ...m.rec, summary: 'Migrato dalle mappe e dai lavori precedenti' }];
      vs.forEach((v, i) => store.save({ ...v, id: m.rec.id, version: i + 1, state: planStateOf(v), ...(i === vs.length - 1 ? {} : {}) }));
      if (m.legacy.length) fs.writeFileSync(path.join(tmp, m.rec.id, 'legacy-map.json'), `${JSON.stringify(m.legacy.map(s => ({ from: s.token, map: s.current })), null, 2)}\n`);
    }
    fs.mkdirSync(dest, { recursive: true });
    for (const m of made.plans) {
      if (d.failMove && moved.length === 1) throw new Error('spostamento simulato fallito');
      fs.renameSync(path.join(tmp, m.rec.id), path.join(dest, m.rec.id));
      moved.push(m.rec.id);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    const steps = made.plans.reduce((n, m) => n + (m.rec.plan?.steps.length ?? 0), 0), check = made.plans.reduce((n, m) => n + (m.rec.plan?.steps.filter(s => s.state === 'check').length ?? 0), 0);
    const report: MigrationReport = {
      at: now, before: { workMaps: fresh.filter(s => s.kind === 'wm').length, projectMaps: fresh.filter(s => s.kind === 'pm').length, folders: fresh.filter(s => s.kind === 'fo').length },
      after: { plans: made.plans.length, merged: fresh.length - made.plans.length, steps, check, doubts: made.plans.reduce((n, m) => n + (m.rec.plan?.doubts?.length ?? 0), 0), versions: made.plans.reduce((n, m) => n + m.versions.length + 1, 0) },
      plans: made.plans.map(m => ({ id: m.rec.id, title: m.rec.title, from: m.rec.from ?? [], steps: m.rec.plan?.steps.length ?? 0, check: m.rec.plan?.steps.filter(s => s.state === 'check').length ?? 0 })),
    };
    const file = path.join(dest, '.migration.json'), before = read(file), runs = Array.isArray(before) ? before : [];
    fs.writeFileSync(file, `${JSON.stringify([...runs, report], null, 2)}\n`);
    log.info('plans', 'old records moved to plans', { data: { plans: report.after.plans, from: found.length } });
    return { ran: true, report, ...(made.skipped.length ? { skipped: made.skipped } : {}) };
  } catch (e) {
    // the plans already moved in are taken out again: the old data is where it was and the next start tries again
    for (const id of moved) { try { fs.rmSync(path.join(dest, id), { recursive: true, force: true }); } catch { /* left for the next try */ } }
    if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } }
    log.warn('plans', 'the move to the plans failed', { cause: errText(e), hint: 'the old data is intact; it is tried again at the next start' });
    return { ran: false, error: errText(e) };
  }
}
export { PLAN_ID };
