// One memory per agent (ADR 0077): the product memory writer's `agent` command adds one dated line to
// agents/<id>/memory.md, created on first use (never seeded), refuses ids that are not portable ids and multi-line text,
// and retains legacy history. Temp folders only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { command } from '../../../src/main/rules/cli';
import { writeAgentMemory } from '../../../src/main/rules/memory';

const dirs: string[] = [];
afterEach(() => { vi.useRealTimers(); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const brain = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-agent-mem-'))); dirs.push(d); fs.writeFileSync(path.join(d, 'brain.json'), '{"rules":{"topicFiles":[]}}'); return d; };

describe('agent memory writer', () => {
  it('creates the file on first use and adds dated lines once', () => {
    const root = brain();
    expect(command(['agent', root, 'default-writer', 'Il', 'cliente', 'Rossi', 'vuole', 'il', 'PDF'])).toEqual({ written: 'agents/default-writer/memory.md' });
    writeAgentMemory(root, 'default-writer', 'Il cliente Rossi vuole il PDF');
    const text = fs.readFileSync(path.join(root, 'agents/default-writer/memory.md'), 'utf8');
    expect(text.split('\n').filter(l => l.startsWith('- '))).toHaveLength(1);
    expect(text).toMatch(/^# Memoria\n\n- \d{4}-\d{2}-\d{2} · Il cliente Rossi vuole il PDF\n$/);
  });
  it('refuses traversal ids and multi-line text; retains all legacy lines', () => {
    const root = brain();
    expect(() => writeAgentMemory(root, '../x', 'a')).toThrow(/agent id/);
    expect(() => writeAgentMemory(root, 'a', 'riga\naltra')).toThrow();
    for (let i = 0; i < 305; i++) writeAgentMemory(root, 'a', `fatto ${i}`);
    const rows = fs.readFileSync(path.join(root, 'agents/a/memory.md'), 'utf8').split('\n').filter(l => l.startsWith('- '));
    expect(rows).toHaveLength(305);
    expect(rows[0]).toContain('fatto 0');
  });
  it('does not write another legacy line when a later-day proposal reuses an existing record', () => {
    const root = brain(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    writeAgentMemory(root, 'artisan', 'Database migrations use the local fixture.');
    const file = path.join(root, 'agents/artisan/memory.md'), before = fs.readFileSync(file, 'utf8');
    vi.setSystemTime(new Date('2026-02-01T00:00:00Z'));
    expect(writeAgentMemory(root, 'artisan', 'Database migrations use the local fixture.')).toBe('memory/records.json');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    fs.rmSync(file);
    writeAgentMemory(root, 'artisan', 'Database migrations use the local fixture.');
    expect(fs.existsSync(file)).toBe(false);
  });
});
