// Durable attribution of host work-item revisions. Detectors suppress only proven own changes; an uncertain write
// fences that item instead of creating a recursive routine. Human revisions interleaved with host writes remain eligible.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { renameRetrying } from './fs-util';
interface Entry { revisions: number[]; comments: number[]; pending: string[] }
type State = Record<string, Entry>;
export class UncertainWorkItem extends Error {}
export class DevOpsRevisions {
  constructor(private readonly file: string) {}
  private key(org: string, id: number) { return `${org.toLowerCase()}:${id}`; }
  private read(): State {
    if (!fs.existsSync(this.file)) return {};
    const stat = fs.lstatSync(this.file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 10 * 1024 * 1024) throw new Error('Unsafe DevOps revision journal');
    const data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as State;
    if (!data || Array.isArray(data) || Object.values(data).some(e => !Array.isArray(e.revisions) || !Array.isArray(e.comments) || !Array.isArray(e.pending))) throw new Error('Invalid DevOps revision journal');
    return data;
  }
  private change(org: string, id: number, mutate: (e: Entry) => void) {
    const data = this.read(), key = this.key(org, id), entry = data[key] ?? { revisions: [], comments: [], pending: [] }; mutate(entry); data[key] = entry;
    const content = JSON.stringify(data); if (content.length > 10 * 1024 * 1024) throw new Error('DevOps revision journal is full');
    fs.mkdirSync(path.dirname(this.file), { recursive: true }); const temp = `${this.file}.${randomUUID()}.tmp`;
    const fd = fs.openSync(temp, 'wx', 0o600); try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } renameRetrying(temp, this.file);
  }
  pending(org: string, id: number, operation: string) { this.change(org, id, e => { if (!e.pending.includes(operation)) e.pending.push(operation); }); }
  done(org: string, id: number, operation: string) { this.change(org, id, e => { e.pending = e.pending.filter(p => p !== operation); }); }
  revision(org: string, id: number, rev: number) { if (!Number.isSafeInteger(rev) || rev < 1) throw new Error('Invalid host work-item revision'); this.change(org, id, e => { if (!e.revisions.includes(rev)) e.revisions.push(rev); }); }
  comment(org: string, id: number, comment: number) { if (!Number.isSafeInteger(comment) || comment < 1) throw new Error('Invalid host comment receipt'); this.change(org, id, e => { if (!e.comments.includes(comment)) e.comments.push(comment); }); }
  async externalRevision(org: string, id: number, previous: number, latest: number, read: (revision: number) => Promise<Record<string, unknown>>): Promise<number | null> {
    const entry = this.read()[this.key(org, id)]; if (!entry) return latest;
    if (entry.pending.length) throw new UncertainWorkItem('A routine write has an uncertain outcome; reconcile this work item before detection resumes');
    const first = previous > 0 ? previous + 1 : latest;
    if (latest - first > 100) throw new Error('Too many intervening revisions; inspect work-item history before detection resumes');
    let external: number | null = null;
    for (let rev = first; rev <= latest; rev++) {
      if (entry.revisions.includes(rev)) continue;
      if (!entry.comments.length) { external = rev; continue; }
      const row = await read(rev), ref = row.commentVersionRef as Record<string, unknown> | undefined;
      if (row.id !== id || row.rev !== rev) throw new Error('Unexpected work-item revision identity');
      if (ref && ref.version === 1 && ref.isDeleted !== true && ref.createdInRevision === rev && entry.comments.includes(Number(ref.commentId))) { this.revision(org, id, rev); continue; }
      external = rev;
    }
    return external;
  }
}
