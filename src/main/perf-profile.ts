// A CPU profile of the main process taken by itself when the window freezes (owner's perf log 2026-11-02: most stalls
// are unlabelled, steps:[] with cpuMs close to the stall, so the code that runs in them has no name). The first stall
// of STALL_PROFILE_MS or more starts the V8 sampling profiler in-process (node:inspector, no --inspect flag needed);
// the freezes repeat every few seconds, so the next PROFILE_MS of them are recorded and saved as
// <logs>/profiles/main-<time>.cpuprofile (Chrome DevTools → Performance → Load profile, or
// `node scripts/profile-top.mjs <file>`). At most MAX_PER_RUN profiles per app run, at most KEEP files on disk, a pause
// of PROFILE_GAP_MS between two: the profiler costs CPU only while it records. Never throws.
import fs from 'node:fs';
import path from 'node:path';
import { Session } from 'node:inspector';
import { errText, log } from './log';

export const STALL_PROFILE_MS = 400;
const PROFILE_MS = 60_000;
const PROFILE_GAP_MS = 10 * 60_000;
const MAX_PER_RUN = 3;
const KEEP = 6;

let session: Session | null = null, recording = false, taken = 0, lastEnd = -Infinity;

/** A stall of `ms` (perf.ts startStallWatch): the first long one starts a recording. */
export function stallSeen(ms: number, now = Date.now()): void {
  if (ms < STALL_PROFILE_MS || recording || taken >= MAX_PER_RUN || now - lastEnd < PROFILE_GAP_MS) return;
  if (process.env.SB_PROFILE_ON_STALL === '0') return;
  const dir = log.folder ? path.join(log.folder, 'profiles') : null;
  if (!dir) return;
  recording = true; taken++;
  try {
    session ??= (() => { const s = new Session(); s.connect(); return s; })();
    const s = session;
    s.post('Profiler.enable', () => s.post('Profiler.setSamplingInterval', { interval: 1000 }, () => s.post('Profiler.start', err => {
      if (err) { recording = false; log.warn('perf', 'cpu profile not started', { cause: errText(err) }); return; }
      log.info('perf', 'cpu profile started', { data: { afterStallMs: Math.round(ms), forMs: PROFILE_MS } });
      const t = setTimeout(() => s.post('Profiler.stop', (e, res) => {
        recording = false; lastEnd = Date.now();
        s.post('Profiler.disable');
        if (e || !res?.profile) { log.warn('perf', 'cpu profile not saved', { cause: errText(e ?? 'no profile') }); return; }
        void save(dir, res.profile);
      }), PROFILE_MS);
      t.unref?.();
    })));
  } catch (e) { recording = false; log.warn('perf', 'cpu profile not started', { cause: errText(e), hint: 'set SB_PROFILE_ON_STALL=0 to turn it off' }); }
}

async function save(dir: string, profile: object): Promise<void> {
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, `main-${new Date().toISOString().replace(/[:.]/g, '-')}.cpuprofile`);
    await fs.promises.writeFile(file, JSON.stringify(profile));
    const old = (await fs.promises.readdir(dir)).filter(f => f.endsWith('.cpuprofile')).sort().slice(0, -KEEP);
    for (const f of old) await fs.promises.rm(path.join(dir, f), { force: true });
    log.warn('perf', 'cpu profile of a freeze saved', { data: { file }, hint: 'node scripts/profile-top.mjs <file> lists the functions that used the main thread; or open it in Chrome DevTools' });
  } catch (e) { log.warn('perf', 'cpu profile not saved', { cause: errText(e) }); }
}
