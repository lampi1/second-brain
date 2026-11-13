// The Routine section's demo data (SB_DEMO): two packages and four run folders (an app run waiting for a person on
// DevOps, a finished one with its report, one still running, a failed terminal run) written under the demo userData,
// then read by the real routines service. No engine, no DevOps: starts are refused and the trigger loop is inert.
// Used by index.ts for `npm run demo`, the README shots and the Routine e2e spec.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { ROUTINE_FORMAT, stepFolderName, type RoutinePackage, type RunEvent, type RunRecord } from '../../../packages/routine-runtime/src/index';
import { createRoutines, type RoutinesOptions } from './service';
import { SECRET_PLACEHOLDER } from './store';

const CRC = (() => { const t: number[] = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t.push(c >>> 0); } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
/** A small PNG of a fake web page (header bar, form, a red error box): the demo's step screenshot. */
function demoShot(): Buffer {
  const w = 480, h = 300, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      let c = [244, 246, 250];
      if (y < 40) c = [33, 87, 160];
      else if (x > 40 && x < 440 && y > 70 && y < 100) c = [255, 255, 255];
      else if (x > 40 && x < 440 && y > 120 && y < 150) c = [255, 255, 255];
      else if (x > 40 && x < 300 && y > 180 && y < 230) c = [252, 226, 226];
      else if (x > 40 && x < 140 && y > 250 && y < 280) c = [33, 87, 160];
      raw.set(c, y * (w * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const STEPS = [
  { id: 'reproduce', title: 'Riproduci il bug su test' },
  { id: 'fix', title: 'Correggi e apri la PR' },
  { id: 'verify', title: 'Verifica su test' },
  { id: 'devops', title: 'Aggiorna il work item' },
];

const ORG = 'demo-org', PROJECT = 'Air';

export function demoPackages(): RoutinePackage[] {
  const trigger = { kind: 'devops' as const, everyMinutes: 5, organization: ORG, project: PROJECT, areaPath: 'Air\\Clinica', workItemType: 'Bug', states: ['New'], includeExisting: false, includeTags: ['ai-fixable'], maxPerHour: 4 };
  return [{
    format: ROUTINE_FORMAT, schemaVersion: 1,
    routine: {
      id: 'air-bugfix', title: 'Air · bugfix ai-fixable', description: 'Riproduce un bug di Air su test, lo corregge, apre la PR e aggiorna il work item.',
      inputs: [{ name: 'workItem', label: 'Work item', required: true }],
      steps: STEPS.map(s => ({ ...s, prompt: `${s.title} per il work item {{workItem}}.`, model: 'claude-sonnet-5', ...(s.id === 'verify' ? { mcpServers: ['playwright'], testDbs: ['air-test'] } : {}) })),
      trigger, devops: { organization: ORG, projects: [PROJECT], ops: ['comment', 'tags', 'state'], fields: [] },
      escalation: { contact: randomUUID(), contactName: 'Giulia Verdi' },
      mcpServers: { playwright: { command: 'npx', args: ['@playwright/mcp'] } },
      testDbs: [{ id: 'air-test', server: 'sql-test.example', database: 'AirTest', confirmedTestDatabase: true }],
    },
    credentials: [{ loginUrl: 'https://air-test.example/login?mode=local', user: 'demo.user', password: 'demo-only' }],
    secrets: { testDbs: { 'air-test': { user: 'reader', password: 'demo-only' } } },
  }, {
    format: ROUTINE_FORMAT, schemaVersion: 1,
    routine: {
      id: 'release-notes', title: 'Note di rilascio', description: 'Raccoglie i work item chiusi dello sprint e scrive le note di rilascio.',
      inputs: [], steps: [{ id: 'collect', title: 'Raccogli i work item', prompt: 'Raccogli i work item chiusi.' }, { id: 'write', title: 'Scrivi le note', prompt: 'Scrivi le note.' }],
    },
    secrets: { devopsPat: SECRET_PLACEHOLDER },
  }];
}

interface DemoRun { root: string; record: RunRecord; events: RunEvent[]; report?: string; shotStep?: number }
function demoRuns(now: number, appRuns: string, terminalRuns: string): DemoRun[] {
  const min = 60_000, title = 'Air · bugfix ai-fixable';
  const step = (n: number, status: RunRecord['steps'][number]['status'], extra: Partial<RunRecord['steps'][number]> = {}) => ({ n, id: STEPS[n - 1]!.id, title: STEPS[n - 1]!.title, status, attempts: status === 'pending' ? 0 : 1, ...extra });
  const url = (wi: number) => `https://dev.azure.com/${ORG}/${PROJECT}/_workitems/edit/${wi}`;
  const start = (at: number, wi: number): RunEvent => ({ type: 'run-start', at, runId: '', routine: 'air-bugfix', total: 4, workItem: wi });
  const begin = (at: number, n: number): RunEvent => ({ type: 'step-start', at, n, total: 4, id: STEPS[n - 1]!.id, title: STEPS[n - 1]!.title, attempt: 1 });
  const end = (at: number, n: number, summary: string): RunEvent => ({ type: 'step-end', at, n, id: STEPS[n - 1]!.id, status: 'done', summary });
  const base = (runId: string, wi: number, createdAt: number) => ({ schema: 1 as const, runId, routineId: 'air-bugfix', routineTitle: title, attempt: 1, inputs: { workItem: String(wi) }, workItem: wi, createdAt, updatedAt: createdAt });
  const waitingAt = now - 12 * min;
  return [{
    root: terminalRuns, shotStep: 2,
    record: { ...base('20261027-091500-a1b2c3', 48213, now - 40 * min), status: 'waiting-human', updatedAt: waitingAt,
      steps: [step(1, 'done', { summary: 'Bug riprodotto su test: il salvataggio del piano di cura perde lo sconto.', startedAt: now - 40 * min, endedAt: now - 28 * min }), step(2, 'running', { startedAt: now - 28 * min }), step(3, 'pending'), step(4, 'pending')],
      escalation: { stepId: 'fix', contact: randomUUID(), state: 'waiting', at: waitingAt, question: 'Lo sconto va applicato prima o dopo l’IVA? Il codice e la specifica non concordano.', commentId: 9001, ignored: [], count: 1 } },
    events: [start(now - 40 * min, 48213), begin(now - 40 * min, 1), { type: 'action', at: now - 35 * min, n: 1, text: 'Apre il piano di cura del paziente demo' }, end(now - 28 * min, 1, 'Bug riprodotto'),
      begin(now - 28 * min, 2), { type: 'action', at: now - 20 * min, n: 2, text: 'Legge TreatmentPlanService.ApplyDiscount' }, { type: 'action', at: now - 14 * min, n: 2, text: 'Confronta la specifica del work item con il calcolo attuale' },
      { type: 'waiting-human', at: waitingAt, n: 2, url: `${url(48213)}#9001`, question: 'Lo sconto va applicato prima o dopo l’IVA? Il codice e la specifica non concordano.' }],
  }, {
    root: appRuns, shotStep: 3,
    record: { ...base('20261027-071000-d4e5f6', 48190, now - 180 * min), status: 'done', updatedAt: now - 95 * min, endedAt: now - 95 * min,
      steps: [step(1, 'done', { summary: 'Riprodotto', startedAt: now - 180 * min, endedAt: now - 165 * min }), step(2, 'done', { summary: 'PR aperta: fix arrotondamento importi', startedAt: now - 165 * min, endedAt: now - 130 * min, writes: ['PR collegata al work item'] }),
        step(3, 'done', { summary: 'Verificato su test con il paziente demo', startedAt: now - 130 * min, endedAt: now - 105 * min, testDb: 'available' }), step(4, 'done', { summary: 'Commento e tag scritti', startedAt: now - 105 * min, endedAt: now - 95 * min, writes: ['commento di esito', 'tag ai-fixed'], notVerified: ['stato Resolved'] })] },
    events: [start(now - 180 * min, 48190), begin(now - 180 * min, 1), end(now - 165 * min, 1, 'Riprodotto'), begin(now - 165 * min, 2), end(now - 130 * min, 2, 'PR aperta'), begin(now - 130 * min, 3), end(now - 105 * min, 3, 'Verificato'),
      begin(now - 105 * min, 4), { type: 'write', at: now - 100 * min, n: 4, what: 'commento di esito', status: 'done' }, { type: 'write', at: now - 98 * min, n: 4, what: 'stato Resolved', status: 'not-verified' }, end(now - 95 * min, 4, 'Commento e tag scritti'), { type: 'run-end', at: now - 95 * min, status: 'done' }],
    report: '# Air · bugfix ai-fixable · work item 48190\n\nEsito: **fatto**.\n\n## Passi\n\n1. Riproduci il bug su test: riprodotto.\n2. Correggi e apri la PR: PR aperta (fix arrotondamento importi).\n3. Verifica su test: verificato con il paziente demo.\n4. Aggiorna il work item: commento e tag scritti.\n\n## Non verificato\n\n- stato Resolved (DevOps non ha confermato la scrittura)\n',
  }, {
    root: terminalRuns,
    record: { ...base('20261027-100200-0a0b0c', 48231, now - 6 * min), status: 'running', updatedAt: now - min, steps: [step(1, 'running', { startedAt: now - 6 * min }), step(2, 'pending'), step(3, 'pending'), step(4, 'pending')] },
    events: [start(now - 6 * min, 48231), begin(now - 6 * min, 1), { type: 'action', at: now - min, n: 1, text: 'Accede ad Air test (login locale)' }],
  }, {
    root: terminalRuns,
    record: { ...base('20261026-163000-112233', 48177, now - 20 * 60 * min), status: 'failed', updatedAt: now - 19 * 60 * min, endedAt: now - 19 * 60 * min, error: 'Login su Air test non riuscito: credenziali rifiutate',
      steps: [step(1, 'failed', { error: 'Login su Air test non riuscito', startedAt: now - 20 * 60 * min, endedAt: now - 19 * 60 * min }), step(2, 'pending'), step(3, 'pending'), step(4, 'pending')] },
    events: [start(now - 20 * 60 * min, 48177), begin(now - 20 * 60 * min, 1), { type: 'step-end', at: now - 19 * 60 * min, n: 1, id: 'reproduce', status: 'failed', error: 'Login su Air test non riuscito' }, { type: 'run-end', at: now - 19 * 60 * min, status: 'failed', error: 'Login su Air test non riuscito: credenziali rifiutate' }],
  }];
}

/** The demo routines service, its folders re-seeded at each app start. */
export function createDemoRoutines(userData: string, now: number, changed?: RoutinesOptions['changed']) {
  const root = path.join(userData, 'demo-routines');
  fs.rmSync(root, { recursive: true, force: true });
  const appRuns = path.join(root, 'app'), terminalRuns = path.join(root, 'terminal');
  const shot = demoShot();
  for (const run of demoRuns(now, path.join(appRuns, 'routine-runs'), terminalRuns)) {
    const dir = path.join(run.root, run.record.routineId, run.record.runId);
    fs.mkdirSync(dir, { recursive: true });
    const events = run.events.map(e => e.type === 'run-start' ? { ...e, runId: run.record.runId } : e);
    if (run.shotStep) {
      const s = run.record.steps[run.shotStep - 1]!, file = path.join(dir, 'steps', stepFolderName(s.n, s.id), 'screenshots', '01-air.png');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, shot);
      const at = events.find(e => e.type === 'step-start' && e.n === s.n)!.at + 60_000;
      events.splice(events.findIndex(e => e.type === 'step-start' && e.n === s.n) + 1, 0, { type: 'screenshot', at, n: s.n, path: file });
    }
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(run.record, null, 2));
    fs.writeFileSync(path.join(dir, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
    if (run.report) fs.writeFileSync(path.join(dir, 'report.md'), run.report);
  }
  const routines = createRoutines({ userData: appRuns, terminalRuns, ...(changed ? { changed } : {}) });
  for (const pkg of demoPackages()) routines.store.save(pkg);
  return routines;
}
