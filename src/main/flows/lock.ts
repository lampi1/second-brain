// The routine runner's lock (ADR 0154): one runner per flow store, so two app instances (or a dev clone next to the
// installed app on the same userData) never advance the same runs twice. A file with the holder's pid and a heartbeat;
// a lock whose process is gone or whose heartbeat is older than a minute is taken over. Used by runtime.ts.
// Unit tests: test/unit/flows/lock.test.ts.
import fs from 'node:fs';
import path from 'node:path';

const STALE_MS = 60_000;
interface Held { pid: number; at: number; token: string }
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; } };

export class RunnerLock {
  private readonly token = `${process.pid}:${Math.random().toString(36).slice(2)}`;
  constructor(private readonly file: string, private readonly now: () => number = Date.now) {}
  /** Takes or refreshes the lock; false = another live runner holds it. */
  hold(): boolean {
    const held = this.read(), data = JSON.stringify({ pid: process.pid, at: this.now(), token: this.token } satisfies Held);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (held?.token === this.token) {
      // ours: refresh the heartbeat in place (atomic rename; no other runner writes while we hold it)
      const temp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, data); fs.renameSync(temp, this.file);
      return true;
    }
    if (held && alive(held.pid) && this.now() - held.at < STALE_MS) return false;
    // free or stale: remove the old file, then create it exclusively, so of two runners racing only one wins
    const again = this.read();
    if (again && again.token !== held?.token) return false; // another runner just took it
    if (again || fs.existsSync(this.file)) { try { fs.unlinkSync(this.file); } catch { /* the other runner got there first */ } }
    try { fs.writeFileSync(this.file, data, { flag: 'wx' }); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
  }
  release(): void { if (this.read()?.token === this.token) { try { fs.unlinkSync(this.file); } catch { /* already gone */ } } }
  private read(): Held | null {
    try { const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Held; return Number.isSafeInteger(raw.pid) && Number.isSafeInteger(raw.at) && typeof raw.token === 'string' ? raw : null; }
    catch { return null; }
  }
}
