// The maintenance's findings and runs (ADR 0132, 0149), kept in userData/maintenance-research.json: every card a research
// or the free cleanup proposed (open, approved with its change or its issue's link, rejected; issue-asked and dismissed
// from the old «Idee dell'app» tab), the last researches with their cost and the last click's end (the button shows it,
// and the time of the last click holds back the cards other parts of the app propose, ADR 0149). Decided
// cards older than 90 days are dropped; at most 400 cards and 30 runs. Used by research.ts; tests:
// test/unit/brainmodel/research.test.ts.
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { RESEARCH_KINDS, type MaintenanceDone, type ResearchProposal, type ResearchRunInfo } from '../../shared/maintenance-research';
import { readLocal, writeLocal } from '../agents/local-store';
import { errText, log } from '../log';

const KEEP_MS = 90 * 86_400_000;
const MAX_CARDS = 400;
const MAX_RUNS = 30;

interface Data { version: 1; proposals: ResearchProposal[]; runs: ResearchRunInfo[]; lastDone?: MaintenanceDone; clickAt?: number }

export const researchId = (now: number): string => `r-${now.toString(36)}-${randomBytes(3).toString('hex')}`;

export class ResearchStore {
  private readonly file: string;
  private data: Data;
  constructor(userData: string, private readonly now: () => number = Date.now) {
    this.file = path.join(userData, 'maintenance-research.json');
    let raw: Partial<Data> | undefined;
    try { raw = readLocal(this.file) as Partial<Data> | undefined; }
    catch (e) { log.warn('brain', 'maintenance findings not read', { cause: errText(e), hint: 'the file is kept as it is; new findings start a new list' }); }
    this.data = {
      version: 1,
      proposals: Array.isArray(raw?.proposals) ? raw.proposals.filter(p => !!p && typeof p.id === 'string' && (RESEARCH_KINDS as readonly string[]).includes(p.kind)) : [],
      runs: Array.isArray(raw?.runs) ? raw.runs.filter(r => !!r && typeof r.chatId === 'string') : [],
      ...(raw?.lastDone && typeof raw.lastDone.at === 'number' ? { lastDone: raw.lastDone } : {}),
      ...(typeof raw?.clickAt === 'number' ? { clickAt: raw.clickAt } : {}),
    };
  }
  private save(): void {
    const cut = this.now() - KEEP_MS;
    this.data.proposals = this.data.proposals.filter(p => p.state === 'open' || (p.decidedAt ?? p.at) >= cut).slice(-MAX_CARDS);
    this.data.runs = this.data.runs.slice(-MAX_RUNS);
    writeLocal(this.file, this.data);
  }
  all(): ResearchProposal[] { return structuredClone(this.data.proposals); }
  get(id: string): ResearchProposal | undefined { const p = this.data.proposals.find(x => x.id === id); return p ? structuredClone(p) : undefined; }
  add(p: Omit<ResearchProposal, 'id' | 'at' | 'state'>): ResearchProposal {
    const at = this.now(), card: ResearchProposal = { ...p, id: researchId(at), at, state: 'open' };
    this.data.proposals.push(card);
    this.save();
    return structuredClone(card);
  }
  /** A research's better version of an open card (an app bug the log step wrote from a log group): same id, new words. */
  replace(id: string, p: Omit<ResearchProposal, 'id' | 'at' | 'state'>): ResearchProposal | undefined {
    const i = this.data.proposals.findIndex(x => x.id === id && x.state === 'open');
    if (i < 0) return undefined;
    this.data.proposals[i] = { ...p, id, at: this.now(), state: 'open' };
    this.save();
    return structuredClone(this.data.proposals[i]);
  }
  update(id: string, patch: Partial<Pick<ResearchProposal, 'state' | 'decidedAt' | 'changeId' | 'issueUrl' | 'ideaSaved'>>): ResearchProposal | undefined {
    const p = this.data.proposals.find(x => x.id === id);
    if (!p) return undefined;
    Object.assign(p, patch);
    this.save();
    return structuredClone(p);
  }
  runs(): ResearchRunInfo[] { return structuredClone(this.data.runs); }
  saveRun(r: ResearchRunInfo): void {
    const i = this.data.runs.findIndex(x => x.chatId === r.chatId);
    if (i >= 0) this.data.runs[i] = structuredClone(r); else this.data.runs.push(structuredClone(r));
    this.save();
  }
  lastDone(): MaintenanceDone | undefined { return this.data.lastDone ? structuredClone(this.data.lastDone) : undefined; }
  setLastDone(d: MaintenanceDone): void { this.data.lastDone = structuredClone(d); this.save(); }
  /** When the user last pressed «Manutenzione» (ms), null = never. */
  clickAt(): number | null { return this.data.clickAt ?? null; }
  setClickAt(at: number): void { this.data.clickAt = at; this.save(); }
}
