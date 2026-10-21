// Durable invalidation outbox: memory reviews cannot leave searchable stale copies after sync failure or restart.
// Entries contain paths only; each acknowledgement removes only its own generation, preserving concurrent reviews.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWrite, confined, locked, read } from './storage';
const FILE = 'memory/pending-invalidations.json';
interface Entry { id: string; paths: string[] }
export function pendingMemoryInvalidations(root: string): Entry[] {
  const raw = read(root, FILE);
  const entries: unknown = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(entries) || entries.some(e => !e || typeof e.id !== 'string' || !Array.isArray(e.paths) || e.paths.some((p: unknown) => typeof p !== 'string'))) throw new Error('Invalid memory invalidation queue.');
  return entries as Entry[];
}
export function queueMemoryInvalidation(root: string, paths: string[]): void {
  fs.mkdirSync(path.dirname(confined(root, FILE)), { recursive: true });
  locked(root, FILE, () => {
    const entries = pendingMemoryInvalidations(root);
    if (entries.length >= 1024) throw new Error('Retry pending memory invalidations first.');
    entries.push({ id: randomUUID(), paths: [...new Set(paths)] });
    const text = JSON.stringify(entries);
    if (Buffer.byteLength(text) > 2_000_000) throw new Error('Memory invalidation queue full.');
    atomicWrite(root, FILE, text);
  });
}
export function acknowledgeMemoryInvalidations(root: string, ids: string[]): void {
  locked(root, FILE, () => {
    const done = new Set(ids);
    atomicWrite(root, FILE, JSON.stringify(pendingMemoryInvalidations(root).filter(e => !done.has(e.id))));
  });
}
