// Unit tests of the user's corrections counted by the app (src/main/brain/user-corrections.ts, ADR 0197): the message
// classes (tag, after a report, recognised by the semantic detector or the hook's regex, a question never), the regex
// copy equal to the brain template's, the per-day store (counts only, never the text; the after-report callback; the
// file round trip) and the runs' own counters by day.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs from the brain template, no types
import { CORRECTION as TEMPLATE_CORRECTION } from '../../../brain-template/ops/tools/signals-regex.mjs';
import { CORRECTION, classifyMessage, ownWords, parseDays, runCorrectionsByDay, UserCorrectionStore } from '../../../src/main/brain/user-corrections';
import { CORRECTION_TAG } from '../../../src/shared/correction';
import type { AgentRun } from '../../../src/shared/agents';

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ucorr-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('classifyMessage', () => {
  it('the regex is the brain template\'s, character for character', () => {
    expect(CORRECTION.source).toBe((TEMPLATE_CORRECTION as RegExp).source);
    expect(CORRECTION.flags).toBe((TEMPLATE_CORRECTION as RegExp).flags);
  });

  it('the «Correggi il pensiero» tag comes first', async () => {
    expect(await classifyMessage(`${CORRECTION_TAG}\nUsa la tabella giusta.`, true)).toEqual({ kind: 'tagged', semantic: false });
  });

  it('without the semantic model: the hook\'s regex decides; after a report it is its own bucket', async () => {
    expect((await classifyMessage('No, non va: il totale è sbagliato.', false)).kind).toBe('recognized');
    expect((await classifyMessage('No, non va: il totale è sbagliato.', true)).kind).toBe('afterReport');
    expect((await classifyMessage('Aggiungi la colonna data al report.', false)).kind).toBe('none');
  });

  it('a question is not an error: «non capisco», «spiegami» never count', async () => {
    expect((await classifyMessage('Non capisco, spiegami questa parte', false)).kind).toBe('none');
  });

  it('the semantic yes adds what the regex misses; not ready falls back to the regex; a failure too', async () => {
    const yes = async () => ({ ready: true, correction: true }), notReady = async () => ({ ready: false, correction: false });
    expect(await classifyMessage('Il numero che mi hai dato è quello dell\'anno scorso', false, yes)).toEqual({ kind: 'recognized', semantic: true });
    expect((await classifyMessage('Il numero che mi hai dato è quello dell\'anno scorso', false, notReady)).kind).toBe('none');
    expect((await classifyMessage('Ti ho detto di non toccare main', false, async () => { throw new Error('busy'); })).kind).toBe('recognized');
  });

  it('the app\'s bracketed notes are not his words', () => {
    expect(ownWords('[Message from the second-brain app, not written by the user]\n\nok procedi')).toBe('ok procedi');
  });
});

describe('UserCorrectionStore', () => {
  it('counts per Rome day, keeps chat titles but never the text, and calls back for an after-report correction', async () => {
    const file = path.join(tmp(), 'user-corrections.json');
    const now = Date.parse('2026-10-29T10:00:00Z');
    const s = new UserCorrectionStore({ file, runs: () => [], now: () => now });
    const after: string[] = [];
    await s.note('No, è sbagliato: segreto-123', { title: 'Fix login', reportedRunId: 'r_1' }, id => after.push(id));
    await s.note('Grazie, procedi', { title: 'Fix login', reportedRunId: null });
    await s.note(`${CORRECTION_TAG}\nnon così`, { title: 'Report', reportedRunId: null });
    s.flush();
    const text = fs.readFileSync(file, 'utf8');
    expect(text).not.toContain('segreto');
    // the bare regex counts the day, never the run: its afterReport needs the tag or a semantic yes
    expect(after).toEqual([]);
    const back = parseDays(text);
    expect(back.since).toBe('2026-10-29');
    expect(back.days).toEqual([{ date: '2026-10-29', messages: 3, tagged: 1, afterReport: 1, recognized: 0, semantic: 0, chats: ['Fix login', 'Report'] }]);
    expect(back.afterReportSince).toBe(now);
    // a new store reads it back, the start of the runs' counting included
    const again = new UserCorrectionStore({ file, runs: () => [], now: () => now + 86_400_000 });
    expect(again.summary().byDay[0]!.messages).toBe(3);
    expect(again.afterReportSince()).toBe(now);
  });

  it('a semantic yes after a report reaches the run; a plain «no» to a question by the regex alone does not', async () => {
    const file = path.join(tmp(), 'user-corrections.json');
    const after: string[] = [];
    const yes = new UserCorrectionStore({ file, runs: () => [], detect: async () => ({ ready: true, correction: true }) });
    await yes.note('Il totale è quello dell\'anno scorso', { title: 'Report', reportedRunId: 'r_2' }, id => after.push(id));
    const cold = new UserCorrectionStore({ file: path.join(tmp(), 'u.json'), runs: () => [], detect: async () => ({ ready: false, correction: false }) });
    expect((await cold.note('no', { title: 'PR', reportedRunId: 'r_3' }, id => after.push(id))).kind).toBe('afterReport'); // the day still counts it
    const said = new UserCorrectionStore({ file: path.join(tmp(), 'v.json'), runs: () => [], detect: async () => ({ ready: true, correction: false }) });
    await said.note('no', { title: 'PR', reportedRunId: 'r_4' }, id => after.push(id));
    expect(after).toEqual(['r_2']);
  });

  it('an unreadable file starts again, and the summary carries the runs\' counters', () => {
    const file = path.join(tmp(), 'user-corrections.json');
    fs.writeFileSync(file, '{not json');
    const runs = [{ startedAt: Date.parse('2026-10-20T08:00:00Z'), corrections: { tagged: 2, afterReport: 1 } }, { startedAt: Date.parse('2026-10-20T09:00:00Z') }] as AgentRun[];
    const s = new UserCorrectionStore({ file, runs: () => runs });
    expect(s.summary()).toEqual({ since: null, byDay: [], runs: [{ date: '2026-10-20', tagged: 2, afterReport: 1 }] });
  });

  it('runs without counters are unknown, not zero: left out', () => {
    expect(runCorrectionsByDay([{ startedAt: 0, corrections: { tagged: 0, afterReport: 0 } }, { startedAt: 0 }] as AgentRun[])).toEqual([]);
  });
});
