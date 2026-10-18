// Explicit-file session and cost readers. No home traversal, CLI execution, network access or inferred price tables.
import fs from 'node:fs';
import { mask } from './mask.mjs';

interface TranscriptRow { timestamp?: string; message?: { content?: string | { type: string; text?: string }[] }; total_cost_usd?: number }
export function readSession(file: string, query: string, limit = 10): { text: string; at: string | null }[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return records(file).flatMap(row => {
    const content = row.message?.content;
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter(c => c.type === 'text').map(c => c.text ?? '').join('\n') : '';
    if (!text || !words.every(w => text.toLowerCase().includes(w))) return [];
    return [{ text: mask(text).slice(0, 1000), at: row.timestamp ?? null }];
  }).slice(-Math.max(1, Math.min(100, limit)));
}
export function readCost(file: string): { reportedUsd: number | null; source: 'reported-session-total'; records: number } {
  const rows = records(file);
  const totals = rows.map(r => r.total_cost_usd).filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0);
  return { reportedUsd: totals.at(-1) ?? null, source: 'reported-session-total', records: rows.length };
}
function records(file: string): TranscriptRow[] {
  if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 20_000_000) throw new Error('Select a regular transcript no larger than 20 MB.');
  return fs.readFileSync(file, 'utf8').split('\n').flatMap(line => {
    try { const row: unknown = JSON.parse(line); return row && typeof row === 'object' && !Array.isArray(row) ? [row as TranscriptRow] : []; } catch { return []; }
  });
}
