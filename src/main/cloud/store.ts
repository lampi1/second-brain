// What the app remembers of cloud agents (ADR 0080), in <userData>/cloud-agents.json: the agents it knows (Claude's
// only ever come from here: no vendor list), the Codex environment chosen per repo, the ids the user dismissed, the
// last spend read per Cursor agent and this day's Cursor cloud spend (counted in the budget). No prompt, no key, no
// transcript: messages live in memory only. Written atomically; an unreadable file starts empty. Used by service.ts.
import fs from 'node:fs';
import path from 'node:path';
import { isCloudEngine, type CloudAgent } from '../../shared/cloud';
import { errText, log } from '../log';

export interface CloudFile {
  version: 1;
  agents: CloudAgent[];
  envs: Record<string, string>;
  dismissed: string[];
  lastCost: Record<string, number>;
  spend: { day: string; usd: number };
}

const KEEP = 80;
const empty = (): CloudFile => ({ version: 1, agents: [], envs: {}, dismissed: [], lastCost: {}, spend: { day: '', usd: 0 } });

export class CloudStore {
  data: CloudFile;
  constructor(private readonly file: string | null) { this.data = this.read(); }

  private read(): CloudFile {
    if (!this.file) return empty();
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<CloudFile>;
      const d = empty();
      if (Array.isArray(raw.agents)) d.agents = raw.agents.filter(a => a && typeof a.id === 'string' && isCloudEngine(a.engine)).map(({ messages: _m, ...a }) => a).slice(0, KEEP);
      if (raw.envs && typeof raw.envs === 'object') for (const [k, v] of Object.entries(raw.envs)) if (typeof v === 'string') d.envs[k] = v;
      if (Array.isArray(raw.dismissed)) d.dismissed = raw.dismissed.filter(x => typeof x === 'string').slice(-200);
      if (raw.lastCost && typeof raw.lastCost === 'object') for (const [k, v] of Object.entries(raw.lastCost)) if (typeof v === 'number' && v >= 0) d.lastCost[k] = v;
      if (raw.spend && typeof raw.spend.day === 'string' && typeof raw.spend.usd === 'number') d.spend = { day: raw.spend.day, usd: raw.spend.usd };
      return d;
    } catch { return empty(); }
  }

  save(): void {
    if (!this.file) return;
    this.data.agents = this.data.agents.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, KEEP);
    const out: CloudFile = { ...this.data, agents: this.data.agents.map(({ messages: _m, ...a }) => a) };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(out));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      log.warn('cloud', 'cloud agents not saved', { data: errText(e), cause: 'cloud-agents.json not writable', hint: 'check that the app data folder is writable' });
    }
  }
}
