// Validated single-line memory mutations for the product CLI; locks prevent lost updates between concurrent chats.
// One memory per agent (ADR 0077): agents/<id>/memory.md, written only through `agent <brain> <id> <text>`.
import fs from 'node:fs';
import path from 'node:path';
import { proposeMemory, type MemoryProposal } from './memory-records';
import { randomUUID } from 'node:crypto';
import { atomicWrite, confined, locked, read } from './storage';

function line(text: string, cap: number): string {
  if (!text.trim() || /[\x00-\x1f\x7f]/.test(text) || text.length > cap) throw new Error(`Use one nonempty line of at most ${cap} characters, without control characters.`);
  return text.trim();
}
export function writeNow(root: string, label: string, text: string, cap = 250): void {
  label = line(label, 80);
  if (/[\[\]*]/.test(label)) throw new Error('Use a plain chat label.');
  const entry = line(`- **${label}** · ${line(text, cap)}`, cap);
  locked(root, 'now.md', () => {
    const before = read(root, 'now.md') || '# Open threads\n\n';
    const prefix = `- **${label}** · `;
    const rows = before.trimEnd().split('\n');
    const matches = rows.map((v, i) => v.startsWith(prefix) ? i : -1).filter(i => i >= 0);
    if (matches.length > 1) throw new Error('Duplicate chat labels: resolve them before updating.');
    if (matches.length) rows[matches[0]!] = entry; else rows.push(entry);
    atomicWrite(root, 'now.md', rows.join('\n') + '\n');
  });
}
export function writeError(root: string, text: string, agent: string): void {
  const entry = `- ${new Date().toISOString().slice(0, 10)} | ${line(agent, 80)} | ${line(text, 1000)}`;
  locked(root, 'ai-errors.md', () => {
    const before = read(root, 'ai-errors.md') || '# AI errors\n\nDate | agent | correction and prevention\n\n';
    atomicWrite(root, 'ai-errors.md', before.trimEnd() + '\n' + entry + '\n');
  });
}
/** Proposes one fact, retaining the legacy Markdown for CLI compatibility without pruning historical lines. */
export function writeAgentMemory(root: string, agentId: string, text: string, provenance?: Pick<MemoryProposal, 'scope' | 'sourceEventId' | 'sourceRunId'>): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(agentId) || agentId.length > 64) throw new Error('Use the agent id given at launch.');
  const rel = `agents/${agentId}/memory.md`, entry = `- ${new Date().toISOString().slice(0, 10)} · ${line(text, 1000)}`;
  proposeMemory(root, { scope: { ...provenance?.scope, roleId: agentId }, subject: 'setup', predicate: 'note', value: line(text, 1000), sourceEventId: provenance?.sourceEventId ?? `untracked-write:${randomUUID()}`, sourceRunId: provenance?.sourceRunId ?? 'unknown' });
  fs.mkdirSync(path.dirname(confined(root, rel)), { recursive: true });
  if (provenance) return 'memory/records.json';
  locked(root, rel, () => {
    const before = read(root, rel) || '# Memoria\n\n';
    const lines = before.trimEnd().split('\n'), head = lines.filter(l => !l.startsWith('- ')), rows = lines.filter(l => l.startsWith('- '));
    if (rows.includes(entry)) return;
    atomicWrite(root, rel, `${head.join('\n').trim() || '# Memoria'}\n\n${[...rows, entry].join('\n')}\n`);
  });
  return rel;
}
