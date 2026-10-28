// Async, demand-driven reader for terminal run folders. It never opens a runtime, writes a file or schedules work.
// Only the selected run's events are cached; append reads avoid reparsing history on each live action (ADR 0179).
import fs from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { parseEvents, stepFolderName, type RunEvent, type RunRecord } from '../../../packages/routine-runtime/src/index';

const inside = (root: string, file: string) => { const rel = path.relative(root, file); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
export async function confined(root: string, file: string): Promise<string> {
  const [base, real] = await Promise.all([fs.realpath(root), fs.realpath(file)]);
  if (!inside(base, real)) throw new Error('Run file escapes its folder');
  return real;
}
async function files(dir: string, root: string, depth = 0, signal?: AbortSignal): Promise<string[]> {
  signal?.throwIfAborted();
  if (depth > 10) return [];
  try { await confined(root, dir); } catch { return []; }
  signal?.throwIfAborted();
  const rows = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const row of rows) {
    signal?.throwIfAborted();
    if (row.isSymbolicLink()) continue;
    const file = path.join(dir, row.name);
    if (row.isDirectory()) out.push(...await files(file, root, depth + 1, signal));
    else if (row.isFile()) { try { out.push(await confined(root, file)); } catch { /* never follow evidence outside the run */ } }
  }
  return out;
}
export function createRunReader() {
  let cache: { file: string; inode: number; offset: number; modified: number; tail: string; decoder: StringDecoder; events: RunEvent[] } | undefined;
  async function events(dir: string, signal?: AbortSignal): Promise<RunEvent[]> {
    signal?.throwIfAborted();
    const file = path.join(dir, 'events.jsonl');
    const stat = await fs.stat(file).catch(() => null); if (!stat) return [];
    await confined(dir, file);
    if (!cache || cache.file !== file || cache.inode !== stat.ino || stat.size < cache.offset || stat.size === cache.offset && stat.mtimeMs !== cache.modified) {
      cache = { file, inode: stat.ino, offset: 0, modified: 0, tail: '', decoder: new StringDecoder('utf8'), events: [] };
    }
    const current = cache;
    if (stat.size > current.offset) {
      signal?.throwIfAborted();
      const fd = await fs.open(file, 'r');
      try {
        // Chunk parsing yields to the event loop between reads, including the first open of a long history.
        while (current.offset < stat.size) {
          signal?.throwIfAborted();
          const buffer = Buffer.alloc(Math.min(64 * 1024, stat.size - current.offset));
          const { bytesRead } = await fd.read(buffer, 0, buffer.length, current.offset);
          if (!bytesRead) break;
          current.offset += bytesRead;
          const text = current.tail + current.decoder.write(buffer.subarray(0, bytesRead)), end = text.lastIndexOf('\n');
          if (end >= 0) current.events.push(...parseEvents(text.slice(0, end + 1)));
          current.tail = text.slice(end + 1);
          if (current.tail.length > 1024 * 1024) throw new Error('Malformed oversized routine event');
        }
      } finally { await fd.close(); }
    }
    current.modified = stat.mtimeMs;
    let actions = 0;
    const omitted = current.events.reduce((n, e) => n + (e.type === 'action' ? 1 : 0), 0) - 200;
    if (omitted > 0) current.events = current.events.filter(e => e.type !== 'action' || ++actions > omitted);
    // A screenshot event is evidence only within this run, never permission to read another local file.
    const safe: RunEvent[] = [];
    for (const event of current.events) {
      signal?.throwIfAborted();
      if (event.type !== 'screenshot') { safe.push(event); continue; }
      try { safe.push({ ...event, path: await confined(dir, path.resolve(dir, event.path)) }); } catch { /* missing or outside evidence */ }
    }
    return safe;
  }
  return {
    clear(): void { cache = undefined; },
    async read(dir: string, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const file = await confined(dir, path.join(dir, 'run.json'));
      const stat = await fs.stat(file); if (stat.size > 20 * 1024 * 1024) throw new Error('Run metadata exceeds 20 MiB');
      const record = JSON.parse(await fs.readFile(file, { encoding: 'utf8', ...(signal ? { signal } : {}) })) as RunRecord;
      if (record.schema !== 1 || !Array.isArray(record.steps)) throw new Error('Invalid run folder');
      const list = await events(dir, signal);
      const steps = [];
      for (const entry of record.steps) {
        signal?.throwIfAborted();
        const stepDir = path.join(dir, 'steps', stepFolderName(entry.n, entry.id, entry.round));
        if (!inside(dir, stepDir)) throw new Error('Invalid step folder');
        const [evidence, screenshots] = await Promise.all([files(path.join(stepDir, 'evidence'), dir, 0, signal), files(path.join(stepDir, 'screenshots'), dir, 0, signal)]);
        steps.push({ record: entry, dir: stepDir, evidence, screenshots });
      }
      return { run: record, steps, events: list };
    },
  };
}
