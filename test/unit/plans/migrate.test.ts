// The one-time move from the old work maps and project maps to plans (main/plans/migrate.ts, ADR 0361), on a copy built in a
// temp folder: the old files are never touched; a backup with fingerprints comes first; it runs twice with no duplicates; a
// failure in the middle leaves the old data intact and the next start does it; what no proof backs is «da verificare».
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, errText: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));
import { migratePlans } from '../../../src/main/plans/migrate';
import { PlanStore } from '../../../src/main/plans/store';

let root: string, userData: string, brain: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-migrate-')); userData = path.join(root, 'userData'); brain = path.join(root, 'brain'); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const put = (file: string, v: unknown) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof v === 'string' ? v : `${JSON.stringify(v)}\n`); };
const step = (title: string, state: string, extra: object = {}) => ({ title, state, ...extra });
/** An old work map: the same job twice («(2)» is the same title), one with a «done» step no report backs, one blocked. */
function seed() {
  const wm = (id: string, title: string, steps: object[], extra: object = {}) => put(path.join(userData, 'work-maps', id, 'map.json'), { id, version: 2, title, touches: [], state: 'running', createdAt: 100, updatedAt: 200, by: 'app', summary: '', plan: { phase: 'running', at: 150, clarified: [{ q: 'Dove?', a: 'Negli ordini' }], steps }, ...extra });
  wm('wm_aaaaaa', 'Sconti a fasce', [step('Cerco', 'done', { role: 'scout' }), step('Applico', 'blocked'), step('Scrivo', 'todo')], { owner: { chatId: 'c1', task: 't1' } });
  wm('wm_bbbbbb', 'Sconti a fasce (2)', [step('Provo', 'todo')]);
  wm('wm_cccccc', 'Resi', [step('Uno', 'todo'), step('Due', 'todo')]);
  put(path.join(userData, 'work-maps', 'wm_aaaaaa', 'history.jsonl'), '{"id":"wm_aaaaaa","version":1,"title":"Sconti a fasce","touches":[],"state":"idea","createdAt":100,"updatedAt":120,"by":"app","summary":"v1"}\n');
  put(path.join(brain, 'projects', 'negozio', 'map.json'), { elements: [{ kind: 'step', name: 'Catalogo', status: 'ok' }, { kind: 'step', name: 'Cassa', status: 'planned' }], updatedAt: 90 });
  put(path.join(brain, 'projects', 'magazzino', 'plan.md'), '# magazzino\n');
}
/** every file of the old data, by path, with its fingerprint */
function fingerprints(): Record<string, string> {
  const out: Record<string, string> = {}, walk = (d: string) => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[p] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } };
  walk(path.join(userData, 'work-maps')); walk(path.join(brain, 'projects'));
  return out;
}
const plansOn = () => new PlanStore(path.join(userData, 'plans')).load();

