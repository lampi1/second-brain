// The log step of the maintenance (#150, brainmodel/log-scan.ts): warn and error lines after `since`, grouped by
// scope | msg | cause with numbers folded; a known group is flagged and left out of the Orchestrator's message.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { groupKey, handoffText, scanLogs } from '../../../src/main/brainmodel/log-scan';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('scanLogs', () => {
  it('folds numbers, flags known groups, reads only after since, and keeps the known ones out of the hand-off', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-logscan-')); dirs.push(dir);
    const l = (t: string, lvl: string, msg: string, cause = '') => JSON.stringify({ t, lvl, scope: 's', msg, cause });
    fs.writeFileSync(path.join(dir, 'app-2026-10-20.jsonl'), [l('2026-10-20T10:00:00Z', 'warn', 'old one')].join('\n'));
    fs.writeFileSync(path.join(dir, 'app-2026-10-21.jsonl'), [
      l('2026-10-21T10:00:00Z', 'warn', 'pid 31900 died', 'code 1'), l('2026-10-21T10:01:00Z', 'warn', 'pid 42 died', 'code 2'),
      l('2026-10-21T10:02:00Z', 'warn', 'thinking_tokens drift'),
    ].join('\n'));
    const known = new Set([groupKey('s', 'thinking_tokens drift', '')]);
    const scan = scanLogs(dir, Date.parse('2026-10-21T00:00:00Z'), known, Date.parse('2026-10-21T12:00:00Z'));
    expect(scan.files).toEqual([path.join(dir, 'app-2026-10-21.jsonl')]);
    expect(scan.groups.map(g => [g.msg, g.count, !!g.known])).toEqual([['pid 31900 died', 2, false], ['thinking_tokens drift', 1, true]]);
    const text = handoffText({ jobs: [{ job: 'migration', changes: 0 }] }, scan);
    expect(text).toContain('1 gruppo, 1 noto ignorato');
    expect(text).not.toContain('thinking_tokens');
    expect(text).toContain('migrazione: niente da fare');
  });
});