describe('the move to plans', () => {
  it('makes plans from the old records, merges the same job, keeps every step and version, and says what it counted', () => {
    seed();
    const r = migratePlans({ userData, brainRoot: brain, now: () => 5000 });
    expect(r.ran).toBe(true);
    expect(r.report!.before).toEqual({ workMaps: 3, projectMaps: 1, folders: 1 });
    // the same job twice is one plan; the project map and the folder are plans of their own
    expect(r.report!.after.plans).toBe(4);
    expect(r.report!.after.merged).toBe(1);
    const all = plansOn();
    expect(all).toHaveLength(4);
    const sconti = all.find(p => p.title === 'Sconti a fasce')!;
    expect(sconti.plan!.steps.map(s => s.title)).toEqual(['Cerco', 'Applico', 'Scrivo', 'Provo']);
    expect(sconti.from).toEqual(expect.arrayContaining(['wm_aaaaaa', 'wm_bbbbbb']));
    expect(sconti.plan!.clarified).toHaveLength(1);
    expect(new PlanStore(path.join(userData, 'plans')).history(sconti.id).length).toBeGreaterThanOrEqual(2);
  });

  it('a step called done with no report to prove it is «da verificare»; a project map\'s «ok» too; nothing becomes done', () => {
    seed();
    migratePlans({ userData, brainRoot: brain, now: () => 5000 });
    const all = plansOn(), steps = all.flatMap(p => p.plan?.steps ?? []);
    expect(steps.filter(s => s.state === 'done')).toEqual([]);
    expect(all.find(p => p.title === 'Sconti a fasce')!.plan!.steps.find(s => s.title === 'Cerco')!.state).toBe('check');
    expect(all.find(p => p.project === 'negozio')!.plan!.steps.find(s => s.title === 'Catalogo')!.state).toBe('check');
    expect(all.find(p => p.title === 'Sconti a fasce')!.plan!.steps.find(s => s.title === 'Applico')!.state).toBe('blocked');
  });

  it('a done step whose chat\'s report can still be read is done, with that report as its proof', () => {
    seed();
    put(path.join(userData, 'work-maps', 'wm_aaaaaa', 'map.json'), { id: 'wm_aaaaaa', version: 2, title: 'Sconti a fasce', touches: [], state: 'running', createdAt: 100, updatedAt: 200, by: 'app', summary: '',
      plan: { phase: 'running', at: 150, clarified: [], steps: [step('Cerco', 'done', { chatIds: ['k1'] })] }, owner: { chatId: 'c1', task: 't1' } });
    migratePlans({ userData, brainRoot: brain, now: () => 5000, reportOf: id => (id === 'k1' ? { outcome: 'done', summary: 'trovato', at: 300 } : null) });
    expect(plansOn().find(p => p.title === 'Sconti a fasce')!.plan!.steps.find(s => s.title === 'Cerco')).toMatchObject({ state: 'done', proof: { text: 'trovato' } });
  });

  it('the old files are not touched, and a copy with a fingerprint of each is made first', () => {
    seed();
    const before = fingerprints();
    const r = migratePlans({ userData, brainRoot: brain, now: () => 5000 });
    expect(fingerprints()).toEqual(before);
    const backups = fs.readdirSync(path.join(userData, 'backups')).filter(n => n.startsWith('plans-migration-'));
    expect(backups).toHaveLength(1);
    const manifest = JSON.parse(fs.readFileSync(path.join(userData, 'backups', backups[0]!, 'manifest.json'), 'utf8')) as { files: { file: string; sha256: string }[] };
    expect(manifest.files.length).toBeGreaterThanOrEqual(Object.keys(before).length - 1);
    for (const f of manifest.files) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.report!.plans.every(p => p.from.length > 0)).toBe(true);
  });

  it('twice on the same copy makes no duplicates: the second run does nothing', () => {
    seed();
    const first = migratePlans({ userData, brainRoot: brain, now: () => 5000 });
    const ids = plansOn().map(p => p.id).sort();
    const second = migratePlans({ userData, brainRoot: brain, now: () => 6000 });
    expect(first.ran).toBe(true);
    expect(second.ran).toBe(false);
    expect(plansOn().map(p => p.id).sort()).toEqual(ids);
    expect(fs.readdirSync(path.join(userData, 'backups')).filter(n => n.startsWith('plans-migration-'))).toHaveLength(1);
  });

  it('a failure in the middle leaves the old data intact and no plan behind; the next start does it', () => {
    seed();
    const before = fingerprints();
    const bad = migratePlans({ userData, brainRoot: brain, now: () => 5000, failMove: true });
    expect(bad.ran).toBe(false);
    expect(bad.error).toMatch(/simulato/);
    expect(fingerprints()).toEqual(before);
    expect(plansOn()).toEqual([]);
    expect(fs.readdirSync(userData).filter(n => n.startsWith('plans.migrating'))).toEqual([]);
    const again = migratePlans({ userData, brainRoot: brain, now: () => 7000 });
    expect(again.ran).toBe(true);
    expect(plansOn()).toHaveLength(4);
    expect(fingerprints()).toEqual(before);
  });

  it('nothing old, nothing done', () => {
    expect(migratePlans({ userData, brainRoot: brain })).toEqual({ ran: false });
    expect(migratePlans({ userData, brainRoot: null })).toEqual({ ran: false });
  });
});
